import assert from "node:assert/strict";
import test from "node:test";
import { cloudflareWebSocketUrl, isCloudflaredAvailable, startCloudflareTunnel } from "../../src/tunnel.js";

test("extracts and converts a Cloudflare Quick Tunnel URL", () => {
  assert.equal(
    cloudflareWebSocketUrl("INF Your quick Tunnel has been created! https://random-words.trycloudflare.com"),
    "wss://random-words.trycloudflare.com",
  );
  assert.equal(cloudflareWebSocketUrl("no tunnel URL here"), undefined);
});

test("reports an actionable error when cloudflared is unavailable", () => {
  const missingCommand = "rrs-cloudflared-command-that-does-not-exist";
  assert.equal(isCloudflaredAvailable(missingCommand), false);
  assert.throws(
    () => startCloudflareTunnel("http://127.0.0.1:7860", missingCommand),
    /cloudflared is not available; install it with: npm install -g cloudflared/,
  );
});
