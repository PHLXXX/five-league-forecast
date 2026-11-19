import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredDocuments = [
  "产品说明.md",
  "安装与启动说明.md",
  "联网与数据说明.md",
  "故障排查.md",
  "版本信息.md",
];

test("桌面版中文文档齐全", async () => {
  for (const filename of requiredDocuments) {
    const content = await readFile(
      new URL(`../docs/desktop/${filename}`, import.meta.url),
      "utf8"
    );
    assert.ok(content.length > 120, `${filename} 内容过短`);
  }
});

test("启动说明覆盖安装版、便携版、联网、退出和日志", async () => {
  const content = await readFile(
    new URL("../docs/desktop/安装与启动说明.md", import.meta.url),
    "utf8"
  );
  for (const keyword of ["安装版", "便携版", "联网", "退出", "日志"]) {
    assert.match(content, new RegExp(keyword));
  }
});

test("E 盘发布脚本包含安装包、文档和哈希校验", async () => {
  const scriptUrl = new URL("../scripts/publish-desktop.ps1", import.meta.url);
  const bytes = await readFile(scriptUrl);
  const content = bytes.toString("utf8");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(content, /E:\\喷火龙五大联赛分析工具/);
  assert.match(content, /安装包/);
  assert.match(content, /文档/);
  assert.match(content, /Get-FileHash/);
  assert.match(content, /SHA256/);
  assert.match(content, /expectedNames/);
  assert.match(content, /WScript\.Shell/);
  assert.match(content, /CreateShortcut/);
  assert.doesNotMatch(content, /artifacts\.Count -lt 2/);
});
