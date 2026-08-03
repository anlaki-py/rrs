import { spawnSync } from "node:child_process";

const script = process.platform === "win32" ? "test:windows" : process.platform === "linux" ? "test:linux" : undefined;
if (!script) throw new Error(`unsupported operating system: ${process.platform}`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", script], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
