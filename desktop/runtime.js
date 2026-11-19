import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import net from "node:net";
import { join, resolve } from "node:path";

export function buildDesktopRuntimeConfig({ appPath, userDataPath, port }) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort < 1 || safePort > 65535) {
    throw new Error("桌面服务端口无效");
  }

  const dataDir = resolve(userDataPath, "data");
  const logDir = resolve(userDataPath, "logs");
  return {
    appPath: resolve(appPath),
    serverEntry: resolve(appPath, "server.js"),
    seedDataDir: resolve(appPath, "data"),
    dataDir,
    logDir,
    baseUrl: `http://127.0.0.1:${safePort}`,
    env: {
      HOST: "127.0.0.1",
      PORT: String(safePort),
      DATA_DIR: dataDir,
      LOG_DIR: logDir,
      DESKTOP_ENV_PATH: resolve(userDataPath, ".env"),
    },
  };
}

export function createSingleFlight(task) {
  let active = null;
  return (...args) => {
    if (active) return active;
    active = Promise.resolve()
      .then(() => task(...args))
      .finally(() => {
        active = null;
      });
    return active;
  };
}

export function isTrustedLocalUrl(candidate, baseUrl) {
  try {
    const target = new URL(candidate);
    const base = new URL(baseUrl);
    return (
      target.protocol === "http:" &&
      base.protocol === "http:" &&
      target.origin === base.origin &&
      target.hostname === "127.0.0.1" &&
      target.username === "" &&
      target.password === ""
    );
  } catch {
    return false;
  }
}

export async function copySeedData(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copySeedData(source, target);
      continue;
    }
    if (!entry.isFile() || (await pathExists(target))) continue;
    await copyFile(source, target);
  }
}

export async function waitForHealth(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 30000);
  const intervalMs = Number(options.intervalMs || 300);
  const request = options.request || defaultHealthRequest;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await request(url);
      if (response?.ok) return true;
    } catch {
      // The service may refuse connections during its first startup phase.
    }
    await delay(intervalMs);
  }

  throw new Error("分析服务启动超时，请重试或打开日志目录查看详情");
}

export async function findAvailablePort(preferredPort = 5177) {
  if (await canListen(preferredPort)) return Number(preferredPort);
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selectedPort = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? rejectPort(error) : resolvePort(selectedPort)));
    });
  });
}

async function defaultHealthRequest(url) {
  return fetch(url, { signal: AbortSignal.timeout(2500) });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function canListen(port) {
  return new Promise((resolveCheck) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolveCheck(false));
    server.listen(Number(port), "127.0.0.1", () => {
      server.close(() => resolveCheck(true));
    });
  });
}
