import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const source = resolve(projectDir, "public", "codex-avatar.svg");
const target = resolve(projectDir, "build", "icon.png");

await mkdir(dirname(target), { recursive: true });
const svg = await readFile(source);
await sharp(svg).resize(1024, 1024).png().toFile(target);
console.log(target);
