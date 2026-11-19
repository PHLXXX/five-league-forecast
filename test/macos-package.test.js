import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

test("package.json 提供 macOS 双架构安装包配置", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.equal(packageJson.version, "1.2.2");
  assert.match(packageJson.scripts["desktop:dist:mac"], /electron-builder --mac dmg zip/);
  assert.equal(packageJson.build.mac.icon, "build/icon.png");
  assert.equal(packageJson.build.mac.category, "public.app-category.sports");
  assert.deepEqual(packageJson.build.mac.target, ["dmg", "zip"]);
  assert.match(packageJson.build.mac.artifactName, /macOS/);
  assert.match(packageJson.build.mac.artifactName, /\$\{arch\}/);
  assert.equal(packageJson.build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(packageJson.build.mac.entitlementsInherit, "build/entitlements.mac.plist");
});

test("macOS 生命周期保留应用并支持点击程序坞重新打开窗口", async () => {
  const source = await readFile(new URL("../desktop/main.js", import.meta.url), "utf8");

  assert.match(source, /process\.platform !== "darwin"/);
  assert.match(source, /app\.on\("activate"/);
  assert.match(source, /Menu\.setApplicationMenu/);
  assert.match(source, /role: "appMenu"/);
});

test("macOS 自动构建覆盖 Apple 芯片和 Intel", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/build-macos.yml", import.meta.url),
    "utf8"
  );

  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /runner: macos-15/);
  assert.match(workflow, /arm64/);
  assert.match(workflow, /x64/);
  assert.match(workflow, /desktop:dist:mac/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: false/);
  assert.match(workflow, /macos-buildkit-1\.1\.0\.tar\.gz\.b64/);
  assert.match(workflow, /base64 -D/);
  assert.match(workflow, /tar -xzf/);
  assert.match(workflow, /APP_DIR/);
});

test("macOS 安装、构建和排障文档齐全", async () => {
  for (const filename of ["安装与启动.md", "自动构建.md", "故障排查.md"]) {
    const url = new URL(`../docs/macos/${filename}`, import.meta.url);
    await access(url);
    const content = await readFile(url, "utf8");
    assert.ok(content.length > 180, `${filename} 内容过短`);
  }

  await access(new URL("../build/entitlements.mac.plist", import.meta.url));
});

test("macOS 使用 1024 像素 Retina 图标", async () => {
  const iconPath = fileURLToPath(new URL("../build/icon.png", import.meta.url));
  const icon = await sharp(iconPath).metadata();
  assert.equal(icon.width, 1024);
  assert.equal(icon.height, 1024);
  assert.equal(icon.hasAlpha, true);
});
