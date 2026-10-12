# 知间 · 学习打卡

<img src="icon-192.png" alt="知间 App Logo" width="96" height="96">

每天学习 50 分钟、休息 10 分钟，目标每天 8 轮、每周 6 天。阶段结束会响铃；Android 版还会在计时期间退到后台时安排系统通知。

## 界面预览

![知间桌面版界面：专注计时、今日目标和每周打卡](assets/screenshots/desktop.png)

## 当前公开版本：离线版

以下 v1.1.0 下载文件仍是离线版。云端版代码已加入注册、登录和同步功能，但尚未启用公网 API，也没有发布新的安装包。

## 下载和安装

在 [GitHub 下载页](https://github.com/XWT-git-web/XWT-git-web.github.io/releases/tag/v1.1.0) 选择与你设备对应的文件：

| 设备 | 直接下载 | 安装方法 |
| --- | --- | --- |
| Windows 10/11 电脑（64 位） | [Windows 安装程序 EXE](https://github.com/XWT-git-web/XWT-git-web.github.io/releases/download/v1.1.0/Zhijian-Windows-1.1.0-x64.exe) | 下载后双击安装。 |
| Mac 电脑（Apple 芯片或 Intel 芯片） | [macOS 安装映像 DMG](https://github.com/XWT-git-web/XWT-git-web.github.io/releases/download/v1.1.0/Zhijian-macOS-1.1.0-universal.dmg) | 打开 DMG，将“知间”拖进“应用程序”。 |
| Android 手机和平板 | [Android 安装包 APK](https://github.com/XWT-git-web/XWT-git-web.github.io/releases/download/v1.1.0/Zhijian-Android-1.1.0.apk) | 下载后打开 APK，按系统提示允许该来源安装。首次计时请允许通知。 |
| iPhone / iPad | [打开网页版](https://xwt-git-web.github.io/) | 用 Safari 打开，点“分享”→“添加到主屏幕”。 |

Windows、Mac 安装文件尚未购买代码签名证书，系统可能显示“未知发布者”或无法验证开发者。请只从本仓库的发布页下载，并自行核对来源。iPhone/iPad 暂时没有可公开下载的 IPA 安装包；苹果要求应用签名和相应的分发资格，而本项目维持零新增费用。

GitHub 与 GitHub Pages 在中国内地的连通情况因网络而异。发布前请让一位没有 VPN 的同学分别试一下下载页和网页版；本仓库无法保证它们在每个地区都可访问。

## 数据与提醒

- 无需账号，也没有服务器或数据库。记录、设置和正在进行的计时保存在当前设备。
- **电脑、手机和平板不会自动同步记录。** 不同安装方式的本地记录也不会自动迁移；卸载、清除应用数据可能删除记录。
- Windows 和 Mac 版需保持应用运行，才能在计时结束时响铃。Android 版可在后台发送系统通知；实际准点程度受通知权限和设备省电设置影响。
- iPhone/iPad 网页版需保持页面打开；锁屏或后台时，系统可能暂停计时铃声，重新打开后才更新进度。
- 可设置每天开始提醒时间、每周休息日和声音开关。Android 版的每日开始提醒使用系统通知。

## 云端版开发代码

将 [`cloud-config.js`](cloud-config.js) 中的 API 地址设为空时，网页和新构建的安装包仍按离线版运行。设为完成备案的 HTTPS API 地址并重新构建后，可用邮箱或手机号加密码注册、登录，跨设备同步打卡记录、提醒设置和计时状态。已有离线记录会在同一设备首次创建账号时导入，原离线记录作为本机备份保留。账号可修改密码、退出登录或删除云端数据；目前没有邮箱/手机验证与密码找回。

后端源码、测试和部署示例见 [`server/README.md`](server/README.md)。北京 ECS 上的公网 API 须等域名及 ICP 备案完成后才能开放。当前 GitHub Pages 与 v1.1.0 安装包仍保持离线使用。

## 源码与构建

网页应用源码在仓库根目录。桌面版在 [`native/desktop`](native/desktop)，Android 版在 [`native/mobile`](native/mobile)。

桌面版需要 Node.js：

```bash
cd native/desktop
npm ci
npm run dist -- --mac dmg --universal
# Windows 上使用：npm run dist -- --win nsis --x64
```

Android 版需要 Node.js、JDK 21 和 Android SDK：

```bash
cd native/mobile
npm ci
npm run sync
cd android
./gradlew assembleDebug
```

GitHub 上提供的正式 APK 使用项目维护者保存的发布密钥签名；仓库不包含私钥。自行构建的调试 APK 可用于个人测试，不能作为本项目的升级包。

网页离线文件可在 [v1.0.0 发布页](https://github.com/XWT-git-web/XWT-git-web.github.io/releases/tag/v1.0.0) 下载。首次打开网页版需要网络，其后可离线使用。
