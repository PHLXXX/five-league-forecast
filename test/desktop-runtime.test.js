import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDesktopRuntimeConfig,
  copySeedData,
  createSingleFlight,
  findAvailablePort,
  isTrustedLocalUrl,
  waitForHealth,
} from "../desktop/runtime.js";
import net from "node:net";

test("桌面运行时强制使用本机地址和用户数据目录", () => {
  const config = buildDesktopRuntimeConfig({
    appPath: "C:\\Program Files\\FiveLeagueAnalyzer\\resources\\app",
    userDataPath: "C:\\Users\\tester\\AppData\\Roaming\\FiveLeagueAnalyzer",
    port: 53121,
  });

  assert.equal(config.baseUrl, "http://127.0.0.1:53121");
  assert.equal(config.env.HOST, "127.0.0.1");
  assert.equal(config.env.PORT, "53121");
  assert.match(config.env.DATA_DIR, /FiveLeagueAnalyzer[\\/]data$/);
  assert.match(config.env.DESKTOP_ENV_PATH, /FiveLeagueAnalyzer[\\/]\.env$/);
  assert.match(config.logDir, /FiveLeagueAnalyzer[\\/]logs$/);
  assert.match(config.serverEntry, /resources[\\/]app[\\/]server\.js$/);
});

test("只信任同源的本机分析地址", () => {
  const baseUrl = "http://127.0.0.1:53121";
  assert.equal(isTrustedLocalUrl("http://127.0.0.1:53121/api/health", baseUrl), true);
  assert.equal(isTrustedLocalUrl("http://127.0.0.1:53121@evil.example/", baseUrl), false);
  assert.equal(isTrustedLocalUrl("https://127.0.0.1:53121/", baseUrl), false);
  assert.equal(isTrustedLocalUrl("http://localhost:53121/", baseUrl), false);
});

test("并发服务重启合并为一次执行", async () => {
  let calls = 0;
  const run = createSingleFlight(async () => {
    calls += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    return "ready";
  });

  const first = run();
  const second = run();
  assert.strictEqual(first, second);
  assert.equal(await second, "ready");
  assert.equal(calls, 1);
  assert.equal(await run(), "ready");
  assert.equal(calls, 2);
});

test("首次启动复制种子数据且不覆盖已有历史", async () => {
  const root = await mkdtemp(join(tmpdir(), "five-league-desktop-"));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "prediction-history.json"), "seed", "utf8");

  await copySeedData(source, target);
  assert.equal(await readFile(join(target, "prediction-history.json"), "utf8"), "seed");

  await writeFile(join(target, "prediction-history.json"), "user-data", "utf8");
  await copySeedData(source, target);
  assert.equal(await readFile(join(target, "prediction-history.json"), "utf8"), "user-data");
});

test("健康检查在服务可用后返回且超时会抛出中文错误", async () => {
  let attempts = 0;
  const result = await waitForHealth("http://127.0.0.1:53121/api/health", {
    timeoutMs: 200,
    intervalMs: 1,
    request: async () => {
      attempts += 1;
      return { ok: attempts >= 3 };
    },
  });
  assert.equal(result, true);
  assert.equal(attempts, 3);

  await assert.rejects(
    waitForHealth("http://127.0.0.1:53121/api/health", {
      timeoutMs: 10,
      intervalMs: 1,
      request: async () => ({ ok: false }),
    }),
    /分析服务启动超时/
  );
});

test("端口冲突时自动选择新的本机端口", async () => {
  const occupied = net.createServer();
  await new Promise((resolveListen) => occupied.listen(0, "127.0.0.1", resolveListen));
  const occupiedPort = occupied.address().port;

  try {
    const selected = await findAvailablePort(occupiedPort);
    assert.notEqual(selected, occupiedPort);
    assert.ok(selected > 0 && selected <= 65535);
  } finally {
    await new Promise((resolveClose) => occupied.close(resolveClose));
  }
});
