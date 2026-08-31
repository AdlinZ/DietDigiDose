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
import { PostgresInventoryRepository } from "../src/modules/inventory/postgresRepository.js";
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
    leastPrivilegeGrantVerified: true,
    rollbackVerified: true,
  }, null, 2));
} finally {
  await pool.end();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
