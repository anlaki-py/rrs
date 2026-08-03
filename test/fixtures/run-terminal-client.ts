import { runClient } from "../../src/client.js";

const wasRaw = process.stdin.isRaw;
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

process.stdout.write(
  process.stdin.isRaw === wasRaw ? "TERMINAL_RESTORED\n" : `TERMINAL_CHANGED ${wasRaw} ${process.stdin.isRaw}\n`,
);
