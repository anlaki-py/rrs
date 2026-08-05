# RRS - Random Remote Shell

> **Personal experiment:** RRS is a small personal project, not production-grade
> shell server software. It grants remote access to the account that runs it.
> Review and harden it before exposing it to an untrusted network.

RRS provides an interactive platform shell over WebSockets as a native
Node.js/TypeScript package for Linux and Windows.

## Install

RRS requires Node.js 20 or newer and one of these platforms:

- Linux with Bash.
- Windows 10 version 1809 or newer, Windows 11, or Windows Server 2019 or newer.

Windows serving uses the ConPTY terminal API. `node-pty` is a native dependency,
so npm may need a compiler toolchain if no compatible prebuilt binary is
available. On Windows that means Python, Visual Studio Build Tools with the
Desktop C++ workload, and a Windows SDK. Runtime dependencies are downloaded
from the npm registry even though RRS itself is distributed only through GitHub
Releases.

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

Because `npx` caches package specifications, its mutable `latest` URL may reuse
an older release. Use a versioned release URL when an exact version is required.

## Update

Update a global installation to the latest GitHub Release:

```sh
rrs update
```

The command checks GitHub for the latest version and passes its immutable,
versioned tarball URL to `npm install --global`. It may require the same system
permissions used for the original global installation. A temporary `npx` copy
cannot replace its own cache; use a versioned URL or clear the npx cache instead.

## Quick start

Start a server with a strong token:

```sh
RRS_TOKEN='secret' rrs serve
```

To expose it through a temporary Cloudflare Quick Tunnel, install `cloudflared`
and add `--tunnel`:

```sh
npm install -g cloudflared
RRS_TOKEN='secret' rrs serve --tunnel
```

RRS prints the generated address as a `wss://` URL ready for `rrs connect`.

Connect from another interactive terminal:

```sh
rrs connect --token 'secret' ws://127.0.0.1:7860
```

Each connection gets an independent interactive PTY. Linux serves the account's
`$SHELL`, which loads its native interactive configuration (such as `~/.zshrc`
or `~/.config/fish/config.fish`), and falls back to Bash with `~/.bashrc`.
Windows prefers PowerShell 7 (`pwsh.exe`) and falls back to Windows PowerShell
(`powershell.exe`). Terminal input and output use binary WebSocket frames;
resize events use JSON text messages.

### Windows PowerShell

The same package can serve or connect from Windows Terminal or a PowerShell
console:

```powershell
$env:RRS_TOKEN = 'secret'
rrs serve
```

```powershell
rrs connect --token 'secret' ws://127.0.0.1:7860
```

When running directly from a source checkout, use `node .\bin\rrs.js` or the
Windows launcher `./bin/rrs.cmd`. Executing `./bin/rrs.js` directly uses the
Windows `.js` file association and may open a Windows Script Host error dialog.

The npm global executable is exposed as `rrs` through npm's Windows command
shim. PowerShell profiles load normally for server sessions.

## CLI

```text
rrs --help
rrs --version
rrs update
rrs serve [options]
rrs connect [options] <url>
```

### Server options

| Option | Environment | Default | Description |
| --- | --- | --- | --- |
| `--host <address>` | `HOST` | `0.0.0.0` | Listener address |
| `--port <number>` | `PORT` | `7860` | Listener port, from 1 through 65535 |
| `--token <value>` | `RRS_TOKEN` | unset | Bearer token required for WebSocket upgrades |
| `--tunnel` | none | false | Expose the server through a Cloudflare Quick Tunnel |

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

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '9000'
$env:RRS_TOKEN = 'secret'
rrs serve
```

### Client options

| Option | Environment | Default | Description |
| --- | --- | --- | --- |
| `--token <value>` | `RRS_TOKEN` | unset | Bearer token sent during upgrade |
| `--insecure` | none | false | Disable TLS verification immediately |
| `--strict-tls` | none | false | Never retry with verification disabled |

`--insecure` and `--strict-tls` cannot be combined. The client accepts `ws://`
and `wss://` URLs, converts `http://` to `ws://` and `https://` to `wss://`, and
treats a URL without a scheme as `wss://`. The client requires an interactive
stdin terminal so it can safely enter and restore raw mode.

```sh
rrs connect --token 'secret' ws://127.0.0.1:7860
rrs connect https://terminal.example.com
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
  permissions and loads the account's normal shell configuration.
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

Generated `dist/`, local tarballs, and `node_modules/` are not committed. Pull
requests and pushes to `master` run CI on Linux with Node 20 and Node 24 and on
Windows with Node 24, including TypeScript checks, platform PTY/TLS integration
tests, and package installation inspection.

Every successful push to `master` creates or updates GitHub Release
`v0.1.<run-number>`. Its asset is always named `rrs.tgz`; the package and CLI
inside report the same generated version. RRS is not published to the npm registry.
