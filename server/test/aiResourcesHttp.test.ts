import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { legacyResourceDocument } from "../src/modules/aiRuntime/resources.js";

const directory = mkdtempSync(join(tmpdir(), "ai-resources-http-"));
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_DRIVER: "sqlite", DATABASE_URL: "", DATABASE_PATH: join(directory, "test.db"),
  JWT_SECRET: "resource-http-fixture-jwt-secret-over-32-characters", ADMIN_INITIAL_PASSWORD: "AdminPassword1234",
  ENABLE_DEMO_SEED: "0", REGISTER_RATE_LIMIT: "1000", REGISTER_GLOBAL_RATE_LIMIT: "5000",
});
let server: Server;
let db: typeof import("../src/storage/db.js").db;
let baseUrl: string;
async function request(path: string, method = "GET", token?: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
before(async () => {
  const { createApp } = await import("../src/app.js");
  db = (await import("../src/storage/db.js")).db;
  const app = await createApp();
  await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db?.close();
  rmSync(directory, { recursive: true, force: true });
});

test("resource routes require a current admin session and never serialize credentials or invalid input", async () => {
  const regular = await request("/auth/register", "POST", undefined, { identifier: "resource-review@example.test", username: "review", password: "Password1234" });
  assert.equal(regular.status, 201);
  const login = await request("/auth/login", "POST", undefined, { identifier: "admin", password: "AdminPassword1234" });
  assert.equal(login.status, 200);
  for (const [path, method] of [["/admin/ai-config/resources", "GET"], ["/admin/ai-config/resources", "PUT"], ["/admin/ai-config/resources/migrate", "POST"]]) {
    assert.equal((await request(path, method)).status, 401);
    assert.equal((await request(path, method, regular.body.token)).status, 403);
    assert.equal((await request(path, method, login.body.token)).status, 403); // initial password must change
  }
  db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
  const token = login.body.token;
  const migrated = await request("/admin/ai-config/resources/migrate", "POST", token);
  assert.equal(migrated.status, 200);
  const document = legacyResourceDocument();
  const secret = "isolated-resource-fixture-SECRET";
  const update = { ...document, resources: [...document.resources, {
    id: "review", kind: "connection", name: "review", protocol: "openai-compatible", baseUrl: "https://fixture.invalid/v1",
    models: [{ id: "review-model", capabilities: ["chat"] }], credential: { action: "replace", value: secret },
  }, {
    id: "web", kind: "tool", name: "Synthetic web", protocol: "deepseek-tools", baseUrl: "https://api.deepseek.com",
    tools: ["search", "fetch"], credential: { action: "replace", value: secret },
  }], services: { ...document.services, chat: { resourceId: "review", model: "review-model" }, search: { resourceId: "web" }, fetch: { resourceId: "web" } } };
  const saved = await request("/admin/ai-config/resources", "PUT", token, update);
  assert.equal(saved.status, 200);
  const publicTools = await request("/admin/ai-config/resources", "GET", token);
  assert.equal(publicTools.body.effective.search.status, "unverified");
  assert.equal(publicTools.body.effective.fetch.status, "disabled");
  for (const result of [saved, await request("/admin/ai-config/resources", "GET", token), await request("/admin/ai-config", "GET", token)]) {
    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result.body).includes(secret), false);
    assert.equal(JSON.stringify(result.body).includes('"apiKey"'), false);
  }
  const invalid = await request("/admin/ai-config/resources", "PUT", token, { ...update, revision: 1, invalidSecret: secret });
  assert.equal(invalid.status, 400);
  assert.equal(JSON.stringify(invalid.body).includes(secret), false);
  assert.equal((await request("/admin/ai-config/resources", "PUT", token, update)).status, 400); // stale revision
  const audits = db.prepare("SELECT summary FROM admin_audit_logs WHERE action LIKE 'ai_resources.%'").all();
  assert.ok(audits.length >= 2);
  assert.equal(JSON.stringify(audits).includes(secret), false);
  db.prepare("UPDATE users SET session_version = session_version + 1 WHERE username = 'admin'").run();
  assert.equal((await request("/admin/ai-config/resources", "GET", token)).status, 401);
});
