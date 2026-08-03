import assert from "node:assert/strict";
import test from "node:test";
import { tokensEqual } from "../../src/server.js";

test("compares bearer tokens including unequal lengths", () => {
  assert.equal(tokensEqual("secret", "Bearer secret"), true);
  assert.equal(tokensEqual("secret", undefined), false);
  assert.equal(tokensEqual("secret", "Bearer wrong"), false);
  assert.equal(tokensEqual("secret", "Bearer much-longer-secret"), false);
});
