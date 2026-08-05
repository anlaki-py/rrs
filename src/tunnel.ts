import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z\d-]+\.trycloudflare\.com(?=$|[\s"'<>|,}\]])/i;
const TUNNEL_START_TIMEOUT_MS = 30_000;

export interface RunningTunnel {
  readonly url: string;
  close(): Promise<void>;
}

export function isCloudflaredAvailable(command = "cloudflared"): boolean {
  const result = spawnSync(command, ["--version"], {
    shell: process.platform === "win32",
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

export function resolveCloudflaredCommand(command = "cloudflared"): { command: string; args: string[] } {
  return isCloudflaredAvailable(command)
    ? { command, args: [] }
    : { command: "npx", args: ["--yes", "cloudflared"] };
}

export function cloudflareWebSocketUrl(output: string): string | undefined {
  const url = output.match(CLOUDFLARE_URL_PATTERN)?.[0];
  return url?.replace(/^https:/i, "wss:");
}

export function cloudflaredEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): NodeJS.ProcessEnv {
  if (environment.SSL_CERT_FILE || environment.SSL_CERT_DIR || !environment.TERMUX_VERSION || !environment.PREFIX) {
    return environment;
  }

  const certificateFile = join(environment.PREFIX, "etc", "tls", "cert.pem");
  return fileExists(certificateFile) ? { ...environment, SSL_CERT_FILE: certificateFile } : environment;
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill();
  });
}

export function startCloudflareTunnel(localUrl: string, command = "cloudflared"): Promise<RunningTunnel> {
  const cloudflared = resolveCloudflaredCommand(command);
  const child = spawn(cloudflared.command, [...cloudflared.args, "tunnel", "--url", localUrl], {
    env: cloudflaredEnvironment(),
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => fail(new Error("timed out waiting for cloudflared to provide a tunnel URL")), TUNNEL_START_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void stopProcess(child);
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-16_384);
      const url = cloudflareWebSocketUrl(output);
      if (!url || settled) return;
      settled = true;
      cleanup();
      let closing = false;
      child.on("error", (error) => console.error(`rrs: cloudflared error: ${error.message}`));
      child.on("exit", (code, signal) => {
        if (closing) return;
        if (code && code !== 0) console.error(`rrs: cloudflared exited with code ${code}`);
        else if (signal) console.error(`rrs: cloudflared exited after signal ${signal}`);
      });
      resolve({
        url,
        close: () => {
          closing = true;
          return stopProcess(child);
        },
      });
    };
    const onError = (error: Error): void => fail(error);
    const onExit = (code: number | null): void => {
      fail(new Error(`cloudflared exited before providing a tunnel URL${code === null ? "" : ` (code ${code})`}`));
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}
