import assert from "node:assert/strict";
import test from "node:test";
import { runTerminalClient, withWebSocketServer } from "../support/terminal.js";

test("restores Windows console raw mode after normal server closure", async () => {
  await withWebSocketServer(
    (socket) => socket.once("message", () => socket.close(1000)),
    async (url) => {
      const result = await runTerminalClient(url, false);
      assert.equal(result.exitCode, 0, result.output);
      assert.match(result.output, /TERMINAL_RESTORED/);
    },
  );
});
