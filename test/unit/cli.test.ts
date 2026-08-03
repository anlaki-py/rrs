import assert from "node:assert/strict";
import test from "node:test";
import { main, parseClientConfig, parseServeConfig } from "../../src/cli.js";

async function captureWrite(
  stream: NodeJS.WriteStream,
  action: () => Promise<number>,
): Promise<{ code: number; output: string }> {
  const original = stream.write;
  let output = "";
  stream.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof stream.write;
  try {
    return { code: await action(), output };
  } finally {
    stream.write = original;
  }
}

test("top-level help, version, and unknown commands have stable exit behavior", async () => {
  const help = await captureWrite(process.stdout, () => main(["--help"], {}));
  assert.equal(help.code, 0);
  assert.match(help.output, /rrs serve/);

  const release = await captureWrite(process.stdout, () => main(["--version"], {}));
  assert.deepEqual(release, { code: 0, output: "0.1.0\n" });

  const unknown = await captureWrite(process.stderr, () => main(["unknown"], {}));
  assert.equal(unknown.code, 1);
  assert.match(unknown.output, /^rrs: unknown command/);
});

test("server options override environment values", () => {
  assert.deepEqual(
    parseServeConfig(["--host", "127.0.0.1", "--port", "9000", "--token", "cli"], {
      HOST: "env-host",
      PORT: "8000",
      RRS_TOKEN: "env",
    }),
    { host: "127.0.0.1", port: 9000, token: "cli" },
  );
});

test("server configuration uses environment and defaults", () => {
  assert.deepEqual(parseServeConfig([], {}), { host: "0.0.0.0", port: 7860 });
  assert.deepEqual(parseServeConfig([], { HOST: "localhost", PORT: "1234" }), {
    host: "localhost",
    port: 1234,
  });
});

test("rejects invalid ports", () => {
  for (const port of ["0", "65536", "1.5", "nope", "-1"]) {
    const argument = port.startsWith("-") ? `--port=${port}` : ["--port", port];
    const args = typeof argument === "string" ? [argument] : argument;
    assert.throws(() => parseServeConfig(args, {}), /port must be an integer/);
  }
});

test("client parses token precedence and TLS flags", () => {
  assert.deepEqual(parseClientConfig(["--token", "cli", "--strict-tls", "host"], { RRS_TOKEN: "env" }), {
    url: "host",
    token: "cli",
    insecure: false,
    strictTls: true,
  });
});

test("client rejects missing URL and conflicting TLS flags", () => {
  assert.throws(() => parseClientConfig([], {}), /requires a URL/);
  assert.throws(
    () => parseClientConfig(["--insecure", "--strict-tls", "host"], {}),
    /cannot be used together/,
  );
});
