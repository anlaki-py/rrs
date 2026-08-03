import assert from "node:assert/strict";
import test from "node:test";
import { openSocket, waitForOutput, waitForProcessExit, withServer } from "../support/server.js";

test("serves an interactive PowerShell ConPTY with prompt and resize support", async () => {
  await withServer(undefined, async (server) => {
    const socket = await openSocket(`ws://127.0.0.1:${server.port}`);
    const [pid] = server.activePids;
    assert.ok(pid);

    const promptOutput = waitForOutput(socket, /PS [^\r\n>]*> /);
    socket.send(Buffer.from("\r"));
    assert.match(await promptOutput, /PS [^\r\n>]*> /);

    const marker = `RRS_${Date.now()}`;
    const markerOutput = waitForOutput(socket, new RegExp(marker));
    socket.send(Buffer.from(`Write-Output '${marker}'\r`));
    assert.match(await markerOutput, new RegExp(marker));

    socket.send(JSON.stringify({ rows: 37, cols: 91 }));
    const sizeOutput = waitForOutput(socket, /37 91/);
    socket.send(Buffer.from('Write-Output "$([Console]::WindowHeight) $([Console]::WindowWidth)"\r'));
    assert.match(await sizeOutput, /37 91/);

    socket.terminate();
    await waitForProcessExit(pid);
    assert.equal(server.activePids.size, 0);
  });
});
