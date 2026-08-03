import WebSocket from "ws";
import { startServer, type RunningServer } from "../../src/server.js";

export function openSocket(url: string, token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      reject(Object.assign(new Error(`HTTP ${response.statusCode}`), { statusCode: response.statusCode }));
    });
  });
}

export function waitForOutput(socket: WebSocket, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${pattern}; output: ${JSON.stringify(output)}`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData): void => {
      output += data.toString();
      if (pattern.test(output)) {
        cleanup();
        resolve(output);
      }
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
    };
    socket.on("message", onMessage);
  });
}

export async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`PTY child ${pid} did not exit`);
}

export async function withServer(
  token: string | undefined,
  action: (server: RunningServer) => Promise<void>,
): Promise<void> {
  const server = await startServer({ host: "127.0.0.1", port: 0, ...(token ? { token } : {}) });
  try {
    await action(server);
  } finally {
    await server.close();
  }
}
