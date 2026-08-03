import { readFile } from "node:fs/promises";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("package manifest path is required");

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Array<{
  files: Array<{ path: string }>;
}>;
const files = manifest[0]?.files.map((entry) => entry.path);
if (!files) throw new Error("npm pack returned invalid metadata");

for (const required of [
  "package.json",
  "README.md",
  "bin/rrs.js",
  "bin/rrs.bashrc",
  "dist/cli.js",
  "dist/shell.js",
  "dist/updater.js",
]) {
  if (!files.includes(required)) throw new Error(`package is missing ${required}`);
}

const forbidden = files.filter((path) => path.startsWith("test/") || path.startsWith(".github/"));
if (forbidden.length) throw new Error(`package contains repository-only files: ${forbidden.join(", ")}`);
