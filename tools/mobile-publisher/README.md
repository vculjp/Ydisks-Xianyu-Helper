# 闲鱼 Android 真机发布环境

本目录为现有 `Ydisks-Xianyu-Helper` 准备独立的 **Android 真机自动化环境**。不会替换现有网页发布引擎，也不会绕过闲鱼的登录、安全验证、账号权限或发布限制。

## 当前使用流程

1. 在 Android 手机中打开 **设置 → 关于手机 → 版本号**，连续点击版本号开启开发者选项（部分三星手机路径为 **关于手机 → 软件信息 → 编译编号**）。
2. 在 **开发者选项** 中打开 **USB 调试**，使用支持数据传输的 USB 线将手机连接到 Windows 电脑。
3. 解锁手机，在“允许 USB 调试”提示中点击允许；若手机显示“仅充电”，切换到文件传输模式再测试。
4. **最简单：** 双击项目里的 `tools\mobile-publisher\start-phone.cmd`，它会检测授权、检查闲鱼 APP，然后打开电脑投屏窗口；也可以在项目根目录打开 PowerShell，运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\tools\mobile-publisher\check-device.ps1 -RequireApp
   powershell -ExecutionPolicy Bypass -File .\tools\mobile-publisher\start-mirror.ps1
   ```

脚本只检测一台已授权手机，核对闲鱼包名为 `com.taobao.idlefish`，不会输出设备序列号、凭证或买家信息。

## APP 自动化的边界

- 通过 Android 官方 UI 测试接口读取控件结构，采用控件语义定位，而非凭空猜测屏幕点击坐标。
- 自动化仅在真实闲鱼 APP 中填入用户拥有使用权的图片、真实商品标题、售价、类目与票务信息。
- 每次真实提交前显示发布内容供人工确认，平台登录验证、资质审核、验证码必须由用户本人完成。
- 发布后以平台明确返回的商品 ID 和列表状态作为成功凭据；未知结果不重试，防止重复上架。
- 不直接复用原卖家的票务类目来销售与电影票不符的其他内容，不调用绕过 PC 发布限制的隐藏接口。

## 依赖

官方 `scrcpy` 与其自带 `adb` 可用 WinGet 安装：

```powershell
winget install --id Genymobile.scrcpy --exact
```

项目独立目录已准备 Appium 4 和 UiAutomator2 驱动。应用启动脚本会使用 `%LOCALAPPDATA%\Android\Sdk` 与本机 JDK 17，不修改现有业务服务端口。

已安装 Android SDK Platform-Tools 和官方 SDK 命令行组件。Android Build-Tools 36 的首次安装需要由用户本人阅读并同意 Google SDK 许可证；本次没有替用户接受条款。需要时可在自己的终端中运行 `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat "build-tools;36.0.0"` 并按提示选择。Appium Doctor 可能要求安装模拟器，但本方案只操作真机，暂不安装模拟器镜像。

也可以直接双击 `tools\mobile-publisher\setup-build-tools.cmd`，阅读并自行决定是否接受 Google SDK 使用许可；拒绝条款不会执行此安装步骤。

```powershell
# 仅检查驱动依赖
powershell -ExecutionPolicy Bypass -File .\tools\mobile-publisher\start-appium.ps1 -Doctor
# 手机连接并完成 USB 调试授权后，启动本地 Appium（只监听 127.0.0.1:4723）
powershell -ExecutionPolicy Bypass -File .\tools\mobile-publisher\start-appium.ps1
```

在手机完成 USB 调试授权并能读取闲鱼的真实 UI 控件树前，**暂不实现盲点坐标的自动发布**；未来的发布任务需要真实票务信息、人工预览确认、明确的发布成功 ID 和失败防重逻辑。
