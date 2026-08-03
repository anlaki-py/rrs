import assert from "node:assert/strict";
import test from "node:test";
import { parseResizeMessage } from "../../src/protocol.js";

test("parses valid resize messages at the boundaries", () => {
  assert.deepEqual(parseResizeMessage('{"rows":1,"cols":4096}'), { rows: 1, cols: 4096 });
  assert.deepEqual(parseResizeMessage('{"rows":4096,"cols":1}'), { rows: 4096, cols: 1 });
});

test("rejects malformed and incomplete resize messages", () => {
  for (const message of ["{", "null", "[]", '{}', '{"rows":24}', '{"cols":80}']) {
    assert.equal(parseResizeMessage(message), undefined);
  }
});

test("rejects invalid resize dimensions", () => {
  for (const message of [
    '{"rows":true,"cols":80}',
    '{"rows":24.5,"cols":80}',
    '{"rows":0,"cols":80}',
    '{"rows":24,"cols":4097}',
  ]) {
    assert.equal(parseResizeMessage(message), undefined);
  }
});
