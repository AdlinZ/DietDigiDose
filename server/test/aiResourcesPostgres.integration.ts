import assert from "node:assert/strict";
import { Pool } from "pg";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { PostgresAIRuntimeRepository } from "../src/modules/aiRuntime/postgresRepository.js";
import { legacyResourceDocument, RESOURCE_SETTING_KEY, type ResourceUpdate } from "../src/modules/aiRuntime/resources.js";

// Deliberately never use DATABASE_URL: this check is destructive only inside a fresh, isolated test cluster.
const socket = process.env.AI_RESOURCE_TEST_PG_SOCKET;
assert.ok(socket?.startsWith("/tmp/ddd-review-pg."), "Use a dedicated /tmp/ddd-review-pg.* cluster");
const pool = new Pool({ host: socket, port: 55439, user: process.env.USER, database: "ddd_ai_resources_review" });
try {
  if (process.argv.includes("--verify-restart")) {
    const service = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), { AI_API_KEY: "pg-environment-fixture" });
    const raw = (await service.settings())[RESOURCE_SETTING_KEY];
    assert.equal(JSON.parse(raw).revision, 5);
    assert.equal((await service.config()).chat.model, "legacy-model");
    assert.equal((await service.agentConfig("RECIPE")).model, "recipe-model");
    await service.migrateResources();
    assert.equal((await service.settings())[RESOURCE_SETTING_KEY], raw);
    assert.match(JSON.stringify((await service.resourceConfiguration()).effective.search), /"status":"unverified"/);
    assert.match(JSON.stringify((await service.resourceConfiguration()).effective.fetch), /"status":"disabled"/);
    assert.equal((await service.toolConfig("search")).apiKey, "pg-persisted-fixture-secret");
    console.log("PostgreSQL persisted configuration after actual cluster restart passed");
  } else {
  await pool.query("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)");
  const repository = new PostgresAIRuntimeRepository(pool);
  const service = new AIRuntimeService(repository, { AI_API_KEY: "pg-environment-fixture" });
  await service.saveSettings([{ key: "AI_MODEL", value: "legacy-model" }, { key: "AI_RECIPE_MODEL", value: "recipe-model" }]);
  const before = await service.config();
  await Promise.all([service.migrateResources(), service.migrateResources()]);
  const initial = (await service.settings())[RESOURCE_SETTING_KEY];
  assert.deepEqual(await service.config(), before);
  assert.equal(await repository.compareAndSaveSetting(RESOURCE_SETTING_KEY, null, "{}"), false);
  const update = legacyResourceDocument();
  const results = await Promise.allSettled([service.saveResourceConfiguration(update), service.saveResourceConfiguration(update)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  let saved = (await service.settings())[RESOURCE_SETTING_KEY];
  assert.notEqual(saved, initial);
  assert.equal(JSON.parse(saved).revision, 1);
  const restarted = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), { AI_API_KEY: "pg-environment-fixture" });
  await restarted.migrateResources();
  assert.deepEqual(await restarted.config(), before);
  assert.equal((await restarted.agentConfig("RECIPE")).model, "recipe-model");
  assert.equal((await restarted.settings())[RESOURCE_SETTING_KEY], saved);
  const toolUpdate: ResourceUpdate = { ...legacyResourceDocument(), revision: 1,
    resources: [...legacyResourceDocument().resources, { id: "web", name: "PG tool fixture", kind: "tool", protocol: "deepseek-tools", baseUrl: "https://api.deepseek.com", tools: ["search", "fetch"], credential: { action: "replace", value: "pg-replaced-fixture-secret" } }],
    defaults: { ...legacyResourceDocument().defaults, search: { resourceId: "web" }, fetch: { resourceId: "web" } },
    services: { ...legacyResourceDocument().services, search: { inherit: true }, fetch: { resourceId: "web" } },
  };
  const tool = toolUpdate.resources.at(-1)!;
  assert.ok(tool.kind === "tool");
  for (const action of ["replace", "keep", "clear", "replace"] as const) {
    const expected = toolUpdate.revision === 4 ? "pg-persisted-fixture-secret" : action === "clear" ? "" : "pg-replaced-fixture-secret";
    tool.credential = action === "replace" ? { action, value: expected } : { action };
    const result = await service.saveResourceConfiguration(toolUpdate);
    toolUpdate.revision = result.revision;
    assert.equal((await service.toolConfig("search")).apiKey, expected);
    assert.match(JSON.stringify(result.effective.fetch), /"status":"disabled"/);
    assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
    assert.deepEqual(result.defaults.fetch, { resourceId: "web" });
  }
  saved = (await service.settings())[RESOURCE_SETTING_KEY];
  await pool.query(`CREATE FUNCTION reject_resource_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture write failure'; END $$`);
  await pool.query(`CREATE TRIGGER reject_resource_update BEFORE UPDATE ON system_settings FOR EACH ROW WHEN (NEW.key = '${RESOURCE_SETTING_KEY}') EXECUTE FUNCTION reject_resource_update()`);
  await assert.rejects(restarted.saveResourceConfiguration(toolUpdate), /fixture write failure/);
  assert.equal((await restarted.settings())[RESOURCE_SETTING_KEY], saved);
  assert.deepEqual(await restarted.config(), before);
  console.log("PostgreSQL real-cluster migration/CAS/concurrent save/reopen/rollback checks passed");
  }
} finally {
  await pool.end();
}
