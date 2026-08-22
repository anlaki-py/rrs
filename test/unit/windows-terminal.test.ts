import assert from "node:assert/strict";
import test from "node:test";
import { enableWindowsVirtualTerminalInput } from "../../src/windows-terminal.js";

test("does not load Windows console APIs on other platforms", () => {
  let loaded = false;
  const restore = enableWindowsVirtualTerminalInput("linux", () => {
    loaded = true;
    throw new Error("must not load");
  });
  restore();
  assert.equal(loaded, false);
});

test("enables Windows VT input and restores the original console mode", () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const originalMode = 0x0088;
  const functions = new Map<string, (...args: unknown[]) => unknown>([
    ["void* __stdcall GetStdHandle(int)", (...args) => (calls.push(["getHandle", ...args]), 123)],
    [
      "bool __stdcall GetConsoleMode(void*, _Out_ uint32_t*)",
      (...args) => {
        calls.push(["getMode", ...args]);
        (args[1] as Uint32Array)[0] = originalMode;
        return true;
      },
    ],
    ["bool __stdcall SetConsoleMode(void*, uint32_t)", (...args) => (calls.push(["setMode", ...args]), true)],
  ]);
  const restore = enableWindowsVirtualTerminalInput("win32", () => ({
    load: (filename) => {
      assert.equal(filename, "kernel32.dll");
      return { func: (signature) => functions.get(signature)! };
    },
  }));

  assert.deepEqual(calls.map(([name, ...args]) => [name, ...args.filter((arg) => !(arg instanceof Uint32Array))]), [
    ["getHandle", -10],
    ["getMode", 123],
    ["setMode", 123, originalMode | 0x0200],
  ]);
  restore();
  assert.deepEqual(calls.at(-1), ["setMode", 123, originalMode]);
});

test("gracefully degrades when Windows console APIs are unavailable", () => {
  const restore = enableWindowsVirtualTerminalInput("win32", () => {
    throw new Error("no native module");
  });
  assert.equal(restore, undefined);
});
