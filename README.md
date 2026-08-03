# RRS - Random Remote Shell

> **Personal experiment:** This is a small, random personal project, not
> production-grade software. Expect rough edges, limited testing, and security
> limitations. Use it at your own risk and do not deploy it as a production
> shell service without reviewing and hardening the code yourself.

RRS (Random Remote Shell) provides a small remote terminal over WebSockets:

- `wsshell-expose.py` starts a Bash shell behind a WebSocket server.
- `wspty-connect.py` connects an interactive terminal to that shell.

Each WebSocket connection gets its own PTY and Bash process. The server is
intended for Linux-based environments, including Replit, and the client is
designed for a local Unix-like terminal such as Termux.

## Requirements

- Python 3.10 or newer
- Linux or another platform that provides `pty`, `fcntl`, and `termios`
- The `websockets` Python package
- An interactive terminal for the client

The server and client can run on different machines. Install the dependency
wherever each script will run:

```sh
python3 -m pip install websockets
```

Using a virtual environment is recommended:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install websockets
```

## Quick Start

Start the server in one terminal:

```sh
RRS_TOKEN='change-this-token' python3 wsshell-expose.py
```

The default listener is `0.0.0.0:7860`. In another terminal on the same
machine, connect to it:

```sh
python3 wspty-connect.py \
  --token 'change-this-token' \
  ws://127.0.0.1:7860
```

You should now have an interactive Bash prompt. Press `Ctrl-D` or close the
client to disconnect. Press `Ctrl-C` in the server terminal to stop the
server.

Do not use the example token outside a local test. Generate a long random
value for any exposed server, for example:

```sh
export RRS_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 wsshell-expose.py
```

## Server Usage

Run the server directly:

```sh
python3 wsshell-expose.py
```

The server reads these environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Address to bind to |
| `PORT` | `7860` | TCP port to listen on |
| `RRS_TOKEN` | unset | Shared bearer token for WebSocket connections |

For example, bind to a local-only port:

```sh
HOST=127.0.0.1 PORT=9000 RRS_TOKEN='secret' python3 wsshell-expose.py
```

The server prints its listening address at startup. It also exposes:

- `/healthz` returns `200 OK` and is suitable for a basic health check.
- `/` returns a small HTML information page. It is not a browser terminal.
- WebSocket connections create an interactive Bash PTY.

When `RRS_TOKEN` is set, clients must send the matching HTTP header:

```text
Authorization: Bearer <token>
```

When the variable is unset, the server prints a warning and anyone who can
reach the WebSocket URL can open a shell. Always set a token before exposing
the server to a network you do not fully trust.

## Client Usage

Connect with an explicit WebSocket URL:

```sh
python3 wspty-connect.py ws://HOST:PORT
```

For an authenticated server, provide the token with either `--token`:

```sh
python3 wspty-connect.py \
  --token "$RRS_TOKEN" \
  ws://HOST:PORT
```

or the `RRS_TOKEN` environment variable:

```sh
RRS_TOKEN='secret' python3 wspty-connect.py ws://HOST:PORT
```

The URL may use either `ws://` or `wss://`. A URL without a scheme is treated
as `wss://`, so this is equivalent to `wss://example.com:443`:

```sh
python3 wspty-connect.py example.com:443
```

The client must be attached to an interactive terminal. Piped or redirected
input is rejected because the client switches the terminal into raw mode and
restores the original settings when it exits.

View all client options with:

```sh
python3 wspty-connect.py --help
```

## Remote HTTPS/WSS Setup

`wsshell-expose.py` serves plain WebSockets. It does not create or manage TLS
certificates. For a remote `wss://` connection, put a TLS-capable reverse
proxy, tunnel, or hosting platform in front of the server and forward the
WebSocket upgrade to the server's `HOST:PORT`.

A typical remote connection looks like:

```sh
python3 wspty-connect.py \
  --token "$RRS_TOKEN" \
  wss://terminal.example.com
```

### TLS warning

The current client deliberately disables TLS certificate and hostname
verification for every `wss://` connection. This makes self-signed
certificates work, but it also allows man-in-the-middle attacks. Use `wss://`
only with an endpoint you trust and a network where this limitation is
acceptable. The client must be changed before it can enforce certificate
validation.

## Troubleshooting

### `Connection refused`

Confirm that the server is running, that the client is using the correct port,
and that the listener is reachable through any firewall or proxy. Check the
server locally with:

```sh
curl http://127.0.0.1:7860/healthz
```

### `401 Unauthorized`

The server has `RRS_TOKEN` set, but the client token is missing or different.
Pass the same value with `--token` or set `RRS_TOKEN` in the client
environment.

### The client says it requires an interactive terminal

Run it directly from a terminal. Do not pipe input into it or run it as a
background process without a TTY.

### The shell closes immediately

Check the server's stderr/stdout for PTY or Bash startup errors. The server
requires Bash and a platform with PTY support.

## Security Notes

This tool grants shell access to the account running the server. Treat the
token as a password and do not commit it to a repository or place it in a URL.
Use network controls or a reverse proxy in addition to the shared token when
the server is reachable from untrusted networks.

The server loads the account's `~/.bashrc` before starting the interactive
shell. This makes normal aliases and environment settings available, but also
means the shell inherits the permissions and environment of the server
process.

## Project Files

| File | Purpose |
| --- | --- |
| `wsshell-expose.py` | WebSocket server and per-connection Bash PTY |
| `wspty-connect.py` | Interactive WebSocket terminal client |
