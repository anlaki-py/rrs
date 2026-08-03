import { execFileSync } from "node:child_process";
import { runClient } from "../../src/client.js";

const stty = (): string =>
  execFileSync("stty", ["-g"], { encoding: "utf8", stdio: [0, "pipe", "pipe"] }).trim();

const before = stty();
if (process.env.RRS_SIGNAL_SELF === "1") {
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 300).unref();
}

try {
  await runClient({
    url: process.argv[2]!,
    insecure: false,
    strictTls: false,
  });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}

const after = stty();
process.stdout.write(before === after ? "TERMINAL_RESTORED\n" : `TERMINAL_CHANGED ${before} ${after}\n`);
