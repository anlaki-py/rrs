import assert from "node:assert/strict";
import test from "node:test";
import { openSocket, withServer } from "../support/server.js";

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
