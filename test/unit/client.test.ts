import assert from "node:assert/strict";
import test from "node:test";
import type WebSocket from "ws";
import {
  connectWithTlsPolicy,
  isCertificateVerificationError,
  normalizeUrl,
  type ClientConfig,
} from "../../src/client.js";

test("normalizes and validates WebSocket URLs", () => {
  assert.equal(normalizeUrl("example.com/path"), "wss://example.com/path");
  assert.equal(normalizeUrl("ws://127.0.0.1:7860"), "ws://127.0.0.1:7860/");
  assert.equal(normalizeUrl("wss://example.com"), "wss://example.com/");
  assert.throws(() => normalizeUrl("https://example.com"), /ws:\/\/ or wss:\/\//);
  assert.throws(() => normalizeUrl("wss://"), /invalid WebSocket URL/);
});

test("classifies certificate errors by code and wrapped cause only", () => {
  assert.equal(isCertificateVerificationError(Object.assign(new Error(), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })), true);
  assert.equal(
    isCertificateVerificationError(new Error("wrapped", { cause: Object.assign(new Error(), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }) })),
    true,
  );
  assert.equal(isCertificateVerificationError(Object.assign(new Error("certificate failed"), { code: "ECONNREFUSED" })), false);
});

function config(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return { url: "wss://example.com", insecure: false, strictTls: false, ...overrides };
}

test("certificate failure retries insecurely exactly once", async () => {
  const calls: Array<boolean | undefined> = [];
  const expected = {} as WebSocket;
  const connect = async (_url: string, _token: string | undefined, rejectUnauthorized: boolean | undefined) => {
    calls.push(rejectUnauthorized);
    if (calls.length === 1) throw Object.assign(new Error("self signed"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    return expected;
  };
  assert.equal(await connectWithTlsPolicy(config(), connect), expected);
  assert.deepEqual(calls, [true, false]);
});

test("strict TLS and unrelated errors never retry", async () => {
  for (const [overrides, code] of [[{ strictTls: true }, "DEPTH_ZERO_SELF_SIGNED_CERT"], [{}, "ECONNREFUSED"]] as const) {
    let calls = 0;
    const connect = async () => {
      calls += 1;
      throw Object.assign(new Error(code), { code });
    };
    await assert.rejects(connectWithTlsPolicy(config(overrides), connect), { code });
    assert.equal(calls, 1);
  }
});

test("insecure mode skips verification and ws URLs receive no TLS option", async () => {
  for (const [settings, expected] of [[config({ insecure: true }), false], [config({ url: "ws://localhost" }), undefined]] as const) {
    const calls: Array<boolean | undefined> = [];
    const connect = async (_url: string, _token: string | undefined, rejectUnauthorized: boolean | undefined) => {
      calls.push(rejectUnauthorized);
      return {} as WebSocket;
    };
    await connectWithTlsPolicy(settings, connect);
    assert.deepEqual(calls, [expected]);
  }
});
