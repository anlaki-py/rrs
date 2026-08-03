import { createRequire } from "node:module";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { runClient, type ClientConfig } from "./client.js";
import { runServer, type ServerConfig } from "./server.js";
import { updateRrs } from "./updater.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const HELP = `RRS - Random Remote Shell

Usage:
  rrs --help
  rrs --version
  rrs update
  rrs serve [options]
  rrs connect [options] <url>

Commands:
  update                Install the latest GitHub Release globally
  serve                 Start the HTTP/WebSocket shell server
  connect <url>         Connect this terminal to an RRS server

Run "rrs serve --help" or "rrs connect --help" for command options.
`;

const SERVE_HELP = `Usage: rrs serve [options]

Options:
  --host <address>      Listener address (HOST, default: 0.0.0.0)
  --port <number>       Listener port (PORT, default: 7860)
  --token <value>       WebSocket bearer token (RRS_TOKEN)
  --tunnel              Expose the server through a Cloudflare Quick Tunnel
  -h, --help            Show this help
`;

const CONNECT_HELP = `Usage: rrs connect [options] <url>

HTTP URLs are automatically converted to their WebSocket equivalent.

Options:
  --token <value>       WebSocket bearer token (RRS_TOKEN)
  --insecure            Disable TLS verification on the first attempt
  --strict-tls          Never retry after certificate verification failure
  -h, --help            Show this help
`;

export interface Environment {
  HOST?: string;
  PORT?: string;
  RRS_TOKEN?: string;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("port must be an integer from 1 to 65535");
  }
  return port;
}

function parseCommandArgs<const T extends ParseArgsConfig>(config: T) {
  try {
    return parseArgs(config);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export function parseServeConfig(args: string[], env: Environment = process.env): ServerConfig | "help" {
  const parsed = parseCommandArgs({
    args,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      token: { type: "string" },
      tunnel: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help) return "help";
  if (parsed.positionals.length) throw new Error(`unexpected argument: ${parsed.positionals[0]}`);

  const host = parsed.values.host ?? env.HOST ?? "0.0.0.0";
  const port = parsePort(parsed.values.port ?? env.PORT ?? "7860");
  const token = parsed.values.token ?? env.RRS_TOKEN;
  return { host, port, tunnel: parsed.values.tunnel ?? false, ...(token !== undefined ? { token } : {}) };
}

export function parseClientConfig(args: string[], env: Environment = process.env): ClientConfig | "help" {
  const parsed = parseCommandArgs({
    args,
    options: {
      token: { type: "string" },
      insecure: { type: "boolean" },
      "strict-tls": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help) return "help";
  if (parsed.values.insecure && parsed.values["strict-tls"]) {
    throw new Error("--insecure and --strict-tls cannot be used together");
  }
  if (parsed.positionals.length !== 1) {
    throw new Error(parsed.positionals.length ? "connect accepts exactly one URL" : "connect requires a URL");
  }

  const token = parsed.values.token ?? env.RRS_TOKEN;
  return {
    url: parsed.positionals[0]!,
    insecure: parsed.values.insecure ?? false,
    strictTls: parsed.values["strict-tls"] ?? false,
    ...(token !== undefined ? { token } : {}),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function main(args = process.argv.slice(2), env: Environment = process.env): Promise<number> {
  try {
    const command = args[0];
    if (command === "--help" || command === "-h" || command === undefined) {
      process.stdout.write(HELP);
      return 0;
    }
    if (command === "--version" || command === "-v") {
      process.stdout.write(`${version}\n`);
      return 0;
    }
    if (command === "update") {
      if (args.length !== 1) throw new Error("update does not accept arguments");
      const result = await updateRrs(version);
      process.stdout.write(
        result.updated ? `RRS updated to ${result.version}\n` : `RRS ${result.version} is already up to date\n`,
      );
      return 0;
    }
    if (command === "serve") {
      const config = parseServeConfig(args.slice(1), env);
      if (config === "help") {
        process.stdout.write(SERVE_HELP);
        return 0;
      }
      await runServer(config);
      return 0;
    }
    if (command === "connect") {
      const config = parseClientConfig(args.slice(1), env);
      if (config === "help") {
        process.stdout.write(CONNECT_HELP);
        return 0;
      }
      await runClient(config);
      return 0;
    }
    throw new Error(`unknown command: ${command}; run "rrs --help"`);
  } catch (error) {
    process.stderr.write(`rrs: ${errorMessage(error)}\n`);
    return 1;
  }
}
