# macOS 桌面版设计说明

## 目标

在不改变现有分析服务和 Windows 使用方式的前提下，将喷火龙五大联赛分析平台扩展为 macOS 桌面应用，同时覆盖 Apple 芯片与 Intel Mac。

## 推荐方案

- 继续使用 Electron 承载现有本地网页和 Node.js 分析服务，避免维护两套分析逻辑。
- 用户数据统一存放在 Electron 的 `userData` 目录。macOS 下对应 `~/Library/Application Support/喷火龙五大联赛分析平台`，程序升级不覆盖历史记录。
- 主窗口关闭后遵循 macOS 习惯保留应用，点击程序坞图标可重新打开；通过 `Command+Q` 完整退出并停止本地服务。
- 提供中文的应用、编辑、显示和窗口菜单。
- 分别输出 Apple Silicon `arm64` 与 Intel `x64` 的 DMG 和 ZIP，文件名明确标注架构，避免用户装错版本。
- 使用 GitHub Actions 的 macOS 构建机生成安装包。Windows 本机只负责代码验证，避免产生结构不完整的伪 DMG。
- 默认允许生成未签名测试包；配置 Apple 开发者证书后，同一流程可继续完成签名和公证。

## 验收标准

1. Windows 现有安装版与便携版配置保持可用。
2. macOS 构建配置包含 DMG、ZIP、图标、权限文件和架构标识。
3. Apple 芯片与 Intel 两类构建均可由自动流程触发。
4. macOS 生命周期、菜单、用户数据目录和本地服务均有自动测试覆盖。
5. 提供全中文安装、构建和排障文档。
