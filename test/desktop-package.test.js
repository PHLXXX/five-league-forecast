import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("package.json 提供 Windows 安装版和便携版构建配置", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.equal(packageJson.main, "desktop/main.js");
  assert.equal(packageJson.scripts.desktop, "electron .");
  assert.match(packageJson.scripts["desktop:pack"], /electron-builder --dir --win --x64/);
  assert.match(packageJson.scripts["desktop:dist"], /electron-builder --win nsis portable --x64/);
  assert.ok(packageJson.devDependencies.electron);
  assert.ok(packageJson.devDependencies["electron-builder"]);
  assert.equal(packageJson.build.appId, "cn.charizard.fiveleague.analyzer");
  assert.equal(packageJson.build.productName, "喷火龙五大联赛分析平台");
  assert.equal(packageJson.build.directories.output, "dist-desktop");
  assert.equal(packageJson.build.win.icon, "build/icon.png");
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
  assert.equal(packageJson.build.nsis.shortcutName, "喷火龙五大联赛分析平台");
  assert.ok(packageJson.build.files.includes("desktop/**/*"));
  assert.ok(packageJson.build.files.includes("public/**/*"));
  assert.ok(packageJson.build.files.includes("src/**/*"));
  assert.ok(packageJson.build.files.includes("data/**/*"));
});

test("桌面应用图标存在", async () => {
  await access(new URL("../build/icon.png", import.meta.url));
});
