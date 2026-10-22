import assert from "node:assert/strict";
import { Pool } from "pg";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { PostgresAIRuntimeRepository } from "../src/modules/aiRuntime/postgresRepository.js";
import { legacyResourceDocument, RESOURCE_SETTING_KEY } from "../src/modules/aiRuntime/resources.js";

// Deliberately never use DATABASE_URL: this check is destructive only inside a fresh, isolated test cluster.
const socket = process.env.AI_RESOURCE_TEST_PG_SOCKET;
assert.ok(socket?.startsWith("/tmp/ddd-review-pg."), "Use a dedicated /tmp/ddd-review-pg.* cluster");
const pool = new Pool({ host: socket, port: 55439, user: process.env.USER, database: "ddd_ai_resources_review" });
try {
  if (process.argv.includes("--verify-restart")) {
    const service = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), { AI_API_KEY: "pg-environment-fixture" });
    const raw = (await service.settings())[RESOURCE_SETTING_KEY];
    assert.equal(JSON.parse(raw).revision, 1);
    assert.equal((await service.config()).chat.model, "legacy-model");
    assert.equal((await service.agentConfig("RECIPE")).model, "recipe-model");
    await service.migrateResources();
    assert.equal((await service.settings())[RESOURCE_SETTING_KEY], raw);
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
  const saved = (await service.settings())[RESOURCE_SETTING_KEY];
  assert.notEqual(saved, initial);
  assert.equal(JSON.parse(saved).revision, 1);
  const restarted = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), { AI_API_KEY: "pg-environment-fixture" });
  await restarted.migrateResources();
  assert.deepEqual(await restarted.config(), before);
  assert.equal((await restarted.agentConfig("RECIPE")).model, "recipe-model");
  assert.equal((await restarted.settings())[RESOURCE_SETTING_KEY], saved);
  await pool.query(`CREATE FUNCTION reject_resource_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture write failure'; END $$`);
  await pool.query(`CREATE TRIGGER reject_resource_update BEFORE UPDATE ON system_settings FOR EACH ROW WHEN (NEW.key = '${RESOURCE_SETTING_KEY}') EXECUTE FUNCTION reject_resource_update()`);
  update.revision = 1;
  await assert.rejects(restarted.saveResourceConfiguration(update), /fixture write failure/);
  assert.equal((await restarted.settings())[RESOURCE_SETTING_KEY], saved);
  assert.deepEqual(await restarted.config(), before);
  console.log("PostgreSQL real-cluster migration/CAS/concurrent save/reopen/rollback checks passed");
  }
} finally {
  await pool.end();
}
