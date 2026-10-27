import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import express from "express";
import type { AppUpdateRelease } from "@dietdigidose/contracts";
import { createAdminAppUpdatesRouter } from "../src/routes/admin/app-updates.js";
import {
  parseAllowedOrigins,
  readAppUpdateManifest,
  replaceManifestRelease,
  revokeManifestRelease,
  writeAppUpdateManifest,
} from "../src/services/appUpdateManifestService.js";

const sampleBytes = Buffer.from("apk content preview");
const sampleRelease: AppUpdateRelease = {
  schemaVersion: 1,
  platform: "android",
  applicationId: "com.dietdigidose.app.preview",
  channel: "preview",
  version: "1.0.6",
  snapshot: "26w44a",
  buildNumber: 264401,
  url: "https://dietdigidose.top/downloads/26w44a.apk",
  sizeBytes: sampleBytes.length,
  sha256: createHash("sha256").update(sampleBytes).digest("hex"),
  releaseNotes: "26w44a preview 更新说明",
  publishedAt: "2026-10-27T00:00:00.000Z",
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "diet-admin-updates-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function startServer(t: TestContext, options: Parameters<typeof createAdminAppUpdatesRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, role: "admin", username: "AdminTester" };
    next();
  });
  app.use("/admin", createAdminAppUpdatesRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return async (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${address.port}/admin${path}`, init);
}

test("parseAllowedOrigins extracts valid HTTPS origins and discards invalid", () => {
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(""), []);
  assert.deepEqual(
    parseAllowedOrigins("https://dietdigidose.top, http://insecure.example.com, https://cdn.dietdigidose.top"),
    ["https://dietdigidose.top", "https://cdn.dietdigidose.top"],
  );
});

test("readAppUpdateManifest handles unconfigured, missing, and existing manifests", async (t) => {
  const dir = await fixture(t);
  const unconfigured = await readAppUpdateManifest(undefined);
  assert.equal(unconfigured.configured, false);
  assert.deepEqual(unconfigured.manifest.releases, []);

  const missingPath = join(dir, "manifest.json");
  const missing = await readAppUpdateManifest(missingPath);
  assert.equal(missing.configured, true);
  assert.deepEqual(missing.manifest.releases, []);

  await writeAppUpdateManifest(missingPath, { schemaVersion: 1, releases: [sampleRelease] });
  const loaded = await readAppUpdateManifest(missingPath);
  assert.equal(loaded.configured, true);
  assert.equal(loaded.manifest.releases.length, 1);
  assert.deepEqual(loaded.manifest.releases[0], sampleRelease);
});

test("replaceManifestRelease and revokeManifestRelease maintain integrity and reject downgrades", () => {
  const initial = { schemaVersion: 1 as const, releases: [] };
  const withRelease = replaceManifestRelease(initial, sampleRelease);
  assert.equal(withRelease.releases.length, 1);

  // Downgrade rejected
  const downgradeRelease: AppUpdateRelease = {
    ...sampleRelease,
    snapshot: "26w43a",
    buildNumber: 264301,
  };
  assert.throws(
    () => replaceManifestRelease(withRelease, downgradeRelease),
    /不能发布低于或重复且不一致的构建编号版本/,
  );

  // Upgrade accepted
  const upgradedRelease: AppUpdateRelease = {
    ...sampleRelease,
    snapshot: "26w44b",
    buildNumber: 264402,
  };
  const upgraded = replaceManifestRelease(withRelease, upgradedRelease);
  assert.equal(upgraded.releases.length, 1);
  assert.equal(upgraded.releases[0].buildNumber, 264402);

  // Revoke removes channel
  const revoked = revokeManifestRelease(upgraded, "com.dietdigidose.app.preview", "preview");
  assert.equal(revoked.releases.length, 0);
});

test("createAdminAppUpdatesRouter handles GET, publish, and revoke operations", async (t) => {
  const dir = await fixture(t);
  const manifestPath = join(dir, "manifest.json");
  const allowedOrigins = "https://dietdigidose.top";

  const request = await startServer(t, { manifestPath, allowedOrigins });

  // 1. GET initial state
  const getRes = await request("/app-updates");
  assert.equal(getRes.status, 200);
  const initialBody = (await getRes.json()) as Record<string, any>;
  assert.equal(initialBody.configured, true);
  assert.deepEqual(initialBody.allowedOrigins, ["https://dietdigidose.top"]);
  assert.deepEqual(initialBody.manifest.releases, []);

  // 2. Reject publication from untrusted origin
  const untrustedRes = await request("/app-updates/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sampleRelease, url: "https://evil.attacker.com/app.apk" }),
  });
  assert.equal(untrustedRes.status, 400);

  // 3. Publish valid release
  const publishRes = await request("/app-updates/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sampleRelease),
  });
  assert.equal(publishRes.status, 200);
  const publishBody = (await publishRes.json()) as Record<string, any>;
  assert.equal(publishBody.success, true);
  assert.equal(publishBody.manifest.releases.length, 1);

  // 4. Verify file on disk
  const onDisk = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(onDisk.releases.length, 1);
  assert.equal(onDisk.releases[0].snapshot, "26w44a");

  // 5. Revoke release
  const revokeRes = await request("/app-updates/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId: "com.dietdigidose.app.preview",
      channel: "preview",
    }),
  });
  assert.equal(revokeRes.status, 200);
  const revokeBody = (await revokeRes.json()) as Record<string, any>;
  assert.equal(revokeBody.success, true);
  assert.equal(revokeBody.manifest.releases.length, 0);

  // 6. Revoke non-existent returns 404
  const revokeNonExistent = await request("/app-updates/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId: "com.dietdigidose.app.preview",
      channel: "preview",
    }),
  });
  assert.equal(revokeNonExistent.status, 404);
});
