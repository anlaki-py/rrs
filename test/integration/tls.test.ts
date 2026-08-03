import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import test from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { connectWithTlsPolicy, openWebSocket, type ClientConfig } from "../../src/client.js";

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    socket.once("close", resolve);
    socket.close();
  });
}

test("self-signed TLS retries once, while strict and insecure modes make one attempt", async () => {
  const fixture = new URL("../fixtures/", import.meta.url);
  const [key, cert] = await Promise.all([
    readFile(new URL("localhost-test-key.pem", fixture)),
    readFile(new URL("localhost-test-cert.pem", fixture)),
  ]);
  const server = createServer({ key, cert });
  const webSocketServer = new WebSocketServer({ server });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base: ClientConfig = {
    url: `wss://127.0.0.1:${port}`,
    insecure: false,
    strictTls: false,
  };

  try {
    const attempts: Array<boolean | undefined> = [];
    const trackedOpen = async (url: string, token: string | undefined, rejectUnauthorized: boolean | undefined) => {
      attempts.push(rejectUnauthorized);
      return openWebSocket(url, token, rejectUnauthorized);
    };
    const fallbackSocket = await connectWithTlsPolicy(base, trackedOpen);
    assert.deepEqual(attempts, [true, false]);
    await closeSocket(fallbackSocket);

    attempts.length = 0;
    await assert.rejects(connectWithTlsPolicy({ ...base, strictTls: true }, trackedOpen), (error: NodeJS.ErrnoException) =>
      error.code === "DEPTH_ZERO_SELF_SIGNED_CERT",
    );
    assert.deepEqual(attempts, [true]);

    attempts.length = 0;
    const insecureSocket = await connectWithTlsPolicy({ ...base, insecure: true }, trackedOpen);
    assert.deepEqual(attempts, [false]);
    await closeSocket(insecureSocket);
  } finally {
    for (const socket of webSocketServer.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => webSocketServer.close((error) => (error ? reject(error) : resolve())));
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
