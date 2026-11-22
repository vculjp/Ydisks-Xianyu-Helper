# 在本地显示已授权 Android 手机的画面，不登录账号、不自动提交商品。
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $dir 'check-device.ps1') -RequireApp
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 从 WinGet 便携包中寻找 scrcpy，不修改项目和全局环境变量。
$scrcpyCommand = Get-Command scrcpy.exe -ErrorAction SilentlyContinue
$scrcpyPath = if ($scrcpyCommand) { $scrcpyCommand.Source } else { $null }
if (-not $scrcpyPath) {
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    $scrcpyPath = Get-ChildItem -LiteralPath $packages -Filter scrcpy.exe -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Genymobile\.scrcpy' } |
        Select-Object -ExpandProperty FullName -First 1
}
if (-not $scrcpyPath) { throw '未找到 scrcpy.exe' }

# 保持控制窗口常驻以便直接关闭；不启用无线调试或远程网络服务。
& $scrcpyPath --stay-awake --window-title '闲鱼真机调试（手动确认发布）'
