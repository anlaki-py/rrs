# RRS - Random Remote Shell

> **Personal experiment:** RRS is a small personal project, not production-grade
> shell server software. It grants remote access to the account that runs it.
> Review and harden it before exposing it to an untrusted network.

RRS provides an interactive Bash terminal over WebSockets. The current CLI is a
native Node.js/TypeScript package for Linux; the original Python scripts remain
available as legacy clients.

## Install

RRS requires Linux and Node.js 20 or newer. `node-pty` is a native dependency,
so npm may need a compiler toolchain if no compatible prebuilt binary is
available. Runtime dependencies are downloaded from the npm registry even
though RRS itself is distributed only through GitHub Releases.

Install the latest release globally:

```sh
npm install --global https://github.com/anlaki-py/rrs/releases/latest/download/rrs.tgz
```

Run it temporarily with `npx`:

```sh
npx --yes https://github.com/anlaki-py/rrs/releases/latest/download/rrs.tgz serve
```

If npm cannot infer the package binary from that URL, use the explicit form:

```sh
npm exec --yes \
  --package=https://github.com/anlaki-py/rrs/releases/latest/download/rrs.tgz \
  -- rrs connect wss://terminal.example.com
```

## Quick start

Start a server with a strong token:

```sh
RRS_TOKEN='secret' rrs serve
```

Connect from another interactive terminal:

```sh
rrs connect --token 'secret' ws://127.0.0.1:7860
```

Each connection gets an independent interactive Bash PTY. Terminal input and
output use binary WebSocket frames; resize events use JSON text messages.

## CLI

```text
rrs --help
rrs --version
rrs serve [options]
rrs connect [options] <url>
```

### Server options

| Option | Environment | Default | Description |
| --- | --- | --- | --- |
| `--host <address>` | `HOST` | `0.0.0.0` | Listener address |
| `--port <number>` | `PORT` | `7860` | Listener port, from 1 through 65535 |
| `--token <value>` | `RRS_TOKEN` | unset | Bearer token required for WebSocket upgrades |

CLI options take precedence over environment variables. When no token is set,
the server prints a prominent warning: anyone who can reach it can open a shell.
Normal HTTP requests remain public:

- `GET /healthz` returns `OK`.
- Other HTTP paths return a small informational page.
- Bearer authentication applies only to WebSocket upgrades.

Examples:

```sh
rrs serve --host 127.0.0.1 --port 9000 --token 'secret'
HOST=127.0.0.1 PORT=9000 RRS_TOKEN='secret' rrs serve
```

### Client options

| Option | Environment | Default | Description |
| --- | --- | --- | --- |
| `--token <value>` | `RRS_TOKEN` | unset | Bearer token sent during upgrade |
| `--insecure` | none | false | Disable TLS verification immediately |
| `--strict-tls` | none | false | Never retry with verification disabled |

`--insecure` and `--strict-tls` cannot be combined. URLs must use `ws://` or
`wss://`; a URL without a scheme is treated as `wss://`. The client requires an
interactive stdin terminal so it can safely enter and restore raw mode.

```sh
rrs connect --token 'secret' ws://127.0.0.1:7860
rrs connect --strict-tls wss://terminal.example.com
rrs connect --insecure wss://self-signed.example.com
```

For a remote `wss://` endpoint, place a TLS-capable reverse proxy, tunnel, or
hosting platform in front of `rrs serve`, which listens with plain HTTP and
WebSockets.

## TLS verification and fallback

The client verifies certificates and hostnames by default. If, and only if, the
initial connection fails with a recognized TLS certificate verification error,
it warns and retries once with verification disabled:

```text
rrs: TLS certificate verification failed; retrying without verification
rrs: warning: the server identity is unverified and RRS_TOKEN may be exposed
```

The retry can connect to an impersonating server and expose the bearer token.
Use `--strict-tls` to forbid fallback. Use `--insecure` only when you explicitly
accept this risk. DNS failures, timeouts, refused connections, HTTP errors,
WebSocket protocol errors, and closures after opening never trigger fallback.

## Security notes

- Treat `RRS_TOKEN` as a password; do not place it in a URL or commit it.
- The token is shared authentication, not user identity or authorization.
- The shell inherits the server process's directory, environment, and account
  permissions and loads the account's normal interactive Bash configuration.
- Use firewall rules, private networking, or a trusted reverse proxy in addition
  to the token.
- RRS does not provide auditing, sandboxing, privilege separation, or abuse
  protection.

## Development and releases

```sh
npm ci
npm run typecheck
npm test
npm run build
npm pack
```

Generated `dist/`, local tarballs, `node_modules/`, and Python caches are not
committed. Pull requests and pushes to `master` run CI on Node 20 and Node 24,
including TypeScript checks, local PTY/TLS integration tests, package inspection,
and legacy Python compilation.

Every successful push to `master` creates or updates GitHub Release
`v0.1.<run-number>`. Its asset is always named `rrs.tgz`; the package and CLI
inside report the same generated version. RRS is not published to the npm
registry.

## Legacy Python implementation

The original implementation remains available:

| File | Purpose |
| --- | --- |
| `wsshell-expose.py` | WebSocket server and per-connection Bash PTY |
| `wspty-connect.py` | Interactive terminal client |

Install its dependency and run it directly:

```sh
python3 -m pip install websockets
RRS_TOKEN='secret' python3 wsshell-expose.py
python3 wspty-connect.py --token 'secret' ws://127.0.0.1:7860
```

The Python client disables certificate and hostname verification for every
`wss://` connection. This insecure behavior is legacy-only; prefer the Node CLI.
The Python scripts require Python 3.10+ and Unix PTY/terminal facilities.
