import { createRequire } from "node:module";
import process from "node:process";

const cjsRequire = createRequire(import.meta.url);
const STD_INPUT_HANDLE = -10;
const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;

interface NativeLibrary {
  func(signature: string): (...args: unknown[]) => unknown;
}

interface KoffiModule {
  load(filename: string): NativeLibrary;
}

type LoadKoffi = () => KoffiModule;

const loadKoffi: LoadKoffi = () => cjsRequire("koffi") as KoffiModule;

/**
 * Make Windows console input arrive as VT bytes, including SGR mouse events.
 * Node's setRawMode(true) uses libuv's plain raw mode, which does not set
 * ENABLE_VIRTUAL_TERMINAL_INPUT on Windows.
 */
export function enableWindowsVirtualTerminalInput(
  platform: NodeJS.Platform = process.platform,
  load: LoadKoffi = loadKoffi,
): (() => void) | undefined {
  if (platform !== "win32") return () => {};

  try {
    const kernel32 = load().load("kernel32.dll");
    const getStdHandle = kernel32.func("void* __stdcall GetStdHandle(int)");
    const getConsoleMode = kernel32.func("bool __stdcall GetConsoleMode(void*, _Out_ uint32_t*)");
    const setConsoleMode = kernel32.func("bool __stdcall SetConsoleMode(void*, uint32_t)");
    const handle = getStdHandle(STD_INPUT_HANDLE);
    const mode = new Uint32Array(1);

    if (!getConsoleMode(handle, mode)) return undefined;
    const originalMode = mode[0]!;
    const virtualTerminalMode = originalMode | ENABLE_VIRTUAL_TERMINAL_INPUT;
    if (virtualTerminalMode !== originalMode && !setConsoleMode(handle, virtualTerminalMode)) return undefined;

    return () => {
      if (virtualTerminalMode !== originalMode) setConsoleMode(handle, originalMode);
    };
  } catch {
    return undefined;
  }
}
