# 五大联赛分析平台本地桌面版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建无需系统 Node.js、双击即可使用的 Windows 10/11 64 位安装版和免安装版五大联赛分析软件。

**Architecture:** Electron 主进程管理单实例窗口和 Express 服务子进程，先完成健康检查再加载现有 Web UI。运行期数据写入 Electron `userData`，程序资源保持只读，构建产物和中文文档复制到 E 盘交付目录。

**Tech Stack:** Electron、electron-builder、Node.js 22、Express、Node Test Runner、PowerShell。

## Global Constraints

- 支持 Windows 10/11 64 位。
- 软件运行不依赖系统 Node.js 或手动命令行。
- 后端仅监听 `127.0.0.1`。
- 同时生成 NSIS 安装版和 portable 便携版。
- 最终交付根目录固定为 `E:\喷火龙五大联赛分析工具`。
- 保留现有五大联赛分析、盘口、赛程、积分榜和历史回测能力。

---

### Task 1: 桌面运行时路径与健康检查

**Files:**
- Create: `desktop/runtime.js`
- Test: `test/desktop-runtime.test.js`

**Interfaces:**
- Produces: `buildDesktopRuntimeConfig(input)`, `waitForHealth(url, options)`, `copySeedData(sourceDir, targetDir)`。

- [ ] **Step 1: 编写失败测试**

测试开发态与打包态路径、强制绑定 `127.0.0.1`、用户数据目录和健康检查重试行为。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node --test test/desktop-runtime.test.js`

Expected: FAIL，原因是 `desktop/runtime.js` 尚不存在。

- [ ] **Step 3: 实现最小运行时模块**

实现纯函数配置、种子数据复制和带超时的健康检查，不引用 Electron API，确保可独立测试。

- [ ] **Step 4: 验证测试通过**

Run: `node --test test/desktop-runtime.test.js`

Expected: PASS。

### Task 2: Electron 主进程与启动页

**Files:**
- Create: `desktop/main.js`
- Create: `desktop/preload.js`
- Create: `desktop/loading.html`
- Create: `desktop/error.html`
- Test: `test/desktop-contract.test.js`

**Interfaces:**
- Consumes: `buildDesktopRuntimeConfig`, `waitForHealth`, `copySeedData`。
- Produces: 单实例桌面窗口、服务生命周期控制、日志目录 IPC 和外部链接隔离。

- [ ] **Step 1: 编写失败的桌面契约测试**

验证主进程文件包含单实例锁、服务停止钩子、上下文隔离、禁用 Node 集成和仅允许本地 URL 的导航策略。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node --test test/desktop-contract.test.js`

Expected: FAIL，原因是桌面入口文件尚不存在。

- [ ] **Step 3: 实现主进程和中文状态页**

使用 Electron `utilityProcess.fork` 启动 `server.js`，等待健康检查后加载窗口；异常时加载中文错误页并提供重试、日志和退出操作。

- [ ] **Step 4: 验证桌面契约测试通过**

Run: `node --test test/desktop-contract.test.js`

Expected: PASS。

### Task 3: 桌面构建配置

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `build/icon.png`
- Create: `scripts/build-desktop.ps1`
- Test: `test/desktop-package.test.js`

**Interfaces:**
- Produces: `npm run desktop`, `npm run desktop:pack`, `npm run desktop:dist`。

- [ ] **Step 1: 编写失败的打包配置测试**

验证 Electron 入口、Windows x64、NSIS、portable、输出目录、快捷方式名称和必要资源包含规则。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node --test test/desktop-package.test.js`

Expected: FAIL，原因是 `package.json` 尚无桌面构建配置。

- [ ] **Step 3: 安装并配置 Electron 工具链**

安装固定版本的 `electron` 与 `electron-builder`，配置 `dist-desktop`、安装版和便携版，并生成应用图标。

- [ ] **Step 4: 验证配置测试与语法检查通过**

Run: `npm test && npm run check`

Expected: 全部 PASS，退出码 0。

### Task 4: E 盘交付文档与复制脚本

**Files:**
- Create: `docs/desktop/产品说明.md`
- Create: `docs/desktop/安装与启动说明.md`
- Create: `docs/desktop/联网与数据说明.md`
- Create: `docs/desktop/故障排查.md`
- Create: `docs/desktop/版本信息.md`
- Create: `scripts/publish-desktop.ps1`
- Test: `test/desktop-docs.test.js`

**Interfaces:**
- Produces: `E:\喷火龙五大联赛分析工具\安装包` 和 `E:\喷火龙五大联赛分析工具\文档`。

- [ ] **Step 1: 编写失败的文档完整性测试**

验证五份中文文档均存在，且启动说明包含安装版、便携版、联网、退出和日志路径。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node --test test/desktop-docs.test.js`

Expected: FAIL，原因是桌面文档尚不存在。

- [ ] **Step 3: 编写文档和发布脚本**

发布脚本清理并重建交付目录，复制构建产物、文档、设计、计划和校验报告，输出 SHA-256 校验文件。

- [ ] **Step 4: 验证文档测试通过**

Run: `node --test test/desktop-docs.test.js`

Expected: PASS。

### Task 5: 构建与端到端验收

**Files:**
- Create: `docs/desktop/构建验证报告.md`
- Generate: `dist-desktop/*.exe`
- Generate: `E:\喷火龙五大联赛分析工具\安装包\*.exe`

**Interfaces:**
- Consumes: 全部桌面代码、构建配置和发布脚本。
- Produces: 可安装与可携带的最终 Windows 软件。

- [ ] **Step 1: 执行完整自动化测试**

Run: `npm test && npm run check`

Expected: 0 failures。

- [ ] **Step 2: 构建未打包目录并启动冒烟测试**

Run: `npm run desktop:pack`

Expected: `dist-desktop/win-unpacked/喷火龙五大联赛分析平台.exe` 存在并可启动。

- [ ] **Step 3: 构建安装版和便携版**

Run: `npm run desktop:dist`

Expected: NSIS 与 portable 两个 `.exe` 文件均生成。

- [ ] **Step 4: 发布到 E 盘并校验**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish-desktop.ps1`

Expected: 安装包、文档、SHA-256 和验证报告全部存在。

- [ ] **Step 5: 最终进程与接口验证**

启动免安装版，验证窗口标题、`/api/health`、五大联赛目录和关闭后端口释放，并把结果写入构建验证报告。
