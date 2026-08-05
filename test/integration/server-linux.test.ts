import assert from "node:assert/strict";
import test from "node:test";
import { openSocket, waitForOutput, waitForProcessExit, withServer } from "../support/server.js";

test("serves an interactive Linux shell PTY with command and resize support", async () => {
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
