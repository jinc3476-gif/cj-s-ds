# cj-s-ds · 简聊 Android 预览版 0.1.2

使用个人 DeepSeek API Key 的独立 Android 客户端。以官方开源 chat-demo 0.1.1 为基础，改为自己的名称、图标和米白 / 绿色界面，简化了首页与设置。

## 安装与使用

1. 将 artifacts/jianliao-0.1.2-preview.apk 发送到手机，用系统文件管理器打开。已安装旧版时直接覆盖安装，不要先卸载。
2. 如果系统提示，允许当前文件管理器“安装未知应用”，然后安装。
3. 首次打开，在设置中输入自己的 DeepSeek API Key，点击“确定”。应用调用官方 /models 接口校验，通过后保存。
4. 关闭设置即可聊天。输入框下有深度思考、智能搜索、录音、附件与发送按钮；左上角打开历史会话。

支持 Android 8.0 及以上，需要较新的 Android System WebView / Chrome（Chromium 105+）。这是 debug 签名的侧载预览包，适合首轮试用。

## 已实现

- 官方 API 直连、Key 校验、流式生成、深度思考、停止生成。
- 多轮上下文、历史会话、重命名 / 删除、Markdown、代码、公式。
- 沿用官方智能搜索、链接阅读、搜索引用、文件上传解析、ASR / TTS 接口。
- Android 系统文件选择、录音权限请求、历史 ZIP 导入 / 导出。
- 自有图标与简洁首页、深浅主题、中文与英文。
- 应用内更新：启动检查、设置页手动检查、更新说明、下载进度、取消/重试、SHA-256 与包名/版本/签名校验、系统确认安装。已接入 GitHub Releases；首次发布和后续步骤见 UPDATES.md。
- API Key 使用 Android Keystore 的 AES-GCM 密钥加密保存，关闭系统备份与设备迁移；会话保存在应用私有 WebView IndexedDB 中。

API Key 是连接凭据，本应用不创建单独账号。聊天、文件和语音会直接发送给 DeepSeek；计费和能力可用性取决于用户的 API 账户。没有开发者中转服务器。

## 验证范围

- 已通过 TypeScript、前端 lint、生产构建、Android 编译及 Android lint（0 错误；仍有 WebView 启用 JavaScript 的提示）。
- 更新元数据和下载模块的 10 项 JVM 测试覆盖错误元数据、HTTPS 跳转、取消、损坏/截断下载与缓存校验；12 项浏览器检查包含更新入口和聊天回归。浏览器原生桥接使用模拟对象。
- scripts/test-ui.mjs 使用合成 Key 和模拟官方响应，检查更新入口、Key 校验、多轮聊天、搜索声明、历史恢复、文件上传、停止生成、导出、窄屏及深色界面。
- 未使用真实付费 Key 验证线上生成、搜索、文件解析与语音服务；没有连接手机，尚未完成真机安装、录音、系统文件选择和导出测试。
- 浏览器预览使用普通网页存储 Key；Android APK 才使用 Keystore。浏览器测试中的桥接为合成替身，不是原生加密测试。

## 重新构建

需要 Node.js 22.12+（含 npm）、JDK 17 和 Android SDK（platform 35、build-tools 34.0.0）。复制到其他电脑后，用 Android Studio 打开工程配置 SDK，或在 local.properties 设置 sdk.dir。另需单独安全迁移 .signing/jianliao-preview.keystore；源码压缩包不包含签名文件，缺少原签名时构建会停止。

在 PowerShell 运行：

    ./scripts/build.ps1

已包含编译后的前端资源，只重编译 Android 可运行：

    ./scripts/build.ps1 -SkipWeb

预览网页：

    node scripts/preview.mjs

然后打开 http://127.0.0.1:8090。网页保存的 Key 不使用 Android Keystore。

## 来源与许可

见 UPSTREAM.md 与 web/LICENSE。上游 MIT 许可和第三方依赖许可随 APK 一并打包，在“设置 → 数据管理 → 关于与开源许可”可查看。保留许可归属，界面不使用 DeepSeek 鲸鱼或官方品牌图标。DeepSeek 名称仅用于说明实际 API 提供商。

工程通过官方源码压缩包导入；尚未在用户 GitHub 账号下创建远程 Fork。
