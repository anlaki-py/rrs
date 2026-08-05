import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { cloudflareWebSocketUrl, cloudflaredEnvironment, resolveCloudflaredCommand } from "../../src/tunnel.js";

test("extracts and converts a Cloudflare Quick Tunnel URL", () => {
  assert.equal(
    cloudflareWebSocketUrl("INF Your quick Tunnel has been created! https://random-words.trycloudflare.com"),
    "wss://random-words.trycloudflare.com",
  );
  assert.equal(cloudflareWebSocketUrl("no tunnel URL here"), undefined);
});

test("ignores the Cloudflare API endpoint while waiting for the Quick Tunnel URL", () => {
  assert.equal(cloudflareWebSocketUrl("INF Requesting tunnel at https://api.trycloudflare.com/tunnel"), undefined);
  assert.equal(
    cloudflareWebSocketUrl(
      "INF Requesting tunnel at https://api.trycloudflare.com/tunnel\n" +
        "INF Your quick Tunnel has been created! https://random-words.trycloudflare.com",
    ),
    "wss://random-words.trycloudflare.com",
  );
});

test("uses the Termux CA bundle when cloudflared has no explicit trust configuration", () => {
  const environment = { PREFIX: "/termux", TERMUX_VERSION: "1" };
  const certificateFile = join(environment.PREFIX, "etc", "tls", "cert.pem");

  assert.deepEqual(cloudflaredEnvironment(environment, (path) => path === certificateFile), {
    ...environment,
    SSL_CERT_FILE: certificateFile,
  });

  const configuredEnvironment = { ...environment, SSL_CERT_FILE: "/custom/cert.pem" };
  assert.strictEqual(cloudflaredEnvironment(configuredEnvironment), configuredEnvironment);
});

test("prefers an installed cloudflared command and otherwise falls back to npx", () => {
  assert.deepEqual(resolveCloudflaredCommand(process.execPath), { command: process.execPath, args: [] });
  assert.deepEqual(resolveCloudflaredCommand("rrs-cloudflared-command-that-does-not-exist"), {
    command: "npx",
    args: ["--yes", "cloudflared"],
  });
});
