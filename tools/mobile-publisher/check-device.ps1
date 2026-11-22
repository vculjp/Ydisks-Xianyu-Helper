# 手机需要先完成 USB 调试授权。本脚本只读设备信息，不进行登录、商品发布或平台验证操作。
param(
    # RequireApp 额外核对手机是否安装闲鱼 APP。
    [switch]$RequireApp
)

$ErrorActionPreference = 'Stop'

# 优先使用系统 PATH 中已有的 ADB，再从 WinGet scrcpy 安装目录自动发现。
$adbCommand = Get-Command adb.exe -ErrorAction SilentlyContinue
$adbPath = if ($adbCommand) { $adbCommand.Source } else { $null }
if (-not $adbPath) {
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $adbPath = Get-ChildItem -LiteralPath $packages -Filter adb.exe -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Genymobile\.scrcpy' } |
        Select-Object -ExpandProperty FullName -First 1
}
if (-not $adbPath) {
    Write-Error '未检测到 ADB。请先安装 Genymobile.scrcpy 或 Android SDK Platform-Tools。'
    exit 2
}

# ADB status 不包含买家账号信息；设备序列号不被输出或写入日志。
$deviceOutput = @(& $adbPath devices -l)
$authorized = @($deviceOutput | Where-Object { $_ -match '^\S+\s+device(?:\s|$)' })
$unauthorized = @($deviceOutput | Where-Object { $_ -match '^\S+\s+unauthorized(?:\s|$)' })
$offline = @($deviceOutput | Where-Object { $_ -match '^\S+\s+offline(?:\s|$)' })

if ($unauthorized.Count -gt 0) {
    Write-Output '检测到手机但尚未授权。请解锁手机，在「允许 USB 调试」提示中点击允许。'
    exit 3
}
if ($authorized.Count -eq 0) {
    Write-Output '尚未检测到已授权 Android 手机。请连接数据线，启用开发者选项 → USB 调试，并在手机上允许。'
    if ($offline.Count -gt 0) { Write-Output '有离线设备，请更换数据线或重新授权。' }
    exit 4
}
if ($authorized.Count -ne 1) {
    Write-Error '检测到多台已授权设备，请只保留一台，以免误操作其他手机。'
    exit 5
}

# 只显示设备型号和 Android 版本，不使用和打印唯一设备序列号。
$model = (& $adbPath shell getprop ro.product.model).Trim()
$release = (& $adbPath shell getprop ro.build.version.release).Trim()
Write-Output "设备已授权：$model（Android $release）"

if ($RequireApp) {
    # 校验闲鱼应用包名，不自动启动 APP，也不尝试获取任何账号凭证。
    $installed = & $adbPath shell pm path com.taobao.idlefish
    if ($LASTEXITCODE -ne 0 -or -not ($installed -match '^package:')) {
        Write-Error '手机已连接，但未检测到闲鱼 Android APP（com.taobao.idlefish）。'
        exit 6
    }
    Write-Output '已检测到闲鱼 APP。'
}
Write-Output '真机调试环境就绪，可以启动 scrcpy。'
