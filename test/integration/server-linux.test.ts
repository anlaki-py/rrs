import assert from "node:assert/strict";
import test from "node:test";
import { openSocket, waitForOutput, waitForProcessExit, withServer } from "../support/server.js";

test("serves an interactive Bash PTY with prompt and resize support", async () => {
  await withServer(undefined, async (server) => {
    const socket = await openSocket(`ws://127.0.0.1:${server.port}`);
    const [pid] = server.activePids;
    assert.ok(pid);

    const promptOutput = waitForOutput(socket, /\x1b\[1;32m/);
    socket.send(Buffer.from("\n"));
    assert.match(await promptOutput, /\x1b\[1;32m/);

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
