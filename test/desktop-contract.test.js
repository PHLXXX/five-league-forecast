import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Electron 主进程具备单实例、安全窗口和服务清理契约", async () => {
  const source = await readFile(new URL("../desktop/main.js", import.meta.url), "utf8");

  assert.match(source, /requestSingleInstanceLock/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /utilityProcess\.fork/);
  assert.match(source, /waitForHealth/);
  assert.match(source, /before-quit/);
  assert.match(source, /childProcess\.kill/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /setWindowOpenHandler/);
  assert.match(source, /createSingleFlight/);
  assert.match(source, /isTrustedLocalUrl/);
});

test("桌面版允许从用户数据目录读取本机密钥配置", async () => {
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const runtimeSource = await readFile(new URL("../desktop/runtime.js", import.meta.url), "utf8");
  assert.match(serverSource, /DESKTOP_ENV_PATH/);
  assert.match(runtimeSource, /DESKTOP_ENV_PATH/);
});

test("预加载脚本只暴露受控的桌面操作", async () => {
  const mainSource = await readFile(new URL("../desktop/main.js", import.meta.url), "utf8");
  const source = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");

  assert.match(mainSource, /preload\.cjs/);
  assert.match(source, /require\(["']electron["']\)/);
  assert.match(source, /contextBridge\.exposeInMainWorld/);
  assert.match(source, /restartService/);
  assert.match(source, /openLogs/);
  assert.match(source, /quitApp/);
  assert.doesNotMatch(source, /require\(["']fs["']\)/);
});
