import assert from "node:assert/strict";
import test from "node:test";
import { fetchLatestRelease, updateRrs } from "../../src/updater.js";

function releaseResponse(tag = "v1.2.3", assets: unknown[] = [{ name: "rrs.tgz" }]): Response {
  return Response.json({ tag_name: tag, assets });
}

test("resolves the immutable tarball URL from GitHub release metadata", async () => {
  const latest = await fetchLatestRelease(async (url, init) => {
    assert.equal(url, "https://api.github.com/repos/anlaki-py/rrs/releases/latest");
    assert.equal((init.headers as Record<string, string>)["User-Agent"], "rrs-updater");
    return releaseResponse();
  });
  assert.deepEqual(latest, {
    version: "1.2.3",
    downloadUrl: "https://github.com/anlaki-py/rrs/releases/download/v1.2.3/rrs.tgz",
  });
});

test("does not reinstall an already-current release", async () => {
  let installs = 0;
  const result = await updateRrs("1.2.3", {
    fetchRelease: async () => releaseResponse(),
    installRelease: async () => {
      installs += 1;
    },
  });
  assert.equal(result.updated, false);
  assert.equal(installs, 0);
});

test("installs a newer release from its versioned URL", async () => {
  const installed: string[] = [];
  const result = await updateRrs("1.2.2", {
    fetchRelease: async () => releaseResponse(),
    installRelease: async (url) => {
      installed.push(url);
    },
  });
  assert.equal(result.updated, true);
  assert.deepEqual(installed, ["https://github.com/anlaki-py/rrs/releases/download/v1.2.3/rrs.tgz"]);
});

test("rejects failed and malformed GitHub responses", async () => {
  await assert.rejects(
    fetchLatestRelease(async () => new Response("rate limited", { status: 403 })),
    /GitHub returned HTTP 403/,
  );
  await assert.rejects(fetchLatestRelease(async () => Response.json({})), /invalid release metadata/);
  await assert.rejects(fetchLatestRelease(async () => releaseResponse("latest")), /invalid version tag/);
  await assert.rejects(fetchLatestRelease(async () => releaseResponse("v1.2.3", [])), /no rrs\.tgz asset/);
});

test("propagates npm installation failures", async () => {
  await assert.rejects(
    updateRrs("1.2.2", {
      fetchRelease: async () => releaseResponse(),
      installRelease: async () => {
        throw new Error("npm permission denied");
      },
    }),
    /npm permission denied/,
  );
});
