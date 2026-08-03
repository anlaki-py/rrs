# Handoff: Finish Windows server/client support

## Goal

Make RRS usable on both Linux and modern Windows for both roles:

- `rrs serve` on Windows must expose an interactive PowerShell ConPTY session.
- `rrs connect` must work from a PowerShell/Windows Terminal console.
- Windows shell preference is PowerShell 7 (`pwsh.exe`), then Windows PowerShell (`powershell.exe`).
- Supported Windows baseline is Windows 10 1809+, Windows 11, and Windows Server 2019+.
- Linux Bash behavior must remain intact.

The user explicitly requested separate Linux and Windows test suites and wants Windows runtime testing done in GitHub Actions, not in the current local environment.

## Current state

All implementation changes are committed and pushed to `origin/master`. The working tree was clean before this handoff was created.

Current HEAD:

```text
46230dc Terminate Windows shell trees without ConPTY leaks
```

Linux CI passed on Node 20 and Node 24 for the latest workflow run. Windows support is **not yet verified**: the latest Windows job was cancelled while in progress, so do not claim the feature works or publish installation instructions as validated yet.

Latest run:

```text
https://github.com/anlaki-py/rrs/actions/runs/30825705253
status: completed
conclusion: cancelled
Ubuntu Node 20: success
Ubuntu Node 24: success
Windows Node 24: cancelled
release: cancelled
```

Pushing this handoff commit will itself trigger a new workflow run, so check `gh run list` before acting; that new run may supersede run `30825705253`.

The latest published release is still `v0.1.4`, which predates all Windows support commits:

```text
https://github.com/anlaki-py/rrs/releases/tag/v0.1.4
```

No Windows-capable release has been produced yet.

## Files involved

- `src/shell.ts` — platform shell selection, node-pty launch, and platform-specific termination. Windows shell candidates are at `src/shell.ts:17`; spawn logic at `src/shell.ts:31`; Windows `taskkill.exe /T /F` cleanup at `src/shell.ts:63`.
- `src/server.ts` — creates PTY sessions and calls `terminateShell`; shell exit closes without terminating an already-exited PTY.
- `src/client.ts` — raw terminal client; now listens to the cross-platform stdout `resize` event at `src/client.ts:177` instead of Unix-only `SIGWINCH`.
- `src/updater.ts` — chooses `npm.cmd` on Windows at `src/updater.ts:62`.
- `package.json` — permits `linux` and `win32`; has separate `test:linux` and `test:windows` commands at lines 27-28.
- `scripts/run-platform-tests.ts` — makes `npm test` select the platform-specific suite.
- `scripts/check-package.ts` — cross-platform npm tarball content validation.
- `test/support/server.ts` — shared server/WebSocket integration helpers.
- `test/support/terminal.ts` — shared client PTY integration helpers.
- `test/integration/server.test.ts` — platform-neutral HTTP and authentication tests.
- `test/integration/server-linux.test.ts` — Bash prompt, command, resize, and disconnect lifecycle.
- `test/integration/server-windows.test.ts` — PowerShell prompt, command, resize, and disconnect lifecycle.
- `test/integration/terminal-linux.test.ts` — Linux client raw-mode cleanup.
- `test/integration/terminal-windows.test.ts` — Windows client raw-mode cleanup.
- `.github/workflows/ci-release.yml` — Ubuntu Node 20/24 plus Windows Node 24 matrix; Windows suite is invoked at lines 39-41.
- `README.md` — documents Linux and Windows requirements and PowerShell usage, but this documentation is pending successful Windows CI.

## What's changed this session

Commits pushed during the Windows work:

```text
69730ab Support Windows servers and clients
7ea6b92 Avoid Windows ConPTY cleanup race
46230dc Terminate Windows shell trees without ConPTY leaks
```

Key changes:

- Removed npm's Linux-only restriction and added `win32`.
- Added PowerShell 7 -> Windows PowerShell fallback with node-pty ConPTY.
- Changed PTY termination to platform-neutral logic.
- Changed client resize tracking from `SIGWINCH` to stdout's `resize` event.
- Changed updater subprocess from `npm` to `npm.cmd` on Windows.
- Added Windows package installation smoke checks.
- Split Linux and Windows tests into distinct files and npm scripts.
- Updated Actions from checkout/setup-node v4 to v5.
- Updated README with PowerShell examples and Windows build requirements.

## Constraints and things to avoid

- Do not run the PTY integration test suite in the current local environment. The user explicitly requested that CI perform Windows tests; local test runs were hanging/intermittent.
- Keep Linux and Windows integration tests physically and operationally separate. Do not merge platform branches back into one PTY test file.
- Do not remove Linux Bash's packaged `bin/rrs.bashrc` visible-prompt behavior.
- Do not publish or claim Windows support until the Windows Actions job and release job both pass.
- Do not reintroduce Python; this is a TypeScript/Node project only.
- Keep PowerShell selection automatic: `pwsh.exe` first, `powershell.exe` fallback. The user declined an `RRS_SHELL` override.
- Keep Windows baseline at ConPTY-capable Windows 10 1809+ / Server 2019+.
- Do not add runtime dependencies unless evidence requires one.

## What's been tried and failed

### node-pty default `pty.kill()` on Windows

The first Windows run executed the PowerShell test successfully, then emitted this error from node-pty and hung:

```text
D:\a\rrs\rrs\node_modules\node-pty\src\conpty_console_list_agent.ts:13
const consoleProcessList = getConsoleProcessList(shellPid);
                           ^
Error: AttachConsole failed
```

This occurred in runs based on `69730ab`. node-pty's default ConPTY kill path starts an external console-list helper and races it against process teardown.

### `useConptyDll: true`

Commit `7ea6b92` enabled node-pty's bundled ConPTY DLL. It removed the visible `AttachConsole failed` error, but the Windows suite still remained stuck after:

```text
✔ serves an interactive PowerShell ConPTY with prompt and resize support
```

The likely cause is node-pty's DLL kill path waiting for output before disposing its ConPTY worker. That run was cancelled; do not retry this option without new evidence.

### Current `taskkill.exe` approach

Commit `46230dc` reverted `useConptyDll` and changed Windows teardown to:

```text
taskkill.exe /PID <pty.pid> /T /F
```

The intent is to terminate the PowerShell process tree externally and let ConPTY observe a normal process exit, avoiding both node-pty kill implementations. The corresponding CI run was cancelled before Windows validation completed. This approach is unverified, not known-failed.

### Local test execution

A combined local suite intermittently failed/hung around the PTY integration test. The tests were subsequently split and serialized, but the user instructed the agent not to run them locally. Linux Actions jobs pass reliably.

## Other learnings

- `node-pty` 1.1.0 officially supports Windows ConPTY on Windows 1809+.
- On Windows node-pty output is UTF-8 strings even though Linux uses `encoding: null` for raw Buffer output; `PtyWithRawData` intentionally accepts both.
- npm global binaries on Windows are command shims at `<prefix>\rrs.cmd`, not `<prefix>/bin/rrs`.
- `npm.cmd` must be used when spawning npm without a shell on Windows.
- The GitHub Windows image has PowerShell 7, so the CI integration test exercises `pwsh.exe`, not the fallback.
- The two latest interrupted workflow runs show `cancelled`, not `failure`; inspect job timing/logs rather than assuming the taskkill implementation passed or failed.

## Next steps

1. Check whether the handoff commit's workflow is still running. If no newer run exists, re-run workflow `30825705253`. Do not run platform PTY tests locally.
2. Watch only the Windows `Run Windows tests` step. It should proceed past `server-windows.test.ts` into `terminal-windows.test.ts`, TLS, build, package inspection, and Windows installation smoke test.
3. If it still hangs after the PowerShell server test, inspect open handles/processes rather than switching back to either known-bad node-pty kill path. Focus on whether `taskkill.exe` exits, whether node-pty emits `onExit`, and whether ConPTY worker threads dispose after external process termination.
4. Consider adding an explicit timeout around each Windows test process at the npm/CI boundary so failures terminate with logs instead of consuming the entire Actions timeout. Do not hide leaked handles with forced `process.exit()` unless the underlying server cleanup is proven correct.
5. Once Windows and Linux quality jobs pass, verify the release job creates the next `v0.1.<run-number>` release and that `rrs.tgz` installs on Windows.
6. Manually smoke-test from PowerShell:

```powershell
npm install --global https://github.com/anlaki-py/rrs/releases/latest/download/rrs.tgz
$env:RRS_TOKEN = 'secret'
rrs serve
```

Then connect from a second Windows Terminal/PowerShell instance and verify prompt, commands, resize, disconnect, and `rrs update`.

## How to verify current state

Run these first in a fresh session:

```sh
git status --short
git log --oneline -6
gh run list --workflow='CI and release' --limit 5
gh api repos/anlaki-py/rrs/releases/latest --jq '{tag_name,html_url,assets:[.assets[].name]}'
```

Expected before this handoff commit:

- Working tree clean except newly created `handoff.md`.
- HEAD `46230dc Terminate Windows shell trees without ConPTY leaks`.
- Latest Windows-support workflow run `30825705253` cancelled.
- Latest release `v0.1.4`, without Windows support.

Safe non-runtime checks if needed:

```sh
npm run typecheck
npm run build
git diff --check
```

Do not run `npm test`, `npm run test:linux`, or `npm run test:windows` in the current local environment; use GitHub Actions as requested by the user.
