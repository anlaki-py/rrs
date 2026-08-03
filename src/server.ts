import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { IDisposable } from "node-pty";
import WebSocket, { WebSocketServer } from "ws";
import { MAX_MESSAGE_SIZE, parseResizeMessage } from "./protocol.js";
import { releaseShell, spawnShell, terminateShell, type PtyWithRawData } from "./shell.js";

const HIGH_WATER_MARK = 1024 * 1024;
const LOW_WATER_MARK = 256 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;

const HTML_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RRS - Random Remote Shell</title></head><body><h1>RRS - Random Remote Shell</h1>
<p>Connect with <code>rrs connect ws://HOST</code>.</p></body></html>\n`;

export interface ServerConfig {
  host: string;
  port: number;
  token?: string;
}

export interface RunningServer {
  readonly port: number;
  readonly activePids: ReadonlySet<number>;
  close(): Promise<void>;
}

export function tokensEqual(configured: string, authorization: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${configured}`);
  const supplied = Buffer.from(authorization ?? "");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function writeResponse(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    Connection: "close",
  });
  response.end(body);
}

function handleHttpRequest(_request: IncomingMessage, response: ServerResponse): void {
  if (_request.method === "GET" && _request.url === "/healthz") {
    writeResponse(response, 200, "OK\n", "text/plain; charset=utf-8");
    return;
  }
  writeResponse(response, 200, HTML_PAGE, "text/html; charset=utf-8");
}

function rejectUpgrade(socket: import("node:stream").Duplex): void {
  socket.end(
    "HTTP/1.1 401 Unauthorized\r\n" +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Content-Length: 13\r\n\r\nUnauthorized\n",
  );
}

class PtySession {
  readonly pid: number;
  private closed = false;
  private ptyPaused = false;
  private readonly dataSubscription: IDisposable;
  private readonly exitSubscription: IDisposable;

  constructor(
    private readonly socket: WebSocket,
    private readonly pty: PtyWithRawData,
    private readonly onClose: (pid: number) => void,
  ) {
    this.pid = pty.pid;
    this.dataSubscription = pty.onData((data) => this.sendPtyData(data));
    this.exitSubscription = pty.onExit(() => {
      releaseShell(pty);
      this.close(false);
    });
    socket.on("message", (data, isBinary) => this.receiveMessage(data, isBinary));
    socket.once("close", () => this.close());
    socket.once("error", () => this.close());
  }

  private sendPtyData(data: Buffer | string): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    const payload = typeof data === "string" ? Buffer.from(data) : data;
    if (this.socket.bufferedAmount >= HIGH_WATER_MARK && !this.ptyPaused) {
      this.pty.pause();
      this.ptyPaused = true;
    }
    this.socket.send(payload, { binary: true }, (error) => {
      if (error) {
        this.close();
        return;
      }
      if (this.ptyPaused && this.socket.bufferedAmount <= LOW_WATER_MARK) {
        this.pty.resume();
        this.ptyPaused = false;
      }
    });
  }

  private receiveMessage(data: WebSocket.RawData, isBinary: boolean): void {
    if (this.closed) return;
    if (isBinary) {
      this.pty.write(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      return;
    }

    const text = data.toString();
    const resize = parseResizeMessage(text);
    if (resize) {
      this.pty.resize(resize.cols, resize.rows);
      return;
    }
    this.pty.write(Buffer.from(`${text}\n`, "utf8"));
  }

  close(terminatePty = true): void {
    if (this.closed) return;
    this.closed = true;
    this.dataSubscription.dispose();
    this.exitSubscription.dispose();
    if (terminatePty) {
      try {
        terminateShell(this.pty);
      } catch {
        // The child may already have exited.
      }
    }
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
    this.onClose(this.pid);
  }
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const httpServer = createServer(handleHttpRequest);
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_MESSAGE_SIZE,
  });
  const sessions = new Map<number, PtySession>();
  const alive = new WeakSet<WebSocket>();

  webSocketServer.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    let session: PtySession;
    try {
      const pty = spawnShell();
      session = new PtySession(socket, pty, (pid) => sessions.delete(pid));
      sessions.set(session.pid, session);
    } catch {
      socket.close(1011, "Unable to start shell");
    }
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (config.token && !tokensEqual(config.token, request.headers.authorization)) {
      rejectUpgrade(socket);
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of webSocketServer.clients) {
      if (!alive.has(socket)) {
        socket.terminate();
        continue;
      }
      alive.delete(socket);
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  await listen(httpServer, config.host, config.port);
  const address = httpServer.address() as AddressInfo;
  let closing: Promise<void> | undefined;

  return {
    port: address.port,
    get activePids(): ReadonlySet<number> {
      return new Set(sessions.keys());
    },
    close(): Promise<void> {
      closing ??= new Promise((resolve, reject) => {
        clearInterval(heartbeat);
        for (const session of sessions.values()) session.close();
        for (const socket of webSocketServer.clients) socket.terminate();
        webSocketServer.close();
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      return closing;
    },
  };
}

export async function runServer(config: ServerConfig): Promise<void> {
  const server = await startServer(config);
  if (!config.token) {
    console.error("rrs: WARNING: RRS_TOKEN is not set; anyone who can reach this server can open a shell");
  }
  console.log(`RRS listening on ${config.host}:${server.port}`);
  await new Promise<void>((resolve, reject) => {
    const stop = (): void => void server.close().then(resolve, reject);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
