import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { startServer, type RunningServer } from "../../src/server.js";

function openSocket(url: string, token?: string): Promise<WebSocket> {
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

function waitForOutput(socket: WebSocket, pattern: RegExp, timeoutMs = 5_000): Promise<string> {
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

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
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

async function withServer(token: string | undefined, action: (server: RunningServer) => Promise<void>): Promise<void> {
  const server = await startServer({ host: "127.0.0.1", port: 0, ...(token ? { token } : {}) });
  try {
    await action(server);
  } finally {
    await server.close();
  }
}

test("serves health and informational HTTP routes", async () => {
  await withServer(undefined, async (server) => {
    const health = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "OK\n");

    const info = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(info.status, 200);
    assert.match(await info.text(), /Random Remote Shell/);
  });
});

test("enforces bearer authentication on WebSocket upgrades", async () => {
  await withServer("secret", async (server) => {
    const url = `ws://127.0.0.1:${server.port}`;
    await assert.rejects(openSocket(url), (error: Error & { statusCode?: number }) => error.statusCode === 401);
    await assert.rejects(openSocket(url, "wrong"), (error: Error & { statusCode?: number }) => error.statusCode === 401);
    const socket = await openSocket(url, "secret");
    socket.close();
  });
});

test("starts an interactive Bash PTY, handles resize, and kills it on disconnect", async () => {
  await withServer(undefined, async (server) => {
    const socket = await openSocket(`ws://127.0.0.1:${server.port}`);
    const [pid] = server.activePids;
    assert.ok(pid);

    const marker = `RRS_${Date.now()}`;
    const markerOutput = waitForOutput(socket, new RegExp(marker));
    socket.send(Buffer.from(`printf '${marker}\\n'\n`));
    assert.match(await markerOutput, new RegExp(marker));

    socket.send(JSON.stringify({ rows: 37, cols: 91 }));
    const sizeOutput = waitForOutput(socket, /37 91/);
    socket.send(Buffer.from("stty size\n"));
    assert.match(await sizeOutput, /37 91/);

    socket.terminate();
    await waitForProcessExit(pid);
    assert.equal(server.activePids.size, 0);
  });
});
