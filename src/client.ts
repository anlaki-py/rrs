import type { IncomingMessage } from "node:http";
import process from "node:process";
import WebSocket from "ws";
import { encodeResizeMessage, MAX_MESSAGE_SIZE } from "./protocol.js";
import { enableWindowsVirtualTerminalInput } from "./windows-terminal.js";

const HIGH_WATER_MARK = 1024 * 1024;
const LOW_WATER_MARK = 256 * 1024;
const OPEN_TIMEOUT_MS = 15_000;

const CERTIFICATE_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export interface ClientConfig {
  url: string;
  token?: string;
  insecure: boolean;
  strictTls: boolean;
}

interface ErrorWithCode extends Error {
  code?: string;
  cause?: unknown;
}

export function normalizeUrl(input: string): string {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `wss://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`invalid WebSocket URL: ${input}`);
  }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("URL must use http://, https://, ws://, or wss://");
  }
  if (!url.hostname) throw new Error(`invalid WebSocket URL: ${input}`);
  return url.href;
}

export function isCertificateVerificationError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as ErrorWithCode;
    if (candidate.code && CERTIFICATE_ERROR_CODES.has(candidate.code)) return true;
    current = candidate.cause;
  }
  return false;
}

function connectionErrorForResponse(response: IncomingMessage): ErrorWithCode {
  const error = new Error(`WebSocket upgrade failed with HTTP ${response.statusCode ?? "response"}`) as ErrorWithCode;
  error.code = `HTTP_${response.statusCode ?? "ERROR"}`;
  response.resume();
  return error;
}

export function openWebSocket(
  url: string,
  token: string | undefined,
  rejectUnauthorized: boolean | undefined,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const options: WebSocket.ClientOptions = {
      perMessageDeflate: false,
      maxPayload: MAX_MESSAGE_SIZE,
      handshakeTimeout: OPEN_TIMEOUT_MS,
      ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
      ...(headers ? { headers } : {}),
    };
    const socket = new WebSocket(url, options);
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(error);
    };
    socket.once("open", () => {
      if (settled) return;
      settled = true;
      resolve(socket);
    });
    socket.once("error", fail);
    socket.once("unexpected-response", (_request, response) => fail(connectionErrorForResponse(response)));
  });
}

export async function connectWithTlsPolicy(
  config: ClientConfig,
  connect: typeof openWebSocket = openWebSocket,
): Promise<WebSocket> {
  const url = normalizeUrl(config.url);
  const secure = url.startsWith("wss:");
  if (!secure) return connect(url, config.token, undefined);
  if (config.insecure) return connect(url, config.token, false);

  try {
    return await connect(url, config.token, true);
  } catch (error) {
    if (config.strictTls || !isCertificateVerificationError(error)) throw error;
    console.error("rrs: TLS certificate verification failed; retrying without verification");
    console.error("rrs: warning: the server identity is unverified and RRS_TOKEN may be exposed");
    return connect(url, config.token, false);
  }
}

function currentTerminalSize(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}

async function useInteractiveTerminal(socket: WebSocket): Promise<void> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    socket.terminate();
    throw new Error("connect requires an interactive stdin terminal");
  }

  const wasRaw = process.stdin.isRaw;
  let stdinPaused = false;
  let socketPaused = false;

  const sendResize = (): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(encodeResizeMessage(currentTerminalSize()));
  };
  const resumeStdin = (): void => {
    if (stdinPaused && socket.bufferedAmount <= LOW_WATER_MARK) {
      stdinPaused = false;
      process.stdin.resume();
    }
  };
  const onInput = (data: Buffer): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(data, { binary: true }, (error) => {
      if (error) socket.terminate();
      resumeStdin();
    });
    if (socket.bufferedAmount >= HIGH_WATER_MARK && !stdinPaused) {
      stdinPaused = true;
      process.stdin.pause();
    }
  };
  const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
    if (!isBinary) return;
    const output = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (!process.stdout.write(output) && !socketPaused) {
      socketPaused = true;
      socket.pause();
      process.stdout.once("drain", () => {
        socketPaused = false;
        socket.resume();
      });
    }
  };
  const stop = (): void => socket.close(1000);

  process.stdin.setRawMode(true);
  // Must run after setRawMode: libuv otherwise overwrites this Windows flag.
  const restoreWindowsTerminal = enableWindowsVirtualTerminalInput();
  if (process.platform === "win32" && !restoreWindowsTerminal) {
    console.error("rrs: warning: unable to enable Windows terminal mouse input");
  }
  try {
    process.stdin.resume();
    process.stdin.on("data", onInput);
    socket.on("message", onMessage);
    process.stdout.on("resize", sendResize);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    sendResize();

    await new Promise<void>((resolve, reject) => {
      socket.once("close", () => resolve());
      socket.once("error", reject);
      process.stdin.once("end", stop);
    });
  } finally {
    process.stdin.off("data", onInput);
    process.stdin.off("end", stop);
    process.stdout.off("resize", sendResize);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    restoreWindowsTerminal?.();
    process.stdin.setRawMode(Boolean(wasRaw));
    if (!wasRaw) process.stdin.pause();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.terminate();
    process.stdout.write("\r\n");
  }
}

export async function runClient(config: ClientConfig): Promise<void> {
  const socket = await connectWithTlsPolicy(config);
  await useInteractiveTerminal(socket);
}
