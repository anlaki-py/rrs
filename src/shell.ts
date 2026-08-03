import { spawn as spawnProcess, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawn as spawnPty, type IDisposable, type IPty, type IPtyForkOptions, type IWindowsPtyForkOptions } from "node-pty";

const BASH_RCFILE = fileURLToPath(new URL("../bin/rrs.bashrc", import.meta.url));

export interface ShellLaunch {
  file: string;
  args: string[];
  windowsOptions?: IWindowsPtyForkOptions;
}

export type PtyWithRawData = Omit<IPty, "onData"> & {
  readonly onData: (listener: (data: Buffer | string) => void) => IDisposable;
};

export function shellCandidates(platform: NodeJS.Platform = process.platform): ShellLaunch[] {
  if (platform === "linux") {
    return [{ file: "bash", args: ["--rcfile", BASH_RCFILE, "-i"] }];
  }
  if (platform === "win32") {
    const windowsOptions: IWindowsPtyForkOptions = { useConpty: true };
    return [
      { file: "pwsh.exe", args: ["-NoLogo"], windowsOptions },
      { file: "powershell.exe", args: ["-NoLogo"], windowsOptions },
    ];
  }
  throw new Error(`unsupported operating system: ${platform}`);
}

export function spawnShell(platform: NodeJS.Platform = process.platform): PtyWithRawData {
  const environment = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
  const commonOptions: IPtyForkOptions = {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: environment,
    ...(platform === "linux" ? { encoding: null } : {}),
  };
  let lastError: unknown = new Error(`no supported shell was found for ${platform}`);

  for (const candidate of shellCandidates(platform)) {
    if (
      platform === "win32" &&
      spawnSync("where.exe", [candidate.file], { stdio: "ignore", windowsHide: true }).status !== 0
    ) {
      continue;
    }
    try {
      return spawnPty(candidate.file, candidate.args, {
        ...commonOptions,
        ...candidate.windowsOptions,
      }) as PtyWithRawData;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function terminateShell(pty: Pick<IPty, "pid" | "kill">, platform: NodeJS.Platform = process.platform): void {
  if (platform !== "win32") {
    pty.kill();
    return;
  }

  // node-pty's ConPTY kill path races an AttachConsole helper against process
  // teardown. taskkill terminates the process tree and lets ConPTY observe exit.
  const terminator = spawnProcess("taskkill.exe", ["/PID", String(pty.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  terminator.once("error", () => {
    try {
      process.kill(pty.pid);
    } catch {
      // The shell may already have exited.
    }
  });
}
