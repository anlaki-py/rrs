import { fileURLToPath } from "node:url";
import { spawn } from "node-pty";
import { WebSocketServer } from "ws";

export interface ClientRun {
  output: string;
  exitCode: number;
}

export async function runTerminalClient(url: string, signalSelf: boolean): Promise<ClientRun> {
  const fixture = fileURLToPath(new URL("../fixtures/run-terminal-client.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", "tsx", fixture, url], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: { ...process.env, ...(signalSelf ? { RRS_SIGNAL_SELF: "1" } : {}) },
  });

  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`terminal client timed out: ${JSON.stringify(output)}`));
    }, 15_000);
    child.onData((data) => {
      output += data;
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      resolve({ output, exitCode });
    });
  });
}

export async function withWebSocketServer(
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
