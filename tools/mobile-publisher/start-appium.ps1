# Appium 仅绑定本机回环地址，运行期间不注入用户凭证或触发闲鱼发布。
param(
    # Doctor 仅检查 Android 环境和已安装 UiAutomator2 驱动，不启动自动化服务。
    [switch]$Doctor
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# Appium 4、UiAutomator2 驱动使用项目私有扩展目录，避免污染其他 Android 工程。
$env:APPIUM_HOME = Join-Path $root '.appium'

# 默认读取官方标准 Android SDK 用户目录，不修改系统级环境变量。
if (-not $env:ANDROID_HOME) {
    $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
if (-not $env:JAVA_HOME -and (Test-Path 'C:\Program Files\Java\jdk-17\bin\javac.exe')) {
    $env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
}
if (-not (Test-Path (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'))) {
    Write-Error "尚未完成 Android SDK 安装：$env:ANDROID_HOME"
    exit 2
}
if (-not (Test-Path (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) {
    Write-Error 'JAVA_HOME 未指向有效的 JDK。'
    exit 3
}

# 以本地变量指定驱动进程需要的环境，保证 CLI 可找到 adb、aapt 和 Java。
$env:PATH = (Join-Path $env:ANDROID_HOME 'platform-tools') + ';' + (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH
$appium = Join-Path $root 'node_modules\.bin\appium.cmd'
if (-not (Test-Path $appium)) {
    Write-Error '项目尚未安装 Appium，请运行 npm.cmd install --prefix tools/mobile-publisher'
    exit 4
}
if ($Doctor) {
    & $appium driver doctor uiautomator2
} else {
    & $appium --address 127.0.0.1 --port 4723 --log-level info
}
# 将真实 Appium 退出状态传给双击启动脚本，避免环境诊断失败仍误报成功。
exit $LASTEXITCODE
