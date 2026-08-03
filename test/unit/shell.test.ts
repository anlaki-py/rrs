import assert from "node:assert/strict";
import test from "node:test";
import { shellCandidates } from "../../src/shell.js";

test("selects interactive Bash with the packaged rcfile on Linux", () => {
  const candidates = shellCandidates("linux");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.file, "bash");
  assert.match(candidates[0]!.args.join(" "), /bin[/\\]rrs\.bashrc/);
  assert.equal(candidates[0]!.args.at(-1), "-i");
});

test("prefers PowerShell 7 and falls back to Windows PowerShell with ConPTY", () => {
  assert.deepEqual(shellCandidates("win32"), [
    { file: "pwsh.exe", args: ["-NoLogo"], windowsOptions: { useConpty: true } },
    { file: "powershell.exe", args: ["-NoLogo"], windowsOptions: { useConpty: true } },
  ]);
});

test("rejects unsupported operating systems", () => {
  assert.throws(() => shellCandidates("darwin"), /unsupported operating system/);
});
