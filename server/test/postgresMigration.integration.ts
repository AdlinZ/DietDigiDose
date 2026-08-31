import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PostgresFeedbackRepository } from "../src/modules/feedback/postgresRepository.js";
import { PostgresFoodRepository } from "../src/modules/foods/postgresRepository.js";
import { PostgresHealthRepository } from "../src/modules/health/postgresRepository.js";
import { PostgresInventoryRepository } from "../src/modules/inventory/postgresRepository.js";
import { PostgresShoppingRepository } from "../src/modules/shopping/postgresRepository.js";
import { PostgresWorkerRepository } from "../src/modules/worker/postgresRepository.js";
import { WorkerRuntime } from "../src/modules/worker/service.js";
import {
  exportMigrationArchive,
  importMigrationArchive,
  validateMigrationTarget,
  type BaselineManifest,
} from "../src/storage/database/postgres/migration.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectionString = process.env.POSTGRES_MIGRATION_TEST_URL?.trim();
if (!connectionString) throw new Error("POSTGRES_MIGRATION_TEST_URL is required");
const baseline = JSON.parse(fs.readFileSync(
  path.join(serverRoot, "src", "storage", "database", "postgres", "baseline-manifest.json"),
  "utf8",
)) as BaselineManifest;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-postgres-integration-"));
const sqlitePath = path.join(temporaryDirectory, "source.db");
const archiveDirectory = path.join(temporaryDirectory, "archive");

process.env.ADMIN_INITIAL_PASSWORD = "integration-only-not-a-secret-1234";
process.env.DATABASE_PATH = sqlitePath;
process.env.ENABLE_DEMO_SEED = "0";
process.env.NODE_ENV = "test";

const sqliteModule = await import("../src/storage/db.js");
sqliteModule.initDatabase();
const user = sqliteModule.db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get() as { id: number };
sqliteModule.db.prepare(`
  INSERT INTO inventory_items
    (user_id, food_name, category, quantity, expiration_date, quantity_value, quantity_unit, is_available)
  VALUES (?, '番茄', '蔬菜', '250g', '2026-09-10', 250, 'g', 1)
`).run(user.id);
sqliteModule.db.prepare(`
  INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, recorded_at)
  VALUES (?, 'lunch', '番茄', '250g', 45, '2026-09-01')
`).run(user.id);
sqliteModule.db.prepare(`
  INSERT INTO health_logs (user_id, weight, recorded_date) VALUES (?, 62.5, '2026-09-01')
`).run(user.id);
sqliteModule.db.prepare(`
  INSERT INTO ai_usage_logs (user_id, endpoint, model, total_tokens, success)
  VALUES (?, '/integration', 'test-model', 321, 1)
`).run(user.id);
sqliteModule.db.close();

const source = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const archive = exportMigrationArchive({ database: source, sqlitePath, outputDirectory: archiveDirectory, baseline });
source.close();

const pool = new Pool({ connectionString, max: 6 });
try {
  const existing = await pool.query(`
    SELECT COUNT(*)::integer AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  assert.equal(existing.rows[0]?.count, 0, "PostgreSQL migration integration database must be empty");

  await migrate(drizzle(pool), { migrationsFolder: path.join(serverRoot, "drizzle") });
  const first = await pool.connect();
  try {
    await importMigrationArchive(first, archiveDirectory, baseline);
    await importMigrationArchive(first, archiveDirectory, baseline);
  } finally {
    first.release();
  }

  const concurrentClients = await Promise.all([pool.connect(), pool.connect()]);
  try {
    await Promise.all(concurrentClients.map((client) => importMigrationArchive(client, archiveDirectory, baseline)));
  } finally {
    concurrentClients.forEach((client) => client.release());
  }

  const validationClient = await pool.connect();
  let report;
  try {
    report = await validateMigrationTarget(validationClient, archiveDirectory, baseline);
  } finally {
    validationClient.release();
  }
  assert.equal(report.ok, true, report.failures.join("\n"));
  assert.equal(report.tableCount, 92);
  assert.equal(report.criticalMetrics["inventory.quantity_value"], 250);
  assert.equal(report.criticalMetrics["diet.calories"], 45);
  assert.equal(report.criticalMetrics["health.weight"], 62.5);
  assert.equal(report.criticalMetrics["ai.total_tokens"], 321);

  const inventoryRepository = new PostgresInventoryRepository(pool);
  const migratedItems = await inventoryRepository.list(user.id);
  const migratedTomato = migratedItems.find((item) => item.food_name === "番茄")!;
  assert.equal(migratedTomato.quantity_value, 250);
  const created = await inventoryRepository.create(user.id, {
    food_name: "牛奶",
    category: "乳制品",
    quantity: "500ml",
    expiration_date: "2026-09-08",
    storage_location: "冷藏",
    quantity_value: 500,
    quantity_unit: "ml",
  });
  const imported = await Promise.all([0, 1].map(() => inventoryRepository.importShoppingList(user.id, {
    idempotency_key: "postgres-concurrent-import-0001",
    items: [{
      food_name: "土豆",
      category: "蔬菜",
      quantity: "2piece",
      expiration_date: "2026-09-15",
      storage_location: "常温",
      quantity_value: 2,
      quantity_unit: "piece",
    }],
  })));
  assert.deepEqual(imported.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(imported[0]!.items[0]!.id, imported[1]!.items[0]!.id);
  const consumed = await inventoryRepository.consume(user.id, {
    idempotency_key: "postgres-consume-0001",
    source: "cooking",
    items: [{ item_id: migratedTomato.id, version: migratedTomato.version, mode: "amount", amount_value: 50, unit: "g" }],
  });
  assert.equal(consumed.items[0]!.quantity_value, 200);
  const repeatedConsumption = await inventoryRepository.consume(user.id, {
    idempotency_key: "postgres-consume-0001",
    source: "cooking",
    items: [{ item_id: migratedTomato.id, version: migratedTomato.version, mode: "amount", amount_value: 50, unit: "g" }],
  });
  assert.equal(repeatedConsumption.repeated, true);
  assert.equal(repeatedConsumption.items[0]!.quantity_value, 200);
  const updated = await inventoryRepository.update(user.id, created.id, created.version, {
    nextQuantityValue: 500,
    nextQuantityUnit: "ml",
    patch: { storage_location: "冷冻", version: created.version },
  });
  assert.equal(updated.kind, "updated");
  if (updated.kind === "updated") assert.equal(updated.item.storage_location, "冷冻");
  const history = await inventoryRepository.history(user.id, migratedTomato.id);
  assert(history?.some((entry) => entry.action === "consume_partial"));
  assert.deepEqual(await inventoryRepository.remove(user.id, created), { kind: "removed" });

  const feedbackRepository = new PostgresFeedbackRepository(pool);
  const feedbackId = await feedbackRepository.create(user.id, {
    category: "suggestion",
    content: "希望增加批量录入功能",
    context: { page: "inventory", recipeId: 12 },
  });
  const feedback = await pool.query(`
    SELECT user_id, category, content, context_json, status
    FROM user_feedback WHERE id = $1
  `, [feedbackId]);
  assert.deepEqual(feedback.rows[0], {
    user_id: user.id,
    category: "suggestion",
    content: "希望增加批量录入功能",
    context_json: { page: "inventory", recipeId: 12 },
    status: "open",
  });

  const postgresFood = await pool.query(`
    INSERT INTO ingredients_library
      (name, category, calories_100g, protein_100g, carbs_100g, fat_100g, barcode,
       original_name, normalized_name, search_keywords, micronutrients_json, source, quality_status)
    VALUES
      ('Postgres 番茄', '蔬菜', 18, 0.9, 3.9, 0.2, '6900000000097',
       'Postgres tomato', 'postgres番茄', 'postgresfood', '{"vitaminC":13.7}'::jsonb, 'official', 'trusted')
    RETURNING id
  `);
  const postgresFoodId = Number(postgresFood.rows[0]!.id);
  await pool.query(`
    INSERT INTO ingredient_aliases (ingredient_id, alias, normalized_alias)
    VALUES ($1, 'PG tomato', 'postgresfoodalias')
  `, [postgresFoodId]);
  const foodRepository = new PostgresFoodRepository(pool);
  assert.equal((await foodRepository.findByBarcode("6900000000097"))?.name, "Postgres 番茄");
  const postgresFoodResults = await foodRepository.searchTrusted("postgresfoodalias", 10);
  assert.equal(postgresFoodResults.length, 1);
  assert.deepEqual(postgresFoodResults[0]!.micronutrients_json, { vitaminC: 13.7 });
  await foodRepository.recordSearchGap("postgresgap", " Postgres missing food ");
  await foodRepository.recordSearchGap("postgresgap", "Postgres missing food updated");
  const postgresGap = await pool.query(`
    SELECT sample_query, hit_count FROM ingredient_search_gaps WHERE normalized_query = 'postgresgap'
  `);
  assert.deepEqual(postgresGap.rows[0], { sample_query: "Postgres missing food updated", hit_count: 2 });
  const customFoodId = await foodRepository.createCustom(user.id, {
    name: "Postgres 家庭豆浆",
    calories_100g: 31,
    protein_100g: 3,
    carbs_100g: 1.2,
    fat_100g: 1.6,
  });
  const customFood = await pool.query("SELECT user_id, name, status FROM user_custom_foods WHERE id = $1", [customFoodId]);
  assert.deepEqual(customFood.rows[0], { user_id: user.id, name: "Postgres 家庭豆浆", status: "pending" });

  const healthRepository = new PostgresHealthRepository(pool);
  const healthUpserts = await Promise.all([
    healthRepository.upsertLog(user.id, "2026-09-02", { weight: 63.2 }),
    healthRepository.upsertLog(user.id, "2026-09-02", { water_ml: 1800, cycle_status: null }),
  ]);
  assert.deepEqual(healthUpserts.map((result) => result.created).sort(), [false, true]);
  const postgresHealthLogs = await healthRepository.listLogs(user.id, 30);
  const mergedHealthLog = postgresHealthLogs.filter((log) => log.recorded_date === "2026-09-02");
  assert.equal(mergedHealthLog.length, 1);
  assert.equal(mergedHealthLog[0]?.weight, 63.2);
  assert.equal(mergedHealthLog[0]?.water_ml, 1800);
  const postgresHealthProfile = await healthRepository.upsertProfile(user.id, {
    allergies_json: [{ name: "花生", type: "allergy", severity: "severe" }],
    medical_conditions_json: ["高血压"],
    kitchen_constraints_json: { servings: 2 },
    tracking_enabled: true,
  });
  assert.deepEqual(postgresHealthProfile.allergies_json, [{ name: "花生", type: "allergy", severity: "severe" }]);
  assert.deepEqual(postgresHealthProfile.medical_conditions_json, ["高血压"]);
  assert.equal(postgresHealthProfile.tracking_enabled, true);
  assert.equal(await healthRepository.removeLog(user.id + 1, Number(mergedHealthLog[0]?.id)), false);
  assert.equal(await healthRepository.removeLog(user.id, Number(mergedHealthLog[0]?.id)), true);

  const shoppingRepository = new PostgresShoppingRepository(pool);
  const shoppingItem = await shoppingRepository.create(
    "11111111-1111-4111-8111-111111111111",
    user.id,
    { name: "Postgres 番茄", amount: "2个", category: "蔬菜", checked: false },
  );
  assert.equal(shoppingItem.version, 1);
  assert.equal(await shoppingRepository.update(shoppingItem.id, user.id, { version: 2, checked: true }), null);
  const updatedShoppingItem = await shoppingRepository.update(shoppingItem.id, user.id, { version: 1, checked: true });
  assert.equal(updatedShoppingItem?.checked, true);
  const importShoppingItems = [
    {
      id: "22222222-2222-4222-8222-222222222222",
      clientId: "postgres-shopping-import-0001:牛奶:1盒",
      input: { name: "牛奶", amount: "1盒", category: "乳制品", checked: false },
    },
  ];
  await Promise.all([
    shoppingRepository.importItems(user.id, importShoppingItems),
    shoppingRepository.importItems(user.id, [{ ...importShoppingItems[0]!, id: "33333333-3333-4333-8333-333333333333" }]),
  ]);
  const postgresShoppingItems = await shoppingRepository.list(user.id);
  assert.equal(postgresShoppingItems.filter((item) => item.name === "牛奶").length, 1);
  assert.equal(await shoppingRepository.remove(shoppingItem.id, user.id + 1), false);
  assert.equal(await shoppingRepository.remove(shoppingItem.id, user.id), true);

  const workerRepository = new PostgresWorkerRepository(pool);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "postgres-worker-a", 60_000), true);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "postgres-worker-b", 60_000), false);
  await pool.query(`
    UPDATE worker_task_leases SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
    WHERE task_name = 'media-cleanup'
  `);
  assert.equal(await workerRepository.acquireLease("media-cleanup", "postgres-worker-b", 60_000), true);
  assert.equal(await workerRepository.releaseLease("media-cleanup", "postgres-worker-b"), true);
  const workerRuntime = new WorkerRuntime(workerRepository);
  const workerResult = await workerRuntime.run({
    taskName: "media-cleanup",
    workerId: "postgres-worker-runtime",
    run: async () => ({ processed: 3, succeeded: 3, failed: 0, details: { source: "postgres-integration" } }),
  });
  assert.equal(workerResult.status, "completed");
  const workerPage = await workerRepository.listRuns({
    taskName: "media-cleanup",
    status: "completed",
    page: 1,
    pageSize: 10,
  });
  const workerRun = workerPage.items.find((item) => item.id === workerResult.runId);
  assert.deepEqual(workerRun?.result, { source: "postgres-integration" });
  assert.equal(workerRun?.processed, 3);

  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dietdigidose_app_test') THEN
      CREATE ROLE dietdigidose_app_test NOLOGIN;
    END IF;
  END $$`);
  await pool.query("GRANT USAGE ON SCHEMA public TO dietdigidose_app_test");
  await pool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dietdigidose_app_test");
  await pool.query("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO dietdigidose_app_test");
  const permission = await pool.query(`
    SELECT
      has_table_privilege('dietdigidose_app_test', 'inventory_items', 'SELECT,INSERT,UPDATE,DELETE') AS table_access,
      has_schema_privilege('dietdigidose_app_test', 'public', 'CREATE') AS schema_create
  `);
  assert.equal(permission.rows[0]?.table_access, true);
  assert.equal(permission.rows[0]?.schema_create, false);

  const transactionClient = await pool.connect();
  try {
    await transactionClient.query("BEGIN");
    await transactionClient.query("UPDATE inventory_items SET quantity_value = 1 WHERE food_name = '番茄'");
    await transactionClient.query("ROLLBACK");
  } finally {
    transactionClient.release();
  }
  const rolledBack = await pool.query("SELECT quantity_value FROM inventory_items WHERE food_name = '番茄'");
  assert.equal(Number(rolledBack.rows[0]?.quantity_value), 200);

  console.log(JSON.stringify({
    ok: true,
    tables: report.tableCount,
    rows: report.rowCount,
    schema: archive.baselineSchemaSha256,
    repeatedAndConcurrentImportVerified: true,
    postgresInventoryRepositoryVerified: true,
    postgresFeedbackRepositoryVerified: true,
    postgresFoodRepositoryVerified: true,
    postgresHealthRepositoryVerified: true,
    postgresShoppingRepositoryVerified: true,
    postgresWorkerRepositoryVerified: true,
    leastPrivilegeGrantVerified: true,
    rollbackVerified: true,
  }, null, 2));
} finally {
  await pool.end();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
