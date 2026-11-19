import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, shell, utilityProcess } from "electron";

import {
  buildDesktopRuntimeConfig,
  copySeedData,
  createSingleFlight,
  findAvailablePort,
  isTrustedLocalUrl,
  waitForHealth,
} from "./runtime.js";

const APP_NAME = "喷火龙五大联赛分析平台";
const STARTUP_TIMEOUT_MS = 45000;
let mainWindow = null;
let childProcess = null;
let runtimeConfig = null;
let quitting = false;
const restartService = createSingleFlight(showLoadingAndStartService);

app.setName(APP_NAME);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp);
  app.on("before-quit", () => {
    quitting = true;
    stopService();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    createMainWindow();
    if (runtimeConfig?.baseUrl && childProcess) {
      await mainWindow.loadURL(`${runtimeConfig.baseUrl}/`);
      return;
    }
    await restartService();
  });
}

async function startDesktopApp() {
  configureApplicationMenu();
  registerIpcHandlers();
  createMainWindow();
  await restartService();
}

function configureApplicationMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      role: "appMenu",
      label: APP_NAME,
      submenu: [
        { role: "about", label: `关于${APP_NAME}` },
        { type: "separator" },
        { role: "hide", label: `隐藏${APP_NAME}` },
        { role: "hideOthers", label: "隐藏其他应用" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: `退出${APP_NAME}` },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "显示",
      submenu: [
        { role: "reload", label: "刷新页面" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入全屏" },
      ],
    },
    {
      role: "windowMenu",
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "全部置于前台" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: "#061219",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (runtimeConfig && isTrustedLocalUrl(url, runtimeConfig.baseUrl)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.maximize();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!quitting && process.platform !== "darwin") app.quit();
  });
}

async function showLoadingAndStartService() {
  if (!mainWindow) return;
  await mainWindow.loadFile(join(import.meta.dirname, "loading.html"));
  try {
    await startService();
    await mainWindow.loadURL(`${runtimeConfig.baseUrl}/`);
  } catch (error) {
    writeLog(`启动失败: ${error?.stack || error}`);
    await mainWindow.loadFile(join(import.meta.dirname, "error.html"), {
      query: { message: String(error?.message || "分析服务启动失败") },
    });
  }
}

async function startService() {
  stopService();
  const port = await findAvailablePort(5177);
  runtimeConfig = buildDesktopRuntimeConfig({
    appPath: app.getAppPath(),
    userDataPath: app.getPath("userData"),
    port,
  });
  if (!runtimeConfig.baseUrl.startsWith("http://127.0.0.1:")) {
    throw new Error("桌面分析服务只能绑定本机地址");
  }
  mkdirSync(runtimeConfig.logDir, { recursive: true });
  await copySeedData(runtimeConfig.seedDataDir, runtimeConfig.dataDir);

  childProcess = utilityProcess.fork(runtimeConfig.serverEntry, [], {
    env: { ...process.env, ...runtimeConfig.env },
    serviceName: "Five League Analyzer Service",
    stdio: "pipe",
  });
  childProcess.stdout?.on("data", (data) => writeLog(data.toString()));
  childProcess.stderr?.on("data", (data) => writeLog(data.toString()));
  childProcess.on("exit", (code) => writeLog(`分析服务退出，代码 ${code}`));

  await waitForHealth(`${runtimeConfig.baseUrl}/api/health`, {
    timeoutMs: STARTUP_TIMEOUT_MS,
  });
}

function stopService() {
  if (!childProcess) return;
  try {
    childProcess.kill();
  } catch (error) {
    writeLog(`停止分析服务失败: ${error?.message || error}`);
  }
  childProcess = null;
}

function registerIpcHandlers() {
  ipcMain.handle("desktop:restart-service", () => restartService());
  ipcMain.handle("desktop:open-logs", async () => {
    const logDir = runtimeConfig?.logDir || join(app.getPath("userData"), "logs");
    mkdirSync(logDir, { recursive: true });
    return shell.openPath(logDir);
  });
  ipcMain.handle("desktop:quit", () => app.quit());
}

function writeLog(message) {
  const logDir = runtimeConfig?.logDir || join(app.getPath("userData"), "logs");
  mkdirSync(logDir, { recursive: true });
  appendFileSync(join(logDir, "desktop.log"), `[${new Date().toISOString()}] ${String(message).trim()}\n`, "utf8");
}
