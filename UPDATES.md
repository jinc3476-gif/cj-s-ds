# 简聊应用内更新与 GitHub Releases

## 当前配置

发布仓库：https://github.com/jinc3476-gif/cj-s-ds

0.1.2（versionCode 3）固定检查地址为：

    https://github.com/jinc3476-gif/cj-s-ds/releases/latest/download/latest.json

APK 使用对应版本 Release 的固定下载地址。公开 Release 可匿名读取，不需要 OSS、自定义域名、GitHub Token 或 API 服务器。

GitHub 上还需要创建并发布 v0.1.2 Release。0.1.1 手机需要手动覆盖安装 0.1.2 一次，因为旧版没有更新地址。以后可在 App 内检查更新。

## 首次发布

1. 登录 GitHub，打开 https://github.com/jinc3476-gif/cj-s-ds。
2. 运行 ./scripts/build.ps1。该脚本构建前端和 APK，运行单元测试、lint，并检查 APK 签名、包名和版本。
3. 运行 node scripts/prepare-release.mjs --repo jinc3476-gif/cj-s-ds。
4. 在仓库页面进入 Releases，点击 Draft a new release。
5. Tag 填 v0.1.2，标题填“简聊 0.1.2”。把 artifacts/releases/0.1.2/ 目录里的全部文件作为附件上传。
6. 不要勾选 Pre-release。确认附件上传完成后，点击 Publish release，并确认该版本显示为 Latest。
7. 打开上面的 latest.json 地址，确认它返回 JSON。检查 JSON 里的 APK 地址可以访问。
8. 将生成的 APK 覆盖安装到手机。不要先卸载旧版，以保留本地聊天和设置。

## 后续每次更新

1. 告诉 Codex 需要修改什么。
2. 修改 version.properties：versionCode 必须递增，versionName 更新。编辑 release-notes.txt。
3. 运行 ./scripts/build.ps1。
4. 运行 node scripts/prepare-release.mjs --repo jinc3476-gif/cj-s-ds。
5. 在 GitHub 新建 Release，Tag 使用 v<versionName>，例如 v0.1.3；上传生成目录中的全部文件。
6. 确认没有选中 Pre-release，然后发布并确认它成为 Latest。
7. 手机打开 App 或进入设置手动检查，查看更新说明，下载并在 Android 系统界面确认安装。

latest.json 地址保持不变。APK 下载 URL 带具体版本 tag，因此旧版清单中的 APK 地址不会悄悄指向新包。GitHub Release 的所有附件应上传完成后再发布；不要复用已经发布的 tag 或附件文件名。

脚本从构建好的 APK 读取版本、最低系统版本和包名，生成 APK、latest.json 和 SHA-256 文本。清单包含 schemaVersion、applicationId、versionCode、versionName、minSdk、apkUrl、size、sha256 和 notes。不需要手动编辑哈希或下载地址。

## 安全与限制

更新器仅接受 HTTPS，限制清单不超过 64 KiB、APK 不超过 512 MiB，并在安装前校验包名、版本、文件大小、SHA-256 及已安装应用的签名。更新请求不会携带 DeepSeek API Key。公开仓库只应包含源码、文档和公开发布文件。不要上传签名密钥、API Key、本机 local.properties、.tooling、Gradle 缓存或用户数据。

签名文件位于本机 .signing/jianliao-preview.keystore，Git 已忽略该文件。请单独安全备份。GitHub Release 目前由你在网页上创建，不需要 GitHub Token，也不会自动上传。

## 验证

自动检查包括 10 项 Java 测试、TypeScript、前端 lint、Android lint、12 项浏览器检查，以及 APK 签名和版本验证。scripts/test-release.mjs 使用临时重签名 APK 测试发布文件生成，然后删除临时文件，不会上传或安装。

真机安装与升级仍需在首次发布后验证，包括聊天和 Key 是否保留、下载失败重试、未知来源安装授权及系统确认安装。当前没有连接手机。
