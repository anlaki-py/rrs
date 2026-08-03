import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node-pty";
import { WebSocketServer } from "ws";

interface ClientRun {
  output: string;
  exitCode: number;
}

async function runTerminalClient(url: string, signalSelf: boolean): Promise<ClientRun> {
  const fixture = new URL("../fixtures/run-terminal-client.ts", import.meta.url);
  const child = spawn(process.execPath, ["--import", "tsx", fixture.pathname, url], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: { ...process.env, ...(signalSelf ? { RRS_SIGNAL_SELF: "1" } : {}) },
  });

  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`terminal client timed out: ${JSON.stringify(output)}`));
    }, 5_000);
    child.onData((data) => {
      output += data;
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      resolve({ output, exitCode });
    });
  });
}

async function withWebSocketServer(
  onConnection: Parameters<WebSocketServer["on"]>[1],
  action: (url: string) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  server.on("connection", onConnection);
  const address = server.address() as { port: number };
  try {
    await action(`ws://127.0.0.1:${address.port}`);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("restores terminal mode after normal server closure", async () => {
  await withWebSocketServer(
    (socket) => socket.once("message", () => socket.close(1000)),
    async (url) => {
      const result = await runTerminalClient(url, false);
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.output, /TERMINAL_RESTORED/);
    },
  );
});

test("restores terminal mode on the SIGTERM shutdown path", async () => {
  await withWebSocketServer(
    () => {},
    async (url) => {
      const result = await runTerminalClient(url, true);
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.output, /TERMINAL_RESTORED/);
    },
  );
});
