import { spawn } from "node:child_process";

const LATEST_RELEASE_API = "https://api.github.com/repos/anlaki-py/rrs/releases/latest";
const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export interface LatestRelease {
  version: string;
  downloadUrl: string;
}

export interface UpdateResult extends LatestRelease {
  updated: boolean;
}

type FetchRelease = (input: string, init: RequestInit) => Promise<Response>;
type InstallRelease = (downloadUrl: string) => Promise<void>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fetchLatestRelease(fetchRelease: FetchRelease = fetch): Promise<LatestRelease> {
  let response: Response;
  try {
    response = await fetchRelease(LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "rrs-updater",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`unable to check for updates: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`unable to check for updates: GitHub returned HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("unable to check for updates: GitHub returned invalid JSON");
  }

  if (!isRecord(body) || typeof body.tag_name !== "string" || !Array.isArray(body.assets)) {
    throw new Error("unable to check for updates: GitHub returned invalid release metadata");
  }
  const match = RELEASE_TAG_PATTERN.exec(body.tag_name);
  if (!match) throw new Error("unable to check for updates: latest release has an invalid version tag");
  if (!body.assets.some((asset) => isRecord(asset) && asset.name === "rrs.tgz")) {
    throw new Error("unable to check for updates: latest release has no rrs.tgz asset");
  }

  return {
    version: match[1]!,
    downloadUrl: `https://github.com/anlaki-py/rrs/releases/download/${body.tag_name}/rrs.tgz`,
  };
}

export function npmInvocation(
  platform: NodeJS.Platform = process.platform,
  commandShell = process.env.ComSpec ?? "cmd.exe",
): { command: string; argsPrefix: string[] } {
  if (platform === "win32") {
    return { command: commandShell, argsPrefix: ["/d", "/s", "/c", "npm.cmd"] };
  }
  return { command: "npm", argsPrefix: [] };
}

function installRelease(downloadUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const invocation = npmInvocation();
    const child = spawn(invocation.command, [...invocation.argsPrefix, "install", "--global", downloadUrl], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => reject(new Error(`unable to run npm: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `npm update was interrupted by ${signal}` : `npm update failed with exit code ${code}`));
    });
  });
}

export async function updateRrs(
  currentVersion: string,
  dependencies: { fetchRelease?: FetchRelease; installRelease?: InstallRelease } = {},
): Promise<UpdateResult> {
  const latest = await fetchLatestRelease(dependencies.fetchRelease);
  if (latest.version === currentVersion) return { ...latest, updated: false };

  await (dependencies.installRelease ?? installRelease)(latest.downloadUrl);
  return { ...latest, updated: true };
}
