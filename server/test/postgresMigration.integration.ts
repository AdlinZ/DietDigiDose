import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { Pool } from "pg";
import { PostgresAccessControlRepository } from "../src/modules/accessControl/postgresRepository.js";
import { AccessControlService } from "../src/modules/accessControl/service.js";
import { PostgresAiContextRepository } from "../src/modules/aiContext/postgresRepository.js";
import { AiContextService } from "../src/modules/aiContext/service.js";
import { PostgresAIConversationsRepository } from "../src/modules/aiConversations/postgresRepository.js";
import { AIConversationsService } from "../src/modules/aiConversations/service.js";
import { PostgresAIRuntimeRepository } from "../src/modules/aiRuntime/postgresRepository.js";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { PostgresAiToolDataRepository } from "../src/modules/aiToolData/postgresRepository.js";
import { AiToolDataService } from "../src/modules/aiToolData/service.js";
import { PostgresAIWriteConfirmationsRepository } from "../src/modules/aiWriteConfirmations/postgresRepository.js";
import { AIWriteConfirmationsService } from "../src/modules/aiWriteConfirmations/service.js";
import { PostgresAdminAuditRepository } from "../src/modules/adminAudit/postgresRepository.js";
import { AdminAuditService } from "../src/modules/adminAudit/service.js";
import { PostgresAdminAgentRunsRepository } from "../src/modules/adminAgentRuns/postgresRepository.js";
import { AdminAgentRunsService } from "../src/modules/adminAgentRuns/service.js";
import { PostgresAgentSchedulingRepository } from "../src/modules/agentScheduling/postgresRepository.js";
import { AgentSchedulingService } from "../src/modules/agentScheduling/service.js";
import { PostgresAgentOperationsRepository } from "../src/modules/agentOperations/postgresRepository.js";
import { AgentOperationsService } from "../src/modules/agentOperations/service.js";
import type { ExecutableAgentAction } from "../src/modules/agentOperations/repository.js";
import { createPostgresAgentCheckpointer } from "../src/modules/agentCheckpoints/postgres.js";
import { PostgresAgentRunsRepository } from "../src/modules/agentRuns/postgresRepository.js";
import { AgentRunsService } from "../src/modules/agentRuns/service.js";
import { PostgresAuthAccountRepository } from "../src/modules/authAccount/postgresRepository.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";
import { PostgresAuthVerificationRepository } from "../src/modules/authVerification/postgresRepository.js";
import { AuthVerificationService } from "../src/modules/authVerification/service.js";
import { PostgresAdminCommunityRepository } from "../src/modules/adminCommunity/postgresRepository.js";
import { PostgresAdminUsersRepository } from "../src/modules/adminUsers/postgresRepository.js";
import { AdminUsersService } from "../src/modules/adminUsers/service.js";
import { PostgresAdminConsoleRepository } from "../src/modules/adminConsole/postgresRepository.js";
import { AdminConsoleService } from "../src/modules/adminConsole/service.js";
import { PostgresAdminFoodAssetsRepository } from "../src/modules/adminFoodAssets/postgresRepository.js";
import { AdminFoodAssetsService } from "../src/modules/adminFoodAssets/service.js";
import { PostgresAdminKitchenwareRepository } from "../src/modules/adminKitchenware/postgresRepository.js";
import { AdminKitchenwareService } from "../src/modules/adminKitchenware/service.js";
import { PostgresAdminRecipesRepository } from "../src/modules/adminRecipes/postgresRepository.js";
import { AdminRecipesService } from "../src/modules/adminRecipes/service.js";
import { PostgresCookingQueueRepository } from "../src/modules/cookingQueue/postgresRepository.js";
import { PostgresCommunityRepository } from "../src/modules/community/postgresRepository.js";
import { CommunityService } from "../src/modules/community/service.js";
import { PostgresDietRecordsRepository } from "../src/modules/dietRecords/postgresRepository.js";
import { DietRecordsService } from "../src/modules/dietRecords/service.js";
import { PostgresFeedbackRepository } from "../src/modules/feedback/postgresRepository.js";
import { PostgresFoodRepository } from "../src/modules/foods/postgresRepository.js";
import { PostgresHealthRepository } from "../src/modules/health/postgresRepository.js";
import { PostgresHouseholdsRepository } from "../src/modules/households/postgresRepository.js";
import { HouseholdsService } from "../src/modules/households/service.js";
import { PostgresInsightsRepository } from "../src/modules/insights/postgresRepository.js";
import { InsightsService } from "../src/modules/insights/service.js";
import { consumeInventoryWithPostgresClient, PostgresInventoryRepository } from "../src/modules/inventory/postgresRepository.js";
import { InventoryService } from "../src/modules/inventory/service.js";
import { PostgresKitchenwareRepository } from "../src/modules/kitchenware/postgresRepository.js";
import { KitchenwareService } from "../src/modules/kitchenware/service.js";
import { PostgresMealPlansRepository } from "../src/modules/mealPlans/postgresRepository.js";
import { PostgresMediaCleanupRepository } from "../src/modules/mediaCleanup/postgresRepository.js";
import { MediaCleanupService } from "../src/modules/mediaCleanup/service.js";
import { PostgresNotificationsRepository } from "../src/modules/notifications/postgresRepository.js";
import { createNotificationsService } from "../src/modules/notifications/service.js";
import { PostgresRateLimitsRepository } from "../src/modules/rateLimits/postgresRepository.js";
import { RateLimitsService } from "../src/modules/rateLimits/service.js";
import { PostgresRecommendationsRepository } from "../src/modules/recommendations/postgresRepository.js";
import { RecommendationsService } from "../src/modules/recommendations/service.js";
import { PostgresRealtimeVoiceRepository } from "../src/modules/realtimeVoice/postgresRepository.js";
import { RealtimeVoiceService } from "../src/modules/realtimeVoice/service.js";
import { PostgresRecipesRepository } from "../src/modules/recipes/postgresRepository.js";
import { RecipesService } from "../src/modules/recipes/service.js";
import { PostgresShoppingRepository } from "../src/modules/shopping/postgresRepository.js";
import { PostgresVoicePacksRepository } from "../src/modules/voicePacks/postgresRepository.js";
import { VoicePacksService } from "../src/modules/voicePacks/service.js";
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
sqliteModule.db.prepare(`INSERT INTO agent_runs
  (id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
  VALUES ('sqlite-checkpoint-run',?,'sqlite-checkpoint-session','text','assistant','awaiting_approval',
    '{"prompt":"迁移 checkpoint"}','sqlite-checkpoint-thread')`).run(user.id);
const sqliteCheckpointer = new SqliteSaver(sqliteModule.db);
const sqliteCheckpointConfig = await sqliteCheckpointer.put(
  { configurable: { thread_id: "sqlite-checkpoint-thread", checkpoint_ns: "" } },
  {
    v: 4, id: "00000000-0000-6000-8000-000000000000", ts: new Date(0).toISOString(),
    channel_values: { goal: "从 SQLite 恢复", typedBytes: new Uint8Array([0, 1, 255]) },
    channel_versions: { goal: "1", typedBytes: "1" }, versions_seen: {},
  },
  { source: "input", step: 0, parents: {} },
);
const sqliteChildCheckpointConfig = await sqliteCheckpointer.put(
  sqliteCheckpointConfig,
  {
    v: 4, id: "00000000-0000-6000-8000-000000000001", ts: new Date(1).toISOString(),
    channel_values: { goal: "从 SQLite 恢复完成", typedBytes: new Uint8Array([0, 1, 255, 2]) },
    channel_versions: { goal: "2", typedBytes: "2" }, versions_seen: { supervisor: { goal: "1" } },
  },
  { source: "loop", step: 1, parents: {} },
);
await sqliteCheckpointer.putWrites(sqliteChildCheckpointConfig, [["approval", { approved: false }]], "sqlite-task");
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
  assert.deepEqual(report.langgraph, {
    sourcePresent: true, checkpointCount: 2, checkpointBlobCount: 4, checkpointWriteCount: 1,
  });
  const migratedCheckpointSaver = await createPostgresAgentCheckpointer(pool);
  const migratedCheckpoint = await migratedCheckpointSaver.getTuple({
    configurable: { thread_id: "sqlite-checkpoint-thread", checkpoint_ns: "" },
  });
  assert.equal(migratedCheckpoint?.checkpoint.channel_values.goal, "从 SQLite 恢复完成");
  assert.deepEqual(Array.from(migratedCheckpoint?.checkpoint.channel_values.typedBytes as Uint8Array), [0, 1, 255, 2]);
  assert.equal(migratedCheckpoint?.parentConfig?.configurable?.checkpoint_id,
    "00000000-0000-6000-8000-000000000000");
  assert.deepEqual(migratedCheckpoint?.pendingWrites, [["sqlite-task", "approval", { approved: false }]]);

  const inventoryRepository = new PostgresInventoryRepository(pool);
  const inventoryService = new InventoryService(inventoryRepository);
  const funnelBefore = await pool.query(`SELECT event_name,COUNT(*)::int AS count FROM funnel_events
    WHERE event_name IN ('inventory_added','cooking_completed') GROUP BY event_name`);
  const initialFunnelCounts = new Map(funnelBefore.rows.map((row) => [String(row.event_name), Number(row.count)]));
  const migratedItems = await inventoryRepository.list(user.id);
  const migratedTomato = migratedItems.find((item) => item.food_name === "番茄")!;
  assert.equal(migratedTomato.quantity_value, 250);
  const created = await inventoryService.create(user.id, {
    food_name: "牛奶",
    category: "乳制品",
    quantity: "500ml",
    expiration_date: "2026-09-08",
    storage_location: "冷藏",
    quantity_value: 500,
    quantity_unit: "ml",
  });
  const imported = await Promise.all([0, 1].map(() => inventoryService.importShoppingList(user.id, {
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

  const dietInventory = await inventoryRepository.create(user.id, {
    food_name: "烹饪事务土豆",
    category: "蔬菜",
    quantity: "400g",
    expiration_date: "2026-09-12",
    storage_location: "常温",
    quantity_value: 400,
    quantity_unit: "g",
  });
  const dietRepository = new PostgresDietRecordsRepository(pool, consumeInventoryWithPostgresClient);
  const dietService = new DietRecordsService(dietRepository);
  const completionInput = {
    idempotency_key: "postgres-cooking-completion-0001",
    recipe_id: null,
    inventory_item_ids: [],
    inventory_consumptions: [{
      item_id: dietInventory.id,
      version: dietInventory.version,
      mode: "amount" as const,
      amount_value: 125,
      unit: "g" as const,
    }],
    diet_record: {
      meal_type: "晚餐",
      food_name: "Postgres 土豆料理",
      amount: "1份",
      calories: 280,
      recorded_at: "2026-09-03",
      recorded_time: "19:30",
    },
  };
  const cookingCompletions = await Promise.all([
    dietService.completeCooking(user.id, completionInput),
    dietService.completeCooking(user.id, completionInput),
  ]);
  assert.deepEqual(cookingCompletions.map((result) => result.repeated).sort(), [false, true]);
  const completionRecordIds = cookingCompletions.map((result) => Number((result.diet_record as { id: number }).id));
  assert.equal(completionRecordIds[0], completionRecordIds[1]);
  const storedDietInventory = await inventoryRepository.findOwned(user.id, dietInventory.id);
  assert.equal(storedDietInventory?.quantity_value, 275);
  const completedMeals = await dietRepository.list(user.id, "2026-09-03");
  assert.equal(completedMeals.filter((record) => record.food_name === "Postgres 土豆料理").length, 1);
  const funnelAfter = await pool.query(`SELECT event_name,COUNT(*)::int AS count FROM funnel_events
    WHERE event_name IN ('inventory_added','cooking_completed') GROUP BY event_name`);
  const finalFunnelCounts = new Map(funnelAfter.rows.map((row) => [String(row.event_name), Number(row.count)]));
  assert.equal((finalFunnelCounts.get("inventory_added")||0)-(initialFunnelCounts.get("inventory_added")||0),2);
  assert.equal((finalFunnelCounts.get("cooking_completed")||0)-(initialFunnelCounts.get("cooking_completed")||0),1);
  const manualDietRecord = await dietRepository.create(user.id, {
    meal_type: "加餐",
    food_name: "Postgres 酸奶",
    amount: "1杯",
    calories: 95,
    recorded_at: "2026-09-04",
    recorded_time: null,
  });
  assert.equal(await dietRepository.remove(user.id + 1, Number(manualDietRecord.id)), false);
  assert.equal(await dietRepository.remove(user.id, Number(manualDietRecord.id)), true);

  const insightInventory = await inventoryRepository.create(user.id, {
    food_name: "Postgres 周报菠菜",
    category: "蔬菜",
    quantity: "500g",
    expiration_date: "2026-09-03",
    storage_location: "冷藏",
    quantity_value: 500,
    quantity_unit: "g",
  });
  await inventoryRepository.create(user.id, {
    food_name: "Postgres 临期西兰花",
    category: "蔬菜",
    quantity: "1个",
    expiration_date: "2026-09-02",
    storage_location: "冷藏",
    quantity_value: 1,
    quantity_unit: "piece",
  });
  const insightsRepository = new PostgresInsightsRepository(pool);
  const outcomeInput = {
    scope: "personal" as const,
    itemId: insightInventory.id,
    itemVersion: insightInventory.version,
    outcome: "used" as const,
    source: "reminder",
    idempotencyKey: "postgres-insights-outcome-0001",
    occurredAt: "2026-09-01T10:00:00.000Z",
    closeItem: true,
  };
  const outcomeResults = await Promise.all([
    insightsRepository.createOutcome(user.id, outcomeInput),
    insightsRepository.createOutcome(user.id, outcomeInput),
  ]);
  assert.deepEqual(outcomeResults.map((result) => result.kind).sort(), ["created", "repeated"]);
  const createdOutcome = outcomeResults.find((result) => result.kind === "created");
  if (!createdOutcome || createdOutcome.kind !== "created") throw new Error("PostgreSQL outcome was not created");
  const closedInsightInventory = await pool.query(
    "SELECT is_available, version, deleted_at FROM inventory_items WHERE id = $1",
    [insightInventory.id],
  );
  assert.equal(closedInsightInventory.rows[0]?.is_available, false);
  assert.equal(Number(closedInsightInventory.rows[0]?.version), insightInventory.version + 1);
  assert(closedInsightInventory.rows[0]?.deleted_at);
  assert.equal((await insightsRepository.updateOutcome(user.id + 1, createdOutcome.event.id, { version: 1, outcome: "gifted" })).kind, "not_found");
  assert.equal((await insightsRepository.updateOutcome(user.id, createdOutcome.event.id, { version: 1, outcome: "gifted" })).kind, "updated");
  assert.equal((await insightsRepository.updateOutcome(user.id, createdOutcome.event.id, { version: 1, outcome: "expired" })).kind, "conflict");
  const insightsService = new InsightsService(insightsRepository);
  const weeklyInsights = await insightsService.weekly(user.id, {
    weekStart: "2026-08-31",
    timezoneOffsetMinutes: 0,
    scope: "personal",
  });
  assert.equal(weeklyInsights.summary.giftedOrTransferredCount, 1);
  assert.equal(weeklyInsights.dataQuality, "structured");
  assert.match(weeklyInsights.advice, /蔬菜库存到期/);

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

  const adminFoodRepository = new PostgresAdminFoodAssetsRepository(pool);
  const adminFoodService = new AdminFoodAssetsService(adminFoodRepository);
  const adminFoodContext = { adminUserId: user.id, ipAddress: "127.0.0.1", userAgent: "postgres-integration" };
  const legacyFoodPage = await adminFoodService.ingredients({ search: "Postgres 番茄", page: 1, pageSize: 10 });
  assert.equal(legacyFoodPage.items[0]?.micronutrients_json, '{"vitaminC":13.7}');
  const adminIngredient = (name: string, aliases: string[] = []) => ({
    name, category: "蔬菜", calories_100g: 20, protein_100g: 1, carbs_100g: 4, fat_100g: 0.2,
    source: "official", aliases, search_keywords: "postgres admin food", preparation_state: "raw",
    source_version: "postgres-admin-v1", data_license: "DietDigiDose-Original", edible_ratio: 1,
  });
  await assert.rejects(() => adminFoodService.createIngredient(adminIngredient("Postgres 回滚食材"), {
    ...adminFoodContext, adminUserId: 2_147_000_000,
  }));
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM ingredients_library WHERE name='Postgres 回滚食材'"))
    .rows[0]?.count), 0);
  const sourceAdminFood = await adminFoodService.createIngredient(adminIngredient("Postgres 管理番茄", ["PG 管理西红柿"]), adminFoodContext);
  const targetAdminFood = await adminFoodService.createIngredient(adminIngredient("Postgres 目标番茄"), adminFoodContext);
  await adminFoodService.updateIngredient(sourceAdminFood.id, adminIngredient("Postgres 管理红番茄", ["PG 红番茄"]), adminFoodContext);
  const addedAlias = await adminFoodService.addAlias(sourceAdminFood.id, { alias: "PG 红柿" }, adminFoodContext);
  assert.equal(addedAlias.aliases.includes("PG 红柿"), true);
  await adminFoodService.mergeIngredient(sourceAdminFood.id, { targetId: targetAdminFood.id }, adminFoodContext);
  const mergedTarget = (await pool.query("SELECT aliases_json FROM ingredients_library WHERE id=$1", [targetAdminFood.id])).rows[0];
  assert.equal(mergedTarget.aliases_json.includes("Postgres 管理红番茄"), true);
  const coverage = await adminFoodService.coverage();
  assert.equal(coverage.categories.some((item) => item.category === "蔬菜"), true);

  await adminFoodService.approveCustomFood(customFoodId, adminFoodContext);
  assert.equal((await pool.query("SELECT status FROM user_custom_foods WHERE id=$1", [customFoodId])).rows[0]?.status, "approved");
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM ingredients_library
    WHERE name='Postgres 家庭豆浆' AND source='ugc'`)).rows[0]?.count), 1);
  await assert.rejects(() => adminFoodService.approveCustomFood(customFoodId, adminFoodContext), /记录未找到/);
  const rejectedCustomFoodId = await foodRepository.createCustom(user.id, {
    name: "Postgres 驳回食品", calories_100g: 10, protein_100g: 0, carbs_100g: 1, fat_100g: 0,
  });
  await adminFoodService.rejectCustomFood(rejectedCustomFoodId, adminFoodContext);
  assert.equal((await pool.query("SELECT status FROM user_custom_foods WHERE id=$1", [rejectedCustomFoodId])).rows[0]?.status, "rejected");
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs WHERE action IN
    ('ingredient.create','ingredient.update','ingredient.alias_add','ingredient.merge','custom_food.approve','custom_food.reject')
    AND resource_id=ANY($1::text[])`, [[String(sourceAdminFood.id), String(targetAdminFood.id), String(customFoodId), String(rejectedCustomFoodId)]]))
    .rows[0]?.count), 7);
  await adminFoodService.removeIngredient(targetAdminFood.id, adminFoodContext);

  const adminConsoleRepository = new PostgresAdminConsoleRepository(pool);
  const adminConsoleService = new AdminConsoleService(adminConsoleRepository);
  await pool.query("INSERT INTO funnel_events (event_name,actor_hash) VALUES ('admin_console_test','actor-test')");
  await pool.query(`INSERT INTO inventory_scan_jobs (id,user_id,image_hash,status,result_json)
    VALUES ('admin-console-scan',$1,'hash-admin-console','completed','[{"foodName":"番茄"}]'::jsonb)`, [user.id]);
  await pool.query(`INSERT INTO ai_chat_messages (user_id,session_id,role,content,source,status,payload_json,response_time_ms)
    VALUES ($1,'admin-console-chat','user','管理员控制台问题','assistant','completed',NULL,NULL),
           ($1,'admin-console-chat','assistant','管理员控制台回答','assistant','completed','{"solutionCards":[{"title":"番茄汤"}]}'::jsonb,321)`, [user.id]);
  await pool.query(`INSERT INTO ai_usage_logs
    (user_id,endpoint,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,success,failure_reason,estimated_cost_usd)
    VALUES ($1,'admin-console','test-model',10,5,15,250,FALSE,'injected provider failure',0.001)`, [user.id]);
  const consoleStats = await adminConsoleService.stats();
  assert(Number(consoleStats.users) >= 1); assert(Number(consoleStats.ingredients) >= 1);
  assert.equal((await adminConsoleService.funnel({ days: 7 })).items.some((item) => item.eventName === "admin_console_test"), true);
  const consoleAudits = await adminConsoleService.auditLogs({ action: "ingredient.delete", page: 1, pageSize: 10 });
  assert.equal(consoleAudits.items.some((item) => item.resourceId === String(targetAdminFood.id)), true);
  const consoleScans = await adminConsoleService.scanJobs({ status: "completed", user: String(user.id) });
  assert.equal(consoleScans.items.find((item) => item.id === "admin-console-scan")?.itemCount, 1);
  assert.equal((await adminConsoleService.scanJob("admin-console-scan")).items.length, 1);
  const consoleConversations = await adminConsoleService.conversations({ query: String(user.id) });
  assert.equal(consoleConversations.items.some((item) => item.sessionId === "admin-console-chat"), true);
  const consoleConversation = await adminConsoleService.conversation(user.id, "admin-console-chat");
  assert.equal((consoleConversation.messages[1]?.payload as Record<string, unknown>).solutionCards instanceof Array, true);
  const consoleUsage = await adminConsoleService.usage({ range: "all", userId: user.id });
  assert(Number(consoleUsage.summary.totalTokens) >= 15);
  assert.equal(consoleUsage.failures.some((item) => item.endpoint === "admin-console"), true);
  assert.equal((await adminConsoleService.trends()).length, 7);
  assert((await adminConsoleService.recent()).recentUsers.length >= 1);
  assert.equal((await adminConsoleService.trash()).ingredients.some((item) => Number(item.id) === targetAdminFood.id), true);
  await assert.rejects(() => adminConsoleRepository.restore("ingredients", targetAdminFood.id, {
    adminUserId: 2_147_000_000, action: "ingredients.restore", resourceType: "ingredients",
    resourceId: targetAdminFood.id, summary: "回滚恢复测试",
  }));
  assert((await pool.query("SELECT deleted_at FROM ingredients_library WHERE id=$1", [targetAdminFood.id])).rows[0]?.deleted_at);
  await adminConsoleService.restore("ingredients", targetAdminFood.id, adminFoodContext);
  assert.equal((await pool.query("SELECT deleted_at FROM ingredients_library WHERE id=$1", [targetAdminFood.id])).rows[0]?.deleted_at, null);

  const householdMember = Number((await pool.query(`INSERT INTO users (username,email,password_hash)
    VALUES ('postgres-household-member','postgres-household-member@example.com','integration-hash') RETURNING id`)).rows[0]?.id);
  const householdsRepository = new PostgresHouseholdsRepository(pool);
  const householdsService = new HouseholdsService(householdsRepository, () => "PGHOUSE1");
  await assert.rejects(() => householdsRepository.create(2_147_000_000, "Postgres 回滚家庭", "PGROLL01"));
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM households WHERE invite_code='PGROLL01'"))
    .rows[0]?.count), 0);
  const postgresHousehold = await householdsService.create(user.id, "Postgres 协作家庭");
  const postgresHouseholdId = Number(postgresHousehold.id);
  assert.equal((await householdsService.join(householdMember, "pghouse1")).status, 201);
  const firstHouseholdShopping = await householdsService.createShopping(user.id, postgresHouseholdId,
    "77777777-7777-4777-8777-777777777771", { name: "Postgres 家庭牛奶", amount: "2盒", category: "乳制品" });
  const secondHouseholdShopping = await householdsService.createShopping(householdMember, postgresHouseholdId,
    "77777777-7777-4777-8777-777777777772", { name: "Postgres 家庭番茄", amount: "3个", category: "蔬菜" });
  const purchasedFirst = await householdsService.updateShopping(householdMember, postgresHouseholdId,
    firstHouseholdShopping.item.id, { version: firstHouseholdShopping.item.version, checked: true });
  const purchasedSecond = await householdsService.updateShopping(user.id, postgresHouseholdId,
    secondHouseholdShopping.item.id, { version: secondHouseholdShopping.item.version, checked: true });
  const staleBatch = await householdsRepository.intake(user.id, postgresHouseholdId, "household-stale-batch", {
    idempotencyKey: "postgres-household-stale-intake-0001",
    items: [
      { id: purchasedFirst.id, version: purchasedFirst.version, quantity: "2盒", expirationDate: "2026-09-08", storageLocation: "冷藏" },
      { id: purchasedSecond.id, version: purchasedSecond.version - 1, quantity: "3个", expirationDate: "2026-09-06", storageLocation: "冷藏" },
    ],
  });
  assert.equal(staleBatch.kind, "version_conflict");
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM household_inventory_items WHERE household_id=$1",
    [postgresHouseholdId])).rows[0]?.count), 0);
  const intakeInput = { idempotencyKey: "postgres-household-concurrent-intake-0001", items: [
    { id: purchasedFirst.id, version: purchasedFirst.version, quantity: "2盒", expirationDate: "2026-09-08", storageLocation: "冷藏" },
    { id: purchasedSecond.id, version: purchasedSecond.version, quantity: "3个", expirationDate: "2026-09-06", storageLocation: "冷藏" },
  ] };
  const concurrentIntakes = await Promise.all([
    householdsRepository.intake(user.id, postgresHouseholdId, "household-intake-a", intakeInput),
    householdsRepository.intake(householdMember, postgresHouseholdId, "household-intake-b", intakeInput),
  ]);
  assert.deepEqual(concurrentIntakes.map((result) => result.kind).sort(), ["created", "repeated"]);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM household_inventory_items WHERE household_id=$1",
    [postgresHouseholdId])).rows[0]?.count), 2);
  const manualHouseholdInventory = await householdsService.createInventory(user.id, postgresHouseholdId, {
    food_name: "Postgres 家庭鸡蛋", expiration_date: "2026-09-09", quantity: "6个",
  });
  const updatedHouseholdInventory = await householdsService.updateInventory(householdMember, postgresHouseholdId,
    Number(manualHouseholdInventory.id), { quantity: "5个", is_available: true });
  assert.equal(updatedHouseholdInventory.quantity, "5个");
  await householdsService.removeInventory(user.id, postgresHouseholdId, Number(manualHouseholdInventory.id));
  assert((await householdsService.history(user.id, postgresHouseholdId)).length >= 7);
  await assert.rejects(() => householdsService.transferOwner(user.id, postgresHouseholdId,
    { newOwnerUserId: householdMember, version: 999 }), /家庭空间已更新/);
  const currentHousehold = (await householdsService.mine(user.id)).find((item) => Number(item.id) === postgresHouseholdId)!;
  await householdsService.transferOwner(user.id, postgresHouseholdId,
    { newOwnerUserId: householdMember, version: Number(currentHousehold.version) });
  await householdsService.leave(user.id, postgresHouseholdId);
  await householdsService.leave(householdMember, postgresHouseholdId);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM households WHERE id=$1", [postgresHouseholdId]))
    .rows[0]?.count), 0);

  const cookingQueueRepository = new PostgresCookingQueueRepository(pool);
  await pool.query("DELETE FROM cooking_queue_items WHERE user_id = $1", [user.id]);
  const queueRecipes = await pool.query(`SELECT id, title, image_url, cook_time, calories, difficulty, ingredients_json
    FROM recipes WHERE deleted_at IS NULL AND status = 'approved' ORDER BY id LIMIT 2`);
  assert.equal(queueRecipes.rows.length, 2);
  const queueRecipe = queueRecipes.rows[0]!;
  const aiWriteRepository = new PostgresAIWriteConfirmationsRepository(pool);
  const aiWriteService = new AIWriteConfirmationsService(aiWriteRepository);
  const inventoryPreview = await aiWriteService.createPreview({ userId: user.id, action: "add_inventory_item",
    payload: { name: "PostgreSQL AI 确认番茄", quantity: "3个", location: "冷藏", expireDays: 4 },
    conversationId: "postgres-ai-write", sourceMessageId: "message-1" });
  const concurrentAIWrites = await Promise.all([
    aiWriteService.commit({ userId: user.id, confirmationId: inventoryPreview.confirmationId,
      idempotencyKey: "postgres-ai-write-concurrent-0001" }),
    aiWriteService.commit({ userId: user.id, confirmationId: inventoryPreview.confirmationId,
      idempotencyKey: "postgres-ai-write-concurrent-0001" }),
  ]);
  assert.equal(concurrentAIWrites[0]!.id, concurrentAIWrites[1]!.id);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::int AS count FROM inventory_items
    WHERE user_id=$1 AND food_name='PostgreSQL AI 确认番茄'`, [user.id])).rows[0]?.count), 1);
  await assert.rejects(() => aiWriteService.commit({ userId: user.id + 1, confirmationId: inventoryPreview.confirmationId,
    idempotencyKey: "postgres-ai-write-foreign-0001" }), /不存在或无权/);
  const dietPreview = await aiWriteService.createPreview({ userId: user.id, action: "record_diet_meal",
    payload: { mealType: "午餐", foodName: "PostgreSQL AI 确认餐", amount: "1份", calories: 260 } });
  const kitchenwarePreview = await aiWriteService.createPreview({ userId: user.id, action: "add_kitchenware_item",
    payload: { name: "PostgreSQL AI 确认炒锅", category: "烹饪锅具", status: "良好" } });
  await aiWriteService.commit({ userId: user.id, confirmationId: dietPreview.confirmationId,
    idempotencyKey: "postgres-ai-write-diet-0001" });
  await aiWriteService.commit({ userId: user.id, confirmationId: kitchenwarePreview.confirmationId,
    idempotencyKey: "postgres-ai-write-kitchenware-0001" });
  const concurrentHealthPreviews = await Promise.all([
    aiWriteService.createPreview({ userId: householdMember, action: "record_health_log", payload: { weightKg: 60.5 } }),
    aiWriteService.createPreview({ userId: householdMember, action: "record_health_log", payload: { waterMl: 500 } }),
  ]);
  await Promise.all(concurrentHealthPreviews.map((preview, index) => aiWriteService.commit({ userId: householdMember,
    confirmationId: preview.confirmationId, idempotencyKey: `postgres-ai-write-health-concurrent-000${index + 2}` })));
  const concurrentHealth = (await pool.query(`SELECT COUNT(*)::int AS count,MAX(weight) AS weight,MAX(water_ml) AS water_ml
    FROM health_logs WHERE user_id=$1 AND recorded_date=CURRENT_DATE::text`, [householdMember])).rows[0];
  assert.deepEqual({ count: Number(concurrentHealth.count), weight: Number(concurrentHealth.weight), waterMl: Number(concurrentHealth.water_ml) },
    { count: 1, weight: 60.5, waterMl: 500 });
  assert.equal(Number((await pool.query("SELECT calories FROM diet_records WHERE user_id=$1 AND food_name=$2",
    [user.id, "PostgreSQL AI 确认餐"])).rows[0]?.calories), 260);
  assert.equal((await pool.query("SELECT status FROM kitchenware_items WHERE user_id=$1 AND name=$2",
    [user.id, "PostgreSQL AI 确认炒锅"])).rows[0]?.status, "良好");
  const expiredPreview = await aiWriteService.createPreview({ userId: user.id, action: "record_health_log", payload: { waterMl: 100 } });
  await pool.query("UPDATE ai_write_confirmations SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1",
    [expiredPreview.confirmationId]);
  await assert.rejects(() => aiWriteService.commit({ userId: user.id, confirmationId: expiredPreview.confirmationId,
    idempotencyKey: "postgres-ai-write-expired-0001" }), /确认已过期/);
  const aiWriteNativeTypes = (await pool.query(`SELECT pg_typeof(payload_json)::text AS payload_type,
    pg_typeof(committed_result_json)::text AS result_type FROM ai_write_confirmations WHERE id=$1`,
  [inventoryPreview.confirmationId])).rows[0];
  assert.deepEqual(aiWriteNativeTypes, { payload_type: "jsonb", result_type: "jsonb" });
  assert.equal(Number((await pool.query("SELECT COUNT(*)::int AS count FROM ai_write_audit_logs WHERE confirmation_id=$1",
    [inventoryPreview.confirmationId])).rows[0]?.count), 2);
  const aiConversationsRepository = new PostgresAIConversationsRepository(pool);
  const aiConversationsService = new AIConversationsService(aiConversationsRepository);
  const conversationSessionId = `postgres-ai-conversation-${user.id}`;
  const conversationRunId = `postgres-ai-conversation-run-${user.id}`;
  await pool.query("DELETE FROM agent_runs WHERE id=$1", [conversationRunId]);
  await pool.query("DELETE FROM ai_chat_session_deletions WHERE user_id=$1 AND session_id=$2", [user.id, conversationSessionId]);
  await pool.query("DELETE FROM ai_chat_messages WHERE user_id=$1 AND session_id=$2", [user.id, conversationSessionId]);
  const firstConversationAt = Date.now();
  assert.equal(await aiConversationsService.recordTurn({ userId: user.id, sessionId: conversationSessionId,
    source: "assistant", userContent: "PostgreSQL 会话问题", assistantContent: "PostgreSQL 会话回答",
    systemContents: ["PostgreSQL 系统上下文"], payload: { trace: { provider: "postgres" } }, responseTimeMs: 25,
    requestedAt: firstConversationAt, respondedAt: firstConversationAt + 25 }), true);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$3,'text','assistant','completed','{}'::jsonb,$1)`, [conversationRunId, user.id, conversationSessionId]);
  await pool.query(`INSERT INTO agent_run_media(id,run_id,user_id,kind,mime_type,data_base64)
    VALUES($1,$2,$3,'image','image/png','cG5n')`, [`${conversationRunId}-media`, conversationRunId, user.id]);
  const requestedBeforeDelete = Date.now() - 1_000;
  await Promise.all([
    aiConversationsService.recordTurn({ userId: user.id, sessionId: conversationSessionId, source: "assistant",
      userContent: "删除前的问题", assistantContent: "迟到回答", responseTimeMs: 1_100,
      requestedAt: requestedBeforeDelete, respondedAt: Date.now() + 100 }),
    aiConversationsService.deleteConversation(user.id, conversationSessionId),
  ]);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::int AS count FROM ai_chat_messages WHERE user_id=$1 AND session_id=$2",
    [user.id, conversationSessionId])).rows[0]?.count), 0);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::int AS count FROM agent_run_media WHERE run_id=$1",
    [conversationRunId])).rows[0]?.count), 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const requestedAfterDelete = Date.now();
  assert.equal(await aiConversationsService.recordTurn({ userId: user.id, sessionId: conversationSessionId,
    source: "assistant", userContent: "删除后的新问题", assistantContent: "新回答", payload: { safe: true },
    responseTimeMs: 20, requestedAt: requestedAfterDelete, respondedAt: requestedAfterDelete + 20 }), true);
  const conversationNativeType = (await pool.query(`SELECT pg_typeof(payload_json)::text AS payload_type
    FROM ai_chat_messages WHERE user_id=$1 AND session_id=$2 AND role='assistant'`, [user.id, conversationSessionId])).rows[0];
  assert.deepEqual(conversationNativeType, { payload_type: "jsonb" });
  const legacyScanId = `postgres-ai-conversation-scan-${user.id}`;
  await pool.query(`INSERT INTO inventory_scan_jobs(id,user_id,image_hash,status,result_json)
    VALUES($1,$2,$1,'completed','[{"foodName":"PostgreSQL 番茄"}]'::jsonb)
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,status=excluded.status,result_json=excluded.result_json`,
  [legacyScanId, user.id]);
  assert.deepEqual((await aiConversationsService.legacyInventoryScanJob(legacyScanId, user.id))?.result,
    [{ foodName: "PostgreSQL 番茄" }]);
  assert.equal(await aiConversationsService.legacyInventoryScanJob(legacyScanId, householdMember), null);
  const agentRunsService = new AgentRunsService(new PostgresAgentRunsRepository(pool));
  const postgresAgentRunInput = {
    modality: "image", source: "assistant", sessionId: " postgres-agent-runs ", prompt: "识别 PostgreSQL 番茄",
    image: "data:image/png;base64,cG9zdGdyZXMtc2VjcmV0", mimeType: "image/png", idempotencyKey: "postgres-agent-runs-key",
  } as const;
  const concurrentAgentRuns = await Promise.all([
    agentRunsService.createRun(user.id, postgresAgentRunInput),
    agentRunsService.createRun(user.id, postgresAgentRunInput),
  ]);
  assert.deepEqual(concurrentAgentRuns[0], concurrentAgentRuns[1]);
  const agentRun = concurrentAgentRuns[0]!;
  assert.equal(agentRun.sessionId, "postgres-agent-runs");
  const storedAgentRun = await agentRunsService.run(agentRun.id, user.id);
  assert(storedAgentRun);
  assert.equal(storedAgentRun.input_json.includes("cG9zdGdyZXMtc2VjcmV0"), false);
  assert.equal((await agentRunsService.media(agentRun.id, user.id))?.data_base64,
    "data:image/png;base64,cG9zdGdyZXMtc2VjcmV0");
  assert.equal(await agentRunsService.run(agentRun.id, householdMember), undefined);
  assert.equal((await agentRunsService.reusableRun(user.id, "postgres-agent-runs-key"))?.id, agentRun.id);
  const checkpointRun = await agentRunsService.createRun(user.id, {
    modality: "text", prompt: "验证 PostgreSQL checkpoint", idempotencyKey: "postgres-checkpoint-key",
  });
  const postgresCheckpointer = await createPostgresAgentCheckpointer(pool);
  const checkpointConfig = await postgresCheckpointer.put(
    { configurable: { thread_id: checkpointRun.id, checkpoint_ns: "" } },
    {
      v: 1,
      id: "00000000-0000-6000-8000-000000000001",
      ts: new Date().toISOString(),
      channel_values: { goal: "验证 PostgreSQL checkpoint" },
      channel_versions: { goal: "1" },
      versions_seen: {},
    },
    { source: "input", step: 0, parents: {} },
    { goal: "1" },
  );
  await postgresCheckpointer.putWrites(checkpointConfig, [["checkpoint_test", { ok: true }]], "checkpoint-task");
  const checkpointTuple = await postgresCheckpointer.getTuple(checkpointConfig);
  assert.equal(checkpointTuple?.checkpoint.channel_values.goal, "验证 PostgreSQL checkpoint");
  assert.deepEqual(checkpointTuple?.pendingWrites, [["checkpoint-task", "checkpoint_test", { ok: true }]]);
  const checkpointStorage = (await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM checkpoints WHERE thread_id=$1) AS checkpoints,
    (SELECT COUNT(*)::integer FROM checkpoint_blobs WHERE thread_id=$1) AS blobs,
    (SELECT COUNT(*)::integer FROM checkpoint_writes WHERE thread_id=$1) AS writes,
    (SELECT MAX(v)::integer FROM checkpoint_migrations) AS version`, [checkpointRun.id])).rows[0];
  assert.deepEqual(checkpointStorage, { checkpoints: 1, blobs: 1, writes: 1, version: 4 });
  await pool.query("DELETE FROM agent_runs WHERE id=$1", [checkpointRun.id]);
  assert.equal(await postgresCheckpointer.getTuple(checkpointConfig), undefined);
  const checkpointRowsAfterRunDeletion = (await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM checkpoints WHERE thread_id=$1) AS checkpoints,
    (SELECT COUNT(*)::integer FROM checkpoint_blobs WHERE thread_id=$1) AS blobs,
    (SELECT COUNT(*)::integer FROM checkpoint_writes WHERE thread_id=$1) AS writes`, [checkpointRun.id])).rows[0];
  assert.deepEqual(checkpointRowsAfterRunDeletion, { checkpoints: 0, blobs: 0, writes: 0 });
  const concurrentEventSequences = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    agentRunsService.appendEvent(agentRun.id, user.id, "VisionAgent", "concurrent_event", `并发事件 ${index + 1}`, { index })));
  assert.deepEqual([...concurrentEventSequences].sort((left, right) => left - right),
    Array.from({ length: 12 }, (_, index) => index + 2));
  assert.deepEqual((await agentRunsService.events(agentRun.id, user.id)).map((event) => event.sequence),
    Array.from({ length: 13 }, (_, index) => index + 1));
  await agentRunsService.setStatus(agentRun.id, "running");
  const runProposals = [
    { actionType: "record_diet_meal" as const, riskLevel: "high" as const,
      summary: "记录 PostgreSQL 晚餐", payload: { foodName: "番茄" } },
    { actionType: "record_health_log" as const, riskLevel: "high" as const,
      summary: "记录 PostgreSQL 饮水", payload: { waterMl: 300 } },
  ];
  const concurrentSavedActions = await Promise.all([
    agentRunsService.saveActions(agentRun.id, user.id, runProposals),
    agentRunsService.saveActions(agentRun.id, user.id, runProposals),
  ]);
  assert.deepEqual(concurrentSavedActions[0], concurrentSavedActions[1]);
  assert.equal((await agentRunsService.actions(agentRun.id, user.id)).length, 2);
  await assert.rejects(() => agentRunsService.reviseActions(agentRun.id, user.id, [
    { ...runProposals[0], id: concurrentSavedActions[0]![0]!.id, payload: { foodName: "鸡蛋" } },
    { ...runProposals[1], id: "missing-agent-action", payload: { waterMl: 999 } },
  ]), /已变化/);
  assert.deepEqual((await agentRunsService.actions(agentRun.id, user.id))[0]?.payload, { foodName: "番茄" });
  const approvedActionId = concurrentSavedActions[0]![0]!.id;
  await agentRunsService.recordActionDecision([approvedActionId], user.id, "approve");
  await agentRunsService.updateActionStatus(approvedActionId, "executed", { result: { dietRecordId: 123 } });
  assert.deepEqual((await agentRunsService.actions(agentRun.id, user.id))[0]?.result, { dietRecordId: 123 });
  await agentRunsService.setStatus(agentRun.id, "completed", { result: { reply: "PostgreSQL Agent Run 完成" }, pendingApproval: null });
  const completedAgentRun = await agentRunsService.run(agentRun.id, user.id);
  assert.equal(completedAgentRun?.status, "completed");
  assert.equal(completedAgentRun?.result_json, '{"reply":"PostgreSQL Agent Run 完成"}');
  assert.equal(await agentRunsService.setStatus(agentRun.id, "cancelled"), false);
  const agentRunNativeTypes = (await pool.query(`SELECT pg_typeof(input_json)::text AS input_type,
    pg_typeof(result_json)::text AS result_type FROM agent_runs WHERE id=$1`, [agentRun.id])).rows[0];
  assert.deepEqual(agentRunNativeTypes, { input_type: "jsonb", result_type: "jsonb" });
  const adminAgentRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const adminAgentActionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await pool.query("DELETE FROM agent_runs WHERE id=$1", [adminAgentRunId]);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,result_json,
    checkpoint_thread_id,started_at,completed_at) VALUES($1,$2,'postgres-admin-agent','image','vision-food','completed',
    '{"prompt":"识别 PostgreSQL 沙拉","mediaRef":"must-not-leak"}'::jsonb,
    '{"reply":"PostgreSQL 蔬菜沙拉","artifacts":[{"type":"vision","data":{"confidence":0.93}}]}'::jsonb,
    $1,CURRENT_TIMESTAMP-INTERVAL '3 seconds',CURRENT_TIMESTAMP)`, [adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO agent_run_media(id,run_id,user_id,kind,mime_type,data_base64)
    VALUES('postgres-admin-agent-media',$1,$2,'image','image/png','raw-media-must-not-leak')`, [adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO agent_run_events(run_id,user_id,sequence,agent_name,event_type,summary,payload_json) VALUES
    ($1,$2,1,'Supervisor','routing_started','开始分派','{"specialists":["VisionAgent"]}'::jsonb),
    ($1,$2,2,'VisionAgent','agent_completed','视觉识别完成','{"confidence":0.93}'::jsonb),
    ($1,$2,3,'OperationsAgent','agent_completed','动作完成',NULL),
    ($1,$2,4,'Supervisor','run_completed','运行完成',NULL)`, [adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'add_inventory_item','high','awaiting_approval','{"foodName":"生菜"}'::jsonb,$1)`,
  [adminAgentActionId, adminAgentRunId, user.id]);
  await pool.query(`INSERT INTO ai_usage_logs(user_id,endpoint,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,
    success,estimated_cost_usd,run_id,agent_name,phase) VALUES
    ($1,'agent:Supervisor','postgres-supervisor',120,30,150,800,TRUE,0.0012,$2,'Supervisor','routing'),
    ($1,'agent:VisionAgent','postgres-vision',200,50,250,1200,TRUE,0.0025,$2,'VisionAgent','recognition')`,
  [user.id, adminAgentRunId]);
  await postgresCheckpointer.put(
    { configurable: { thread_id: adminAgentRunId, checkpoint_ns: "" } },
    {
      v: 1, id: "00000000-0000-6000-8000-000000000002", ts: new Date().toISOString(),
      channel_values: { goal: "识别 PostgreSQL 沙拉" }, channel_versions: { goal: "1" }, versions_seen: {},
    },
    { source: "loop", step: 1, parents: {} }, { goal: "1" },
  );
  const adminAgentRunsService = new AdminAgentRunsService(new PostgresAdminAgentRunsRepository(pool));
  const adminAgentList = await adminAgentRunsService.list({ query: adminAgentRunId, modality: "image", agent: "VisionAgent", range: "all" });
  assert.equal(adminAgentList.total, 1);
  assert.equal(adminAgentList.items[0]?.specialists, "VisionAgent,OperationsAgent");
  assert.equal(adminAgentList.items[0]?.hasMedia, 1);
  assert.equal(adminAgentList.items[0]?.totalTokens, 400);
  assert.equal(adminAgentList.usageSummary.estimatedCostUsd, 0.0037);
  const adminAgentDetail = await adminAgentRunsService.detail(adminAgentRunId);
  assert.equal(adminAgentDetail.run.input.prompt, "识别 PostgreSQL 沙拉");
  assert.equal(adminAgentDetail.run.input.mediaRef, undefined);
  assert.equal(adminAgentDetail.run.checkpointCount, 1);
  assert.equal((adminAgentDetail.events[2]?.payload as { actions: Array<{ payload: { foodName: string } }> })
    .actions[0]?.payload.foodName, "生菜");
  assert.equal((adminAgentDetail.events[3]?.payload as { reply: string }).reply, "PostgreSQL 蔬菜沙拉");
  assert.equal(adminAgentDetail.usage.summary.totalTokens, 400);
  assert.equal(JSON.stringify(adminAgentDetail).includes("raw-media-must-not-leak"), false);
  const schedulingService = new AgentSchedulingService(new PostgresAgentSchedulingRepository(pool));
  const schedulingRunIds = [0, 1, 2, 3].map((index) => `postgres-agent-scheduling-${user.id}-${index}`);
  await pool.query("DELETE FROM agent_runs WHERE id=ANY($1::text[])", [schedulingRunIds]);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id,created_at)
    SELECT id,$1,id,'text','assistant',status,'{}'::jsonb,id,created_at FROM UNNEST(
      $2::text[],$3::text[],$4::timestamptz[]) AS seed(id,status,created_at)`, [user.id, schedulingRunIds,
    ["running", "queued", "queued", "queued"],
    ["2026-09-01T00:00:00Z", "2026-09-01T00:00:01Z", "2026-09-01T00:00:02Z", "2026-09-01T00:00:03Z"]]);
  const concurrentSchedulingClaims = await Promise.all([
    schedulingService.claimQueuedRuns(user.id, 2), schedulingService.claimQueuedRuns(user.id, 2),
  ]);
  assert.deepEqual(concurrentSchedulingClaims.flat(), [schedulingRunIds[1]]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM agent_runs
    WHERE id=ANY($1::text[]) AND status='running'`, [schedulingRunIds])).rows[0]?.count), 2);
  const schedulingActionId = `postgres-agent-scheduling-action-${user.id}`;
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'record_diet_meal','high','awaiting_approval','{}'::jsonb,$1)`,
  [schedulingActionId, schedulingRunIds[1], user.id]);
  assert.equal(await schedulingService.expireAwaitingApproval(schedulingRunIds[1]!, user.id), 1);
  assert.equal((await pool.query("SELECT status FROM agent_actions WHERE id=$1", [schedulingActionId])).rows[0]?.status, "expired");
  assert.equal(await schedulingService.resetInterruptedRuns() >= 2, true);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM agent_runs
    WHERE id=ANY($1::text[]) AND status='queued'`, [schedulingRunIds])).rows[0]?.count), 4);
  const operationsService = new AgentOperationsService(new PostgresAgentOperationsRepository(pool));
  const operationsRunId = `postgres-agent-operations-${user.id}`;
  const operationsActionId = `postgres-agent-operations-action-${user.id}`;
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [operationsRunId, user.id]);
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'add_shopping_items','low','proposed',$4,$1)`,
  [operationsActionId, operationsRunId, user.id, { items: [{ name: "PostgreSQL Agent 番茄", amount: "2个" }] }]);
  const operationsProposal = { id: operationsActionId, actionType: "add_shopping_items" as const, riskLevel: "low" as const,
    summary: "加入 PostgreSQL 采购清单", payload: { items: [{ name: "PostgreSQL Agent 番茄", amount: "2个" }] } };
  const concurrentOperations = await Promise.all([
    operationsService.executeActions(user.id, operationsRunId, [operationsProposal]),
    operationsService.executeActions(user.id, operationsRunId, [operationsProposal]),
  ]);
  assert.deepEqual(concurrentOperations[0], concurrentOperations[1]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM shopping_list_items
    WHERE user_id=$1 AND source_run_id=$2`, [user.id, operationsRunId])).rows[0]?.count), 1);
  assert.deepEqual(await operationsService.undoActions(user.id, operationsRunId), { undone: 1 });
  assert.equal((await pool.query(`SELECT status FROM agent_actions WHERE id=$1`, [operationsActionId])).rows[0]?.status, "undone");
  assert.equal((await pool.query(`SELECT deleted_at IS NOT NULL AS deleted,version FROM shopping_list_items
    WHERE source_run_id=$1`, [operationsRunId])).rows[0]?.deleted, true);
  await assert.rejects(() => operationsService.undoActions(user.id, operationsRunId), /没有可撤销/);

  const failedOperationsRunId = `postgres-agent-operations-failed-${user.id}`;
  const failedOperationsActionIds = ["first", "second"].map((suffix) => `${failedOperationsRunId}-${suffix}`);
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [failedOperationsRunId, user.id]);
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$3,$4,'add_shopping_items','low','proposed','{}'::jsonb,$1),
          ($2,$3,$4,'update_shopping_item','low','proposed','{}'::jsonb,$2)`,
  [failedOperationsActionIds[0], failedOperationsActionIds[1], failedOperationsRunId, user.id]);
  await assert.rejects(() => operationsService.executeActions(user.id, failedOperationsRunId, [
    { id: failedOperationsActionIds[0], actionType: "add_shopping_items", riskLevel: "low", summary: "应整体回滚",
      payload: { items: [{ name: "PostgreSQL 应回滚" }] } },
    { id: failedOperationsActionIds[1], actionType: "update_shopping_item", riskLevel: "low", summary: "触发回滚",
      payload: { itemId: "missing" } },
  ]), /不存在或无权修改/);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM shopping_list_items
    WHERE user_id=$1 AND name='PostgreSQL 应回滚'`, [user.id])).rows[0]?.count), 0);
  assert.deepEqual((await pool.query(`SELECT status FROM agent_actions WHERE id=ANY($1::text[]) ORDER BY id`,
    [failedOperationsActionIds])).rows.map((row) => row.status), ["failed", "failed"]);

  const operationTypesRunId = `postgres-agent-operation-types-${user.id}`;
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [operationTypesRunId, user.id]);
  const insertOperationProposals = async (proposals: ExecutableAgentAction[]) => {
    for (const proposal of proposals) {
      await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
        VALUES($1,$2,$3,$4,$5,'proposed',$6,$1)`,
      [proposal.id, operationTypesRunId, user.id, proposal.actionType, proposal.riskLevel, proposal.payload]);
    }
  };
  const createOperationProposals: ExecutableAgentAction[] = [
    { id: `${operationTypesRunId}-plan`, actionType: "create_meal_plan", riskLevel: "low", summary: "创建餐单",
      payload: { title: "PostgreSQL Agent 餐单", startDate: "2026-09-01", endDate: "2026-09-02", constraints: { salt: "low" },
        items: [{ date: "2026-09-01", mealType: "晚餐", title: "番茄蛋", ingredients: ["番茄"], steps: ["翻炒"], calories: 320.4 }] } },
    { id: `${operationTypesRunId}-shopping`, actionType: "add_shopping_items", riskLevel: "low", summary: "创建采购项",
      payload: { items: [{ name: "PostgreSQL Agent 洋葱", amount: "1个", category: "蔬菜" }] } },
    { id: `${operationTypesRunId}-diet`, actionType: "record_diet_meal", riskLevel: "high", summary: "记录饮食",
      payload: { foodName: "PostgreSQL Agent 午餐", calories: 430.6, recordedAt: "2026-09-01" } },
    { id: `${operationTypesRunId}-inventory`, actionType: "add_inventory_item", riskLevel: "high", summary: "增加库存",
      payload: { name: "PostgreSQL Agent 土豆", quantity: "2个", expireDays: 5 } },
    { id: `${operationTypesRunId}-kitchenware`, actionType: "add_kitchenware_item", riskLevel: "high", summary: "增加厨具",
      payload: { name: "PostgreSQL Agent 炒锅", category: "锅具" } },
    { id: `${operationTypesRunId}-recipe`, actionType: "submit_recipe", riskLevel: "high", summary: "提交菜谱",
      payload: { title: "PostgreSQL Agent 菜谱", cookTime: 12.7, calories: 280.8, tags: ["测试"], steps: ["烹饪"], ingredients: ["土豆"] } },
  ];
  await insertOperationProposals(createOperationProposals);
  assert.equal((await operationsService.executeActions(user.id, operationTypesRunId, createOperationProposals)).length, 6);
  const createdPlan = (await pool.query("SELECT id FROM meal_plans WHERE created_by_run_id=$1", [operationTypesRunId])).rows[0];
  const createdShopping = (await pool.query("SELECT id FROM shopping_list_items WHERE source_run_id=$1", [operationTypesRunId])).rows[0];
  const createdInventory = (await pool.query("SELECT id FROM inventory_items WHERE user_id=$1 AND food_name='PostgreSQL Agent 土豆'", [user.id])).rows[0];
  assert(createdPlan?.id && createdShopping?.id && createdInventory?.id);
  const mutateOperationProposals: ExecutableAgentAction[] = [
    { id: `${operationTypesRunId}-plan-update`, actionType: "update_meal_plan", riskLevel: "low", summary: "更新餐单",
      payload: { planId: createdPlan.id, title: "PostgreSQL Agent 新餐单" } },
    { id: `${operationTypesRunId}-shopping-update`, actionType: "update_shopping_item", riskLevel: "low", summary: "更新采购项",
      payload: { itemId: createdShopping.id, amount: "3个", checked: true } },
    { id: `${operationTypesRunId}-inventory-update`, actionType: "update_inventory_item", riskLevel: "high", summary: "更新库存",
      payload: { itemId: createdInventory.id, name: "PostgreSQL Agent 新土豆" } },
    { id: `${operationTypesRunId}-inventory-consume`, actionType: "consume_inventory_items", riskLevel: "high", summary: "消耗库存",
      payload: { itemIds: [createdInventory.id] } },
    { id: `${operationTypesRunId}-plan-delete`, actionType: "delete_meal_plan", riskLevel: "high", summary: "删除餐单",
      payload: { planId: createdPlan.id } },
    { id: `${operationTypesRunId}-shopping-delete`, actionType: "delete_shopping_item", riskLevel: "high", summary: "删除采购项",
      payload: { itemId: createdShopping.id } },
  ];
  await insertOperationProposals(mutateOperationProposals);
  assert.equal((await operationsService.executeActions(user.id, operationTypesRunId, mutateOperationProposals)).length, 6);
  assert.deepEqual((await pool.query(`SELECT deleted_at IS NOT NULL AS deleted,title FROM meal_plans WHERE id=$1`, [createdPlan.id])).rows[0],
    { deleted: true, title: "PostgreSQL Agent 新餐单" });
  assert.deepEqual((await pool.query(`SELECT deleted_at IS NOT NULL AS deleted,amount,checked FROM shopping_list_items WHERE id=$1`, [createdShopping.id])).rows[0],
    { deleted: true, amount: "3个", checked: true });
  assert.deepEqual((await pool.query(`SELECT food_name,is_available FROM inventory_items WHERE id=$1`, [createdInventory.id])).rows[0],
    { food_name: "PostgreSQL Agent 新土豆", is_available: false });
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM agent_actions
    WHERE run_id=$1 AND status='executed'`, [operationTypesRunId])).rows[0]?.count), 12);
  const healthOperationRunId = `postgres-agent-operation-health-${householdMember}`;
  const healthOperationActionId = `${healthOperationRunId}-action`;
  await pool.query(`INSERT INTO agent_runs(id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES($1,$2,$1,'text','assistant','running','{}'::jsonb,$1)`, [healthOperationRunId, householdMember]);
  const healthOperationProposal: ExecutableAgentAction = { id: healthOperationActionId, actionType: "record_health_log",
    riskLevel: "high", summary: "记录健康", payload: { weightKg: 60.7, waterMl: 500.4, recordedDate: "2025-09-01" } };
  await pool.query(`INSERT INTO agent_actions(id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES($1,$2,$3,'record_health_log','high','proposed',$4,$1)`,
  [healthOperationActionId, healthOperationRunId, householdMember, healthOperationProposal.payload]);
  const healthOperationResult = await operationsService.executeActions(householdMember, healthOperationRunId, [healthOperationProposal]);
  const healthOperationId = Number((healthOperationResult[0]?.result as { healthLogId: number }).healthLogId);
  assert.deepEqual((await pool.query("SELECT weight,water_ml,recorded_date FROM health_logs WHERE id=$1", [healthOperationId])).rows[0],
    { weight: 60.7, water_ml: 500, recorded_date: "2025-09-01" });
  const realtimeRepository = new PostgresRealtimeVoiceRepository(pool);
  const cancelledRealtimeRuns: string[] = [];
  const realtimeService = new RealtimeVoiceService(realtimeRepository, {
    transcribe: async () => ({ text: "  PostgreSQL 增量转写  " }),
    startRun: async () => ({ run: { id: "postgres-realtime-run", status: "queued" } }),
    waitForRun: async (id) => ({ id, status: "completed", reply: "保持中火并持续翻炒。" }),
    cancelRun: async (_userId, runId) => { cancelledRealtimeRuns.push(runId); },
  });
  const realtimeInput = { recipeId: Number(queueRecipe.id), platform: "ios", idempotencyKey: "postgres-realtime-session-0001",
    currentStep: 1, recipeSteps: ["备菜", "翻炒"], recipeIngredients: ["番茄", "鸡蛋"] };
  const concurrentRealtimeSessions = await Promise.all([
    realtimeService.create(user.id, realtimeInput), realtimeService.create(user.id, realtimeInput),
  ]);
  assert.deepEqual(concurrentRealtimeSessions.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(concurrentRealtimeSessions[0]!.session.id, concurrentRealtimeSessions[1]!.session.id);
  const realtimeSessionId = concurrentRealtimeSessions[0]!.session.id;
  const mutedRealtime = await realtimeService.heartbeat(user.id, realtimeSessionId, { version: 1, muted: true, reconnect: true });
  assert.equal(mutedRealtime.session.version, 2);
  assert.equal(mutedRealtime.session.metrics.reconnects, 1);
  await assert.rejects(() => realtimeService.heartbeat(user.id, realtimeSessionId, { version: 1 }), /会话状态已更新/);
  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    realtimeRepository.emitEvent(realtimeSessionId, "integration.concurrent", { index })));
  const concurrentRealtimeEvents = await realtimeRepository.events(realtimeSessionId, 0);
  assert.deepEqual(concurrentRealtimeEvents.map((event) => event.sequence),
    Array.from({ length: concurrentRealtimeEvents.length }, (_, index) => index + 1));
  const audioInput = { turnId: "postgres-audio-turn", sequence: 1, audioBase64: "YXVkaW8=", mimeType: "audio/webm", final: true };
  assert.equal((await realtimeService.audio(user.id, realtimeSessionId, audioInput)).transcript, "PostgreSQL 增量转写");
  assert.equal((await realtimeService.audio(user.id, realtimeSessionId, audioInput)).repeated, true);
  const realtimeControl = await realtimeService.turn(user.id, realtimeSessionId,
    { turnId: "postgres-control-turn", transcript: "增加3分钟", currentStep: 1, timerSeconds: 0 });
  assert.deepEqual(realtimeControl.action, { action: "ADD_TIMER", seconds: 180 });
  const realtimeQuestion = await realtimeService.turn(user.id, realtimeSessionId,
    { turnId: "postgres-question-turn", transcript: "火候怎么控制", currentStep: 2, timerSeconds: 30 });
  assert.equal(realtimeQuestion.intent, "question");
  let realtimeResponseCompleted = false;
  for (let attempt = 0; attempt < 50 && !realtimeResponseCompleted; attempt += 1) {
    realtimeResponseCompleted = (await realtimeRepository.events(realtimeSessionId, 0))
      .some((event) => event.type === "response.completed");
    if (!realtimeResponseCompleted) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(realtimeResponseCompleted, true);
  const realtimeNativeTypes = (await pool.query(`SELECT pg_typeof(s.context_json)::text AS context_type,
    pg_typeof(c.is_final)::text AS final_type, c.is_final FROM realtime_voice_sessions s
    JOIN realtime_voice_transcript_chunks c ON c.session_id=s.id WHERE s.id=$1`, [realtimeSessionId])).rows[0];
  assert.deepEqual(realtimeNativeTypes, { context_type: "jsonb", final_type: "boolean", is_final: true });
  assert.equal((await realtimeService.close(user.id, realtimeSessionId)).session.status, "closed");
  assert.deepEqual(cancelledRealtimeRuns, ["postgres-realtime-run"]);
  const queueInput = {
    userId: user.id,
    recipeId: Number(queueRecipe.id),
    idempotencyKey: "postgres-queue-idempotency-0001",
    snapshot: { title: queueRecipe.title, ingredients: queueRecipe.ingredients_json },
  };
  const queued = await Promise.all([
    cookingQueueRepository.enqueue({ ...queueInput, id: "44444444-4444-4444-8444-444444444444" }, 30),
    cookingQueueRepository.enqueue({ ...queueInput, id: "55555555-5555-4555-8555-555555555555" }, 30),
  ]);
  assert.deepEqual(queued.map((result) => result.kind).sort(), ["created", "existing"]);
  if (queued[0]!.kind === "full" || queued[1]!.kind === "full") throw new Error("queue unexpectedly full");
  assert.equal(queued[0]!.row.id, queued[1]!.row.id);
  const firstQueueId = String(queued[0]!.row.id);
  const updatedQueue = await cookingQueueRepository.update(firstQueueId, user.id, 1, {
    status: "preparing", mealType: "dinner", plannedAt: null, preparedIngredients: ["番茄"],
    shoppingListSyncedAt: null, completedAt: null,
  });
  assert.equal(updatedQueue?.version, 2);
  assert.equal(await cookingQueueRepository.update(firstQueueId, user.id, 1, {
    status: "ready", mealType: null, plannedAt: null, preparedIngredients: [], shoppingListSyncedAt: null, completedAt: null,
  }), null);
  const secondRecipe = queueRecipes.rows[1]!;
  const secondQueued = await cookingQueueRepository.enqueue({
    id: "66666666-6666-4666-8666-666666666666", userId: user.id, recipeId: Number(secondRecipe.id),
    snapshot: { title: secondRecipe.title, ingredients: secondRecipe.ingredients_json },
  }, 30);
  assert.equal(secondQueued.kind, "created");
  const activeQueue = await cookingQueueRepository.list(user.id, false);
  const reorderedQueue = await cookingQueueRepository.reorder(user.id,
    [...activeQueue].reverse().map((item) => ({ id: String(item.id), version: Number(item.version) })));
  assert.equal(reorderedQueue?.[0]?.id, "66666666-6666-4666-8666-666666666666");
  const reorderedFirst = reorderedQueue!.find((item) => item.id === firstQueueId)!;
  const startedQueue = await cookingQueueRepository.transition(firstQueueId, user.id, Number(reorderedFirst.version), "cooking");
  const completedQueue = await cookingQueueRepository.transition(firstQueueId, user.id, Number(startedQueue!.version), "completed");
  assert.equal(completedQueue?.status, "completed");
  assert.equal(await cookingQueueRepository.cancel("66666666-6666-4666-8666-666666666666", user.id), true);

  const mealPlanRepository = new PostgresMealPlansRepository(pool);
  const mealPlanId = "77777777-7777-4777-8777-777777777777";
  const mealPlanItemId = "88888888-8888-4888-8888-888888888888";
  await pool.query(`INSERT INTO meal_plans
    (id, user_id, title, start_date, end_date, status, source, constraints_json)
    VALUES ($1, $2, 'Postgres 并发餐单', '2026-09-01', '2026-09-07', 'active', 'manual', '{"servings":2}'::jsonb)`,
  [mealPlanId, user.id]);
  await pool.query(`INSERT INTO meal_plan_items
    (id, plan_id, user_id, planned_date, meal_type, title, recipe_id, ingredients_json, steps_json,
     calories, protein, carbs, fat)
    VALUES ($1, $2, $3, '2026-09-03', '晚餐', 'Postgres 餐单料理', $4,
      '[{"name":"Postgres 餐单专用姜","amount":"10g"}]'::jsonb, '["烹饪"]'::jsonb, 260, 15, 20, 12)`,
  [mealPlanItemId, mealPlanId, user.id, Number(queueRecipe.id)]);
  assert.equal((await mealPlanRepository.list(user.id + 1, false)).length, 0);
  const initialMealPlan = await mealPlanRepository.find(user.id, mealPlanId, false);
  assert.equal(initialMealPlan?.items instanceof Array, true);
  const updatedMealPlanItem = await mealPlanRepository.updateItem(user.id, mealPlanId, mealPlanItemId, {
    version: 1, plannedDate: "2026-09-04",
  });
  assert.equal(updatedMealPlanItem.kind, "updated");
  assert.equal((await mealPlanRepository.updateItem(user.id, mealPlanId, mealPlanItemId, {
    version: 1, plannedDate: "2026-09-05",
  })).kind, "version_conflict");
  const shoppingResults = await Promise.all([
    mealPlanRepository.addShopping(user.id, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-shopping-0001",
    }),
    mealPlanRepository.addShopping(user.id, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-shopping-0001",
    }),
  ]);
  const shoppingValues = shoppingResults.map((result) => {
    if (result.kind !== "completed") throw new Error("meal plan shopping failed");
    return result.value as Record<string, unknown> & { repeated: boolean };
  });
  assert.deepEqual(shoppingValues.map((result) => result.repeated).sort(), [false, true]);
  assert.equal((await pool.query(`SELECT COUNT(*)::integer AS count FROM shopping_list_items
    WHERE user_id = $1 AND client_id LIKE $2`, [user.id, `meal-plan:${mealPlanItemId}:%`])).rows[0]?.count, 1);
  const mealQueueResults = await Promise.all([
    mealPlanRepository.enqueue(user.id, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-queue-0001",
    }),
    mealPlanRepository.enqueue(user.id, mealPlanId, mealPlanItemId, {
      version: 2, idempotencyKey: "postgres-meal-plan-queue-0001",
    }),
  ]);
  const mealQueueValues = mealQueueResults.map((result) => {
    if (result.kind !== "completed") throw new Error("meal plan queue failed");
    return result.value as Record<string, unknown> & { repeated: boolean };
  });
  assert.deepEqual(mealQueueValues.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(mealQueueValues[0]!.queueItemId, mealQueueValues[1]!.queueItemId);
  const mealCompletionResults = await Promise.all([
    mealPlanRepository.complete(user.id, mealPlanId, mealPlanItemId, {
      version: 3, idempotencyKey: "postgres-meal-plan-complete-0001",
    }),
    mealPlanRepository.complete(user.id, mealPlanId, mealPlanItemId, {
      version: 3, idempotencyKey: "postgres-meal-plan-complete-0001",
    }),
  ]);
  const mealCompletionValues = mealCompletionResults.map((result) => {
    if (result.kind !== "completed") throw new Error("meal plan completion failed");
    return result.value as Record<string, unknown> & { repeated: boolean };
  });
  assert.deepEqual(mealCompletionValues.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(mealCompletionValues[0]!.dietRecordId, mealCompletionValues[1]!.dietRecordId);
  const updatedMealPlan = await mealPlanRepository.updatePlan(user.id, mealPlanId, { version: 1, title: "Postgres 已更新餐单" });
  assert.equal(updatedMealPlan.kind, "updated");
  assert.equal((await mealPlanRepository.removePlan(user.id + 1, mealPlanId, 2)), "not_found");
  assert.equal((await mealPlanRepository.removePlan(user.id, mealPlanId, 2)), "removed");
  assert.equal(await mealPlanRepository.find(user.id, mealPlanId, false), null);
  assert.equal((await mealPlanRepository.find(user.id, mealPlanId, true))?.archived, true);

  const voicePacksRepository = new PostgresVoicePacksRepository(pool);
  const voicePacksService = new VoicePacksService(voicePacksRepository);
  const voiceManifest = {
    voiceId: "postgres-licensed-zh", name: "Postgres 授权音色", version: "1.0.0", language: "zh-CN",
    sampleRate: 22050, outputFormat: "pcm-f32" as const, minimumAppVersion: "1.0.0", minimumMemoryMb: 512,
    license: { name: "Apache-2.0", url: "https://example.com/license", speakerAuthorization: "postgres-record", modelNotice: "extractable" },
    resources: [{ path: "model.onnx", url: "https://example.com/model.onnx", sha256: "c".repeat(64), bytes: 1024 }],
    model: { path: "model.onnx", vocabularyPath: "model.onnx", inputNames: { tokens: "tokens", lengths: "lengths" } },
  };
  const createdVoice = await voicePacksService.create(user.id, { manifest: voiceManifest, providerVoice: "alloy" }, {});
  const voiceId = Number(createdVoice.id);
  const preferenceCreates = await Promise.all([
    voicePacksRepository.updatePreference(user.id, 0, null, null, "automatic"),
    voicePacksRepository.updatePreference(user.id, 0, null, null, "automatic"),
  ]);
  assert.equal(preferenceCreates.filter(Boolean).length, 1);
  const publishAudit = { adminUserId: user.id, action: "voice_pack.published", resourceId: voiceId, summary: "Postgres publish" };
  const publishes = await Promise.all([
    voicePacksRepository.transition(user.id, voiceId, 1, "draft", "published", "发布审核通过", publishAudit),
    voicePacksRepository.transition(user.id, voiceId, 1, "draft", "published", "发布审核通过", publishAudit),
  ]);
  assert.equal(publishes.filter(Boolean).length, 1);
  const catalog = await voicePacksService.catalog("1.0.0");
  assert.equal(catalog.items.some((item) => item.voiceId === voiceManifest.voiceId), true);
  const preference = await voicePacksRepository.preference(user.id);
  const revokeAudit = { adminUserId: user.id, action: "voice_pack.revoked", resourceId: voiceId, summary: "Postgres revoke" };
  const [selected, revokedVoice] = await Promise.all([
    voicePacksRepository.updatePreference(user.id, preference.version, voiceManifest.voiceId, voiceManifest.version, "automatic"),
    voicePacksRepository.transition(user.id, voiceId, 2, "published", "revoked", "紧急撤销测试", revokeAudit),
  ]);
  assert.equal(revokedVoice?.status, "revoked");
  const clearedPreference = await voicePacksRepository.preference(user.id);
  assert.equal(clearedPreference.selectedVoiceId, null);
  assert.equal(clearedPreference.version, selected ? selected.version + 1 : preference.version);
  assert.equal((await voicePacksRepository.history(voiceId)).length, 3);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE resource_type = 'voice_pack_version' AND resource_id = $1`, [String(voiceId)])).rows[0]?.count), 3);

  const kitchenwareRepository = new PostgresKitchenwareRepository(pool);
  const kitchenwareService = new KitchenwareService(kitchenwareRepository);
  const postgresCatalog = await kitchenwareService.catalog("不粘锅");
  assert.equal(postgresCatalog[0]?.name, "平底锅");
  assert.equal(postgresCatalog[0]?.capabilities.some((capability) => capability.code === "fry"), true);
  const postgresPan = await kitchenwareService.create(user.id, {
    name: "不粘锅", category: "烹饪锅具", status: "需保养", note: "Postgres 厨具",
    image_url: "", purchase_date: "2026-08-31",
  });
  assert.equal(postgresPan.name, "平底锅");
  assert.equal((await kitchenwareRepository.listItems(user.id + 1)).length, 0);
  assert.equal(await kitchenwareRepository.findOwnedItem(user.id + 1, Number(postgresPan.id)), null);
  const maintainedPan = await kitchenwareRepository.maintainItem(user.id, Number(postgresPan.id));
  assert.equal(maintainedPan?.status, "良好");

  const adminKitchenwareRepository = new PostgresAdminKitchenwareRepository(pool);
  const adminKitchenwareService = new AdminKitchenwareService(adminKitchenwareRepository);
  const adminKitchenwareContext = { adminUserId: user.id, ipAddress: "127.0.0.1", userAgent: "postgres-integration" };
  const adminCatalog = await adminKitchenwareService.createCatalog({
    name: "Postgres 管理炖锅", category: "烹饪锅具", aliases: ["PG 炖锅"], cooking_methods: ["炖"], care_note: "保持干燥",
  }, adminKitchenwareContext);
  assert.equal(adminCatalog.aliases, '["PG 炖锅"]');
  assert.equal((await adminKitchenwareService.catalog({ search: "PG 炖锅" })).some((item) => Number(item.id) === Number(adminCatalog.id)), true);
  await assert.rejects(() => adminKitchenwareService.createCatalog({
    name: "Postgres 管理炖锅", category: "烹饪锅具", aliases: [], cooking_methods: [], care_note: "",
  }, adminKitchenwareContext), /已存在/);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE action='kitchenware_catalog.create' AND resource_id=$1`, [String(adminCatalog.id)])).rows[0]?.count), 1);
  const updatedAdminCatalog = await adminKitchenwareService.updateCatalog(Number(adminCatalog.id), {
    name: "Postgres 管理汤锅", category: "烹饪锅具", aliases: ["PG 汤锅"], cooking_methods: ["煮", "炖"], care_note: "擦干",
  }, adminKitchenwareContext);
  assert.equal(updatedAdminCatalog.cooking_methods, '["煮","炖"]');
  const moderatedAsset = await kitchenwareService.create(user.id, {
    name: "Postgres 管理资产", category: "其他", status: "良好", note: "moderation", image_url: "", purchase_date: "",
  });
  await adminKitchenwareService.updateAssetStatus(Number(moderatedAsset.id), "需保养", adminKitchenwareContext);
  assert.equal((await pool.query("SELECT status FROM kitchenware_items WHERE id=$1", [moderatedAsset.id])).rows[0]?.status, "需保养");
  await adminKitchenwareService.removeAsset(Number(moderatedAsset.id), adminKitchenwareContext);
  assert((await pool.query("SELECT deleted_at FROM kitchenware_items WHERE id=$1", [moderatedAsset.id])).rows[0]?.deleted_at);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE resource_type='kitchenware' AND resource_id=$1`, [String(moderatedAsset.id)])).rows[0]?.count), 2);
  await adminKitchenwareService.removeCatalog(Number(adminCatalog.id), adminKitchenwareContext);

  const kitchenwareRecipe = await pool.query(`INSERT INTO recipes
    (title, cook_time, steps_json, ingredients_json, source, status, quality_status, data_license,
     source_revision, serving_size, required_kitchenware_json)
    VALUES ('Postgres 厨具替代菜', 20, '["烹饪测试"]'::jsonb, '[{"name":"番茄"}]'::jsonb,
      'official', 'approved', 'trusted', 'DietDigiDose-Original', 'postgres-kitchenware-v1', 1, '["空气炸锅"]'::jsonb)
    RETURNING id`);
  const kitchenwareRecipeId = Number(kitchenwareRecipe.rows[0]!.id);
  const kitchenwareCatalogIds = await pool.query("SELECT id, name FROM kitchenware_catalog WHERE name IN ('空气炸锅', '烤箱')");
  const airFryerId = Number(kitchenwareCatalogIds.rows.find((row) => row.name === "空气炸锅")!.id);
  await pool.query(`INSERT INTO recipe_kitchenware_requirements
    (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
    VALUES ($1, $2, NULL, 'required', 'test', 1, 'Postgres 空气炸锅测试')`, [kitchenwareRecipeId, airFryerId]);
  await kitchenwareService.create(user.id, {
    name: "烤箱", category: "小家电", status: "良好", note: "", image_url: "", purchase_date: "",
  });
  const postgresCompatibility = await kitchenwareService.compatibility(user.id, kitchenwareRecipeId);
  assert.equal(postgresCompatibility.blocking.length, 0);
  assert.equal(postgresCompatibility.requirements[0]?.substitution?.name, "烤箱");
  assert.equal(await kitchenwareRepository.removeItem(user.id + 1, Number(postgresPan.id)), false);
  assert.equal(await kitchenwareRepository.removeItem(user.id, Number(postgresPan.id)), true);

  const recommendationsRepository = new PostgresRecommendationsRepository(pool);
  const recommendationsService = new RecommendationsService(recommendationsRepository, kitchenwareService);
  const recommendationPage = await recommendationsService.page(user.id, {
    surface: "home", matchStatus: "all", pageSize: 1,
  });
  assert(recommendationPage.total > 0);
  assert.equal(recommendationPage.items.length, 1);
  const recommendationSnapshot = await pool.query(`SELECT input_snapshot_json, results_json FROM recipe_recommendation_requests
    WHERE id = $1 AND user_id = $2`, [recommendationPage.requestId, user.id]);
  assert.equal(Array.isArray(recommendationSnapshot.rows[0]?.results_json), true);
  assert.equal(recommendationSnapshot.rows[0]?.input_snapshot_json.surface, "home");
  if (recommendationPage.nextCursor) {
    const nextRecommendationPage = await recommendationsService.page(user.id, {
      surface: "home", matchStatus: "all", pageSize: 1, cursor: recommendationPage.nextCursor,
    });
    assert.equal(nextRecommendationPage.requestId, recommendationPage.requestId);
  }
  const recommendedRecipeId = Number(recommendationPage.items[0]!.recipeId);
  const recommendationEventInput = {
    requestId: recommendationPage.requestId, recipeId: recommendedRecipeId, eventType: "view",
    scoringVersion: recommendationPage.scoringVersion, surface: "home", metadata: { source: "postgres-integration" },
    idempotencyKey: "postgres-recommendation-event-0001",
  };
  const recommendationEvents = await Promise.all([
    recommendationsService.event(user.id, recommendationEventInput),
    recommendationsService.event(user.id, recommendationEventInput),
  ]);
  assert.deepEqual(recommendationEvents.map((result) => result.repeated).sort(), [false, true]);
  assert.equal(recommendationEvents[0]!.eventId, recommendationEvents[1]!.eventId);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM recipe_recommendation_events
    WHERE user_id = $1 AND idempotency_key = $2`, [user.id, recommendationEventInput.idempotencyKey])).rows[0]?.count), 1);

  const aiToolDataService = new AiToolDataService(new PostgresAiToolDataRepository(pool));
  await pool.query(`INSERT INTO recipes
    (title, cook_time, difficulty, calories, protein, carbs, fat, tags, ingredients_json, source, status, quality_status)
    VALUES ('Postgres AI 工具菜', 14, '简单', 280, 19, 24, 9, '["AI工具"]'::jsonb,
      '[{"name":"PG专用番茄"}]'::jsonb, 'official', 'approved', 'trusted')`);
  const aiRecipes = await aiToolDataService.searchRecipes({ ingredientNames: ["PG专用番茄"], maxTimeMinutes: 15,
    maxCalories: 300, minProteinG: 18, limit: 2 });
  assert.equal(aiRecipes.recipes.length, 1);
  assert.equal(aiRecipes.recipes[0]?.name, "Postgres AI 工具菜");
  assert.deepEqual(aiRecipes.recipes[0]?.tags, ["AI工具"]);
  await pool.query(`INSERT INTO ingredients_library
    (name, category, calories_100g, protein_100g, carbs_100g, fat_100g, source, quality_status)
    VALUES ('PG专用燕麦', '主食', 380, 13.2, 67.5, 6.5, 'postgres-integration', 'trusted')`);
  const aiNutrition = await aiToolDataService.lookupFoodNutrition("PG专用燕麦", 50, "g");
  assert.deepEqual(aiNutrition.matches[0]?.nutrition,
    { caloriesKcal: 190, proteinG: 6.6, carbohydrateG: 33.8, fatG: 3.3 });
  const aiDietId = await aiToolDataService.recordDietMeal({ userId: user.id, mealType: "午餐", foodName: "Postgres AI 工具餐",
    amount: "1份", calories: 280, protein: 19, carbs: 24, fat: 9, recordedAt: "2026-09-01", recordedTime: "12:30" });
  assert.equal((await pool.query("SELECT food_name FROM diet_records WHERE id = $1", [aiDietId])).rows[0]?.food_name,
    "Postgres AI 工具餐");

  await pool.query(`INSERT INTO system_settings (key, value) VALUES ('AI_SYSTEM_PROMPT', 'Postgres 食语人设')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`);
  await pool.query(`INSERT INTO user_health_profiles
    (user_id, age, dietary_preference, allergies_json, medical_conditions_json, dietary_restrictions_json,
      kitchen_constraints_json, nutrition_targets_json)
    VALUES ($1, 31, '清淡', '[{"name":"花生","type":"过敏","severity":"重度"}]'::jsonb, '["孕期"]'::jsonb,
      '["低盐"]'::jsonb, '{"meal_time_minutes":20}'::jsonb, '{"protein_g":90}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET age = EXCLUDED.age, dietary_preference = EXCLUDED.dietary_preference,
      allergies_json = EXCLUDED.allergies_json, medical_conditions_json = EXCLUDED.medical_conditions_json,
      dietary_restrictions_json = EXCLUDED.dietary_restrictions_json,
      kitchen_constraints_json = EXCLUDED.kitchen_constraints_json, nutrition_targets_json = EXCLUDED.nutrition_targets_json`, [user.id]);
  const aiContextService = new AiContextService(new PostgresAiContextRepository(pool));
  const aiContext = await aiContextService.load(user.id, "2026-09-01");
  assert.equal(aiContext.personaPrompt, "Postgres 食语人设");
  assert(aiContext.inventory.some((item) => item.food_name === "番茄"));
  assert(aiContext.kitchenware.some((item) => item.name === "烤箱"));
  assert(aiContext.todayDiet.some((item) => item.food_name === "Postgres AI 工具餐"));
  assert.equal(aiContext.latestHealth?.weight, 62.5);
  assert.deepEqual(aiContext.healthProfile?.allergies, [{ name: "花生", type: "过敏", severity: "重度" }]);
  assert.deepEqual(aiContext.healthProfile?.medical_conditions, ["孕期"]);
  assert.equal(aiContext.healthProfile?.kitchen_constraints.meal_time_minutes, 20);

  const aiRuntimeService = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), {
    AI_INPUT_COST_PER_MILLION_USD: "2", AI_OUTPUT_COST_PER_MILLION_USD: "4",
  });
  await aiRuntimeService.saveSettings([
    { key: "AI_API_KEY", value: "postgres-global-key" },
    { key: "AI_BASE_URL", value: "https://postgres-ai.test/v1/" },
    { key: "AI_CHAT_MODEL", value: "postgres-chat-model" },
    { key: "AI_RECIPE_MODEL", value: "postgres-recipe-model" },
  ]);
  const postgresAIConfig = await aiRuntimeService.config();
  assert.deepEqual(postgresAIConfig.chat,
    { apiKey: "postgres-global-key", baseUrl: "https://postgres-ai.test/v1", model: "postgres-chat-model" });
  assert.equal((await aiRuntimeService.agentConfig("RECIPE")).model, "postgres-recipe-model");
  await aiRuntimeService.recordUsage({ userId: user.id, endpoint: "postgres-ai-runtime", model: "postgres-chat-model",
    runId: "postgres-ai-runtime-run", agentName: "Recipe", phase: "integration", promptTokens: 1_000,
    completionTokens: 500, latencyMs: 33, success: false, failureReason: "integration failure" });
  const postgresAIUsage = (await pool.query(`SELECT total_tokens, success, estimated_cost_usd, failure_reason
    FROM ai_usage_logs WHERE user_id = $1 AND endpoint = 'postgres-ai-runtime'`, [user.id])).rows[0];
  assert.equal(Number(postgresAIUsage?.total_tokens), 1_500);
  assert.equal(postgresAIUsage?.success, false);
  assert.equal(Number(postgresAIUsage?.estimated_cost_usd), 0.004);
  assert.equal(postgresAIUsage?.failure_reason, "integration failure");

  const authVerificationService = new AuthVerificationService(new PostgresAuthVerificationRepository(pool));
  await authVerificationService.saveSettings([
    { key: "auth.sms.enabled", value: "1" },
    { key: "auth.sms.limit.phone_hour", value: "8" },
  ]);
  const postgresSmsConfig = await authVerificationService.config();
  assert.equal(postgresSmsConfig.enabled, true);
  assert.equal(postgresSmsConfig.phoneHourlyLimit, 8);
  const verificationSubject = await authVerificationService.findOrCreateSubject("18800001149");
  const sameVerificationSubject = await authVerificationService.findOrCreateSubject("18800001149");
  assert.equal(sameVerificationSubject.id, verificationSubject.id);
  assert.equal(authVerificationService.decryptPhone(verificationSubject), "18800001149");
  await authVerificationService.createChallenge({ id: "postgres-verification-send", subjectId: verificationSubject.id,
    purpose: "login", outId: "postgres-verification-out", expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sourceIp: "192.0.2.153", userAgent: "postgres-integration" });
  await authVerificationService.recordEvent({ subjectId: verificationSubject.id, challengeId: "postgres-verification-send",
    eventType: "send_api_called", outcome: "pending", sourceIp: "192.0.2.153", details: { postgres: true } });
  await authVerificationService.incrementUsage("send_api_calls");
  assert.equal(await authVerificationService.countSubjectSends(verificationSubject.id,
    new Date(Date.now() - 60_000).toISOString()), 1);
  assert.equal(await authVerificationService.countIpSends("192.0.2.153", new Date(Date.now() - 60_000).toISOString()), 1);
  await authVerificationService.acceptChallenge("postgres-verification-send", verificationSubject.id, "postgres-biz-153", "request-153");
  assert.equal((await authVerificationService.challenge("postgres-verification-send"))?.status, "accepted");
  assert.equal(await authVerificationService.recordDeliveryReport({ bizId: "postgres-biz-153", outId: "postgres-verification-out",
    providerCode: "OK", providerMessage: "delivered to 18800001149", success: true, units: 2, usageDate: "2026-09-01",
    details: { postgres: true, smsSize: 2 } }), true);
  assert.equal(await authVerificationService.recordDeliveryReport({ bizId: "postgres-biz-153", outId: "postgres-verification-out",
    providerCode: "OK", providerMessage: "delivered to 18800001149", success: true, units: 2, usageDate: "2026-09-01",
    details: { postgres: true, smsSize: 2 } }), false);
  const postgresVerificationOverview = await authVerificationService.usageOverview("2026-09-01");
  assert.equal(postgresVerificationOverview.totals.delivered, 1);
  assert.equal(postgresVerificationOverview.totals.deliveryUnits, 2);
  const postgresDeliveryEvent = (await authVerificationService.events({ providerId: "postgres-biz-153" }, 1, 20)).rows[0];
  assert.equal(postgresDeliveryEvent?.providerMessage, "delivered to [phone]");
  assert.deepEqual((await pool.query(`SELECT details_json FROM auth_verification_events
    WHERE challenge_id='postgres-verification-send' AND event_type='delivery_report'`)).rows[0]?.details_json,
  { postgres: true, smsSize: 2 });

  const registrationSubject = await authVerificationService.findOrCreateSubject("18800002149");
  await authVerificationService.createChallenge({ id: "postgres-verification-register", subjectId: registrationSubject.id,
    purpose: "login", outId: "postgres-registration-out", expiresAt: new Date(Date.now() + 300_000).toISOString(),
    sourceIp: "192.0.2.154", userAgent: "postgres-integration" });
  await authVerificationService.markRegistrationRequired({ challengeId: "postgres-verification-register",
    at: new Date().toISOString(), tokenHash: "postgres-registration-token-hash",
    expiresAt: new Date(Date.now() + 300_000).toISOString() });
  const postgresRegistration = await authVerificationService.register({ tokenHash: "postgres-registration-token-hash",
    phone: "18800002149", username: "postgres短信用户", passwordHash: "integration-password-hash", at: new Date().toISOString() });
  assert.equal(postgresRegistration.status, "created");
  if (postgresRegistration.status === "created") {
    assert.equal((await authVerificationService.userResponse(postgresRegistration.userId))?.phone, "18800002149");
    assert.equal((await authVerificationService.userByPhone("18800002149"))?.is_disabled, false);
    assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM user_health_profiles WHERE user_id=$1",
      [postgresRegistration.userId])).rows[0]?.count), 1);
  }
  assert.equal((await authVerificationService.register({ tokenHash: "postgres-registration-token-hash", phone: "18800002149",
    username: "postgres短信重复用户", passwordHash: "hash", at: new Date().toISOString() })).status, "invalid_token");

  if (postgresRegistration.status === "created") {
    const notificationUserId = postgresRegistration.userId;
    const notificationsRepository = new PostgresNotificationsRepository(pool);
    const notificationsService = createNotificationsService(notificationsRepository);
    const preferences = { ...await notificationsService.preferences(notificationUserId), breakfast_time: "07:30", expiring_alert: true };
    await notificationsService.savePreferences(notificationUserId, preferences);
    assert.equal((await notificationsService.preferences(notificationUserId)).breakfast_time, "07:30");
    await notificationsService.saveDevice(notificationUserId, "ExpoPushToken[postgres-notifications]", "ios");
    await notificationsRepository.ensureRoutineNotification({ userId: notificationUserId, kind: "meal", key: "breakfast",
      dateKey: "2026-09-01", title: "Postgres 早餐", body: "Postgres 例行提醒" });
    await notificationsRepository.ensureRoutineNotification({ userId: notificationUserId, kind: "meal", key: "breakfast",
      dateKey: "2026-09-01", title: "Postgres 早餐", body: "Postgres 例行提醒" });
    assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM user_notification_inbox
      WHERE user_id=$1 AND group_key='routine:meal:breakfast:2026-09-01'`, [notificationUserId])).rows[0].count), 1);
    await pool.query(`INSERT INTO inventory_items(user_id,food_name,category,quantity,expiration_date,quantity_value,quantity_unit,is_available)
      VALUES($1,'Postgres 临期苹果','水果','1个','2026-09-02',1,'个',TRUE)`, [notificationUserId]);
    const prepared = await notificationsRepository.prepareExpiring("2026-09-01", "2026-09-04");
    const preparedNotification = prepared.find((item) => item.userId === notificationUserId);
    assert(preparedNotification);
    assert.equal((await notificationsRepository.prepareExpiring("2026-09-01", "2026-09-04")).length, 0);
    const pendingHistory = await notificationsRepository.history(notificationUserId, "pending", null, 10);
    assert(pendingHistory.some((item) => Number(item.id) === preparedNotification.notificationId));
    const expiryNotificationId = preparedNotification.notificationId;
    assert.equal(await notificationsRepository.action(notificationUserId, expiryNotificationId, "complete", { postgres: true }), true);
    assert.equal((await pool.query("SELECT is_available FROM inventory_items WHERE food_name='Postgres 临期苹果'")).rows[0].is_available, false);
    const campaign = await notificationsRepository.beginCampaign(user.id, "Postgres 活动", "Postgres 活动正文");
    assert(campaign.devices.some((device) => device.userId === notificationUserId));
    await notificationsRepository.recordPushTickets([{ message: { to: "ExpoPushToken[postgres-notifications]", title: "Postgres 活动",
      body: "Postgres 活动正文", data: { type: "admin_campaign", campaignId: campaign.campaignId } },
    ticket: { id: "postgres-notification-ticket", status: "ok" } }]);
    const pendingReceipt = (await notificationsRepository.pendingReceipts(new Date(Date.now() + 60_000).toISOString(), 10))
      .find((item) => item.ticketId === "postgres-notification-ticket")!;
    assert.equal(pendingReceipt.userId, notificationUserId);
    await notificationsRepository.applyReceipts([{ ...pendingReceipt,
      receipt: { status: "error", details: { error: "DeviceNotRegistered" }, message: "gone" } }]);
    await notificationsRepository.finishCampaign(campaign.campaignId,
      campaign.devices.map((device) => ({ deviceId: device.id, userId: device.userId, status: "accepted" as const, errorCode: null })), 1, 0);
    assert.equal((await pool.query("SELECT is_active FROM push_devices WHERE expo_push_token='ExpoPushToken[postgres-notifications]'"))
      .rows[0].is_active, false);
    const notificationAdmin = await notificationsService.adminData();
    assert(notificationAdmin.metrics.pushSubmitted >= 1);
    assert(notificationAdmin.metrics.pushFailures >= 1);
  }

  const adminAuditService = new AdminAuditService(new PostgresAdminAuditRepository(pool));
  await adminAuditService.record({ adminUserId: user.id, action: "postgres.audit.verify", resourceType: "integration",
    resourceId: 149, summary: "验证 PostgreSQL 管理员审计", details: { jsonb: true },
    ipAddress: "192.0.2.149", userAgent: "postgres-integration" });
  const postgresAudit = await pool.query(`SELECT resource_id, details_json, ip_address FROM admin_audit_logs
    WHERE admin_user_id = $1 AND action = 'postgres.audit.verify'`, [user.id]);
  assert.equal(postgresAudit.rows[0]?.resource_id, "149");
  assert.deepEqual(postgresAudit.rows[0]?.details_json, { jsonb: true });
  assert.equal(postgresAudit.rows[0]?.ip_address, "192.0.2.149");

  const recipesRepository = new PostgresRecipesRepository(pool);
  const recipesService = new RecipesService(recipesRepository, kitchenwareService);
  const postgresRecipePage = await recipesService.list(user.id, {
    search: "Postgres 厨具替代菜", pageSize: "1",
  }, { protocol: "https", host: "api.integration.test" });
  const postgresRecipeBody = postgresRecipePage.body as { items: Array<Record<string, unknown>>; total: number };
  assert.equal(postgresRecipeBody.items[0]?.title, "Postgres 厨具替代菜");
  assert.equal(Array.isArray(postgresRecipeBody.items[0]?.ingredients), true);
  assert.equal(postgresRecipeBody.total, 1);

  const submissionBody = {
    title: "Postgres 用户投稿事务菜", description: "验证 PostgreSQL 投稿事务", image_url: "", cook_time: 18,
    difficulty: "简单", calories: 180, protein: 9, carbs: 20, fat: 6, category: "晚餐", tags: ["postgres"],
    steps: ["使用空气炸锅制作"], ingredients: [{ name: "番茄", amount: "2个" }],
    required_kitchenware: ["空气炸锅", "Postgres 未知锅"], optional_kitchenware: [], serving_size: 2,
  };
  const createdSubmission = await recipesService.createSubmission(user.id, submissionBody);
  const submissionId = createdSubmission.id;
  assert.equal(await recipesRepository.findPublic(submissionId), null);
  assert.equal((await recipesRepository.listMine(user.id)).some((recipe) => Number(recipe.id) === submissionId), true);
  assert.equal(await recipesRepository.findSubmission(user.id + 1, submissionId), null);
  const storedSubmission = await pool.query(`SELECT tags, ingredients_json, status FROM recipes WHERE id = $1`, [submissionId]);
  assert.deepEqual(storedSubmission.rows[0]?.tags, ["postgres"]);
  assert.equal(storedSubmission.rows[0]?.ingredients_json[0]?.name, "番茄");
  assert.equal(storedSubmission.rows[0]?.status, "pending");
  const storedRequirements = await pool.query(`SELECT c.name, r.role FROM recipe_kitchenware_requirements r
    JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id = $1 ORDER BY c.name`, [submissionId]);
  assert.deepEqual(storedRequirements.rows, [{ name: "空气炸锅", role: "required" }]);
  const storedReview = await pool.query(`SELECT raw_name, status FROM kitchenware_mapping_reviews
    WHERE source_type = 'recipe' AND source_id = $1`, [String(submissionId)]);
  assert.deepEqual(storedReview.rows, [{ raw_name: "Postgres 未知锅", status: "pending" }]);
  await assert.rejects(() => recipesService.updateSubmission(user.id + 1, submissionId, submissionBody), /未找到该投稿/);
  await recipesService.updateSubmission(user.id, submissionId, {
    ...submissionBody, title: "Postgres 用户投稿已更新", required_kitchenware: ["烤箱"],
  });
  const updatedRequirements = await pool.query(`SELECT c.name FROM recipe_kitchenware_requirements r
    JOIN kitchenware_catalog c ON c.id = r.catalog_id WHERE r.recipe_id = $1`, [submissionId]);
  assert.deepEqual(updatedRequirements.rows, [{ name: "烤箱" }]);

  await pool.query("DELETE FROM recipe_favorites WHERE user_id = $1 AND recipe_id = $2", [user.id, kitchenwareRecipeId]);
  const favoriteWrites = await Promise.all([
    recipesRepository.addFavorite(user.id, kitchenwareRecipeId), recipesRepository.addFavorite(user.id, kitchenwareRecipeId),
  ]);
  assert.deepEqual(favoriteWrites, [true, true]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM recipe_favorites
    WHERE user_id = $1 AND recipe_id = $2`, [user.id, kitchenwareRecipeId])).rows[0]?.count), 1);
  assert.equal(await recipesRepository.withdrawSubmission(user.id + 1, submissionId), false);
  assert.equal(await recipesRepository.withdrawSubmission(user.id, submissionId), true);

  const failedSubmissionTitle = "Postgres 必须回滚的投稿";
  await assert.rejects(() => recipesRepository.createSubmission({
    authorUserId: user.id, canonicalKey: "postgresrollback", sourceContentHash: "f".repeat(64),
    recipe: {
      title: failedSubmissionTitle, description: "", imageUrl: "", cookTime: 10, difficulty: "简单", calories: 100,
      protein: 5, carbs: 10, fat: 3, nutrition: [], category: "其他", tags: [], steps: ["烹饪"],
      ingredients: [{ name: "番茄", amount: "1个", group: "主料" }], servingSize: 1, prepTime: 0,
      cuisine: null, mealTypes: [], requiredKitchenware: ["无效厨具"], optionalKitchenware: [],
    },
    requirements: [{ rawName: "无效厨具", normalizedName: "无效厨具", role: "required",
      catalogId: 2_147_483_647, confidence: 1 }],
  }));
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM recipes WHERE title = $1", [failedSubmissionTitle])).rows[0]?.count), 0);

  const adminRecipesRepository = new PostgresAdminRecipesRepository(pool);
  const adminRecipesService = new AdminRecipesService(adminRecipesRepository, kitchenwareService);
  const adminRecipeBody = {
    title: "Postgres 管理员事务菜", description: "验证管理员菜谱 PostgreSQL 事务", image_url: "", cook_time: 22,
    difficulty: "简单", calories: 220, protein: 10, carbs: 24, fat: 7, category: "晚餐", tags: ["postgres-admin"],
    steps: ["番茄切块", "放入空气炸锅烤熟"], ingredients: [{ name: "番茄", amount: "2个" }],
    required_kitchenware: ["空气炸锅", "Postgres 管理员未知锅"], optional_kitchenware: [], serving_size: 2,
  };
  const adminContext = { adminUserId: user.id, ipAddress: "127.0.0.1", userAgent: "postgres-integration" };
  const firstAdminRecipe = await adminRecipesService.create(user.id, adminRecipeBody, adminContext);
  const secondAdminRecipe = await adminRecipesService.create(user.id, { ...adminRecipeBody, description: "重复检测样本" }, adminContext);
  const adminList = await adminRecipesService.list({ search: "Postgres 管理员事务菜", pageSize: 10 });
  assert.equal((adminList as { total: number }).total, 2);
  const adminStored = await pool.query(`SELECT tags, steps_json, status, quality_status FROM recipes WHERE id=$1`, [firstAdminRecipe.id]);
  assert.deepEqual(adminStored.rows[0]?.tags, ["postgres-admin"]);
  assert.equal(adminStored.rows[0]?.steps_json.length, 2);
  assert.equal(adminStored.rows[0]?.status, "approved");
  assert.equal(adminStored.rows[0]?.quality_status, "trusted");
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM recipe_duplicate_candidates
    WHERE recipe_id=$1 AND candidate_recipe_id=$2`, [Math.min(firstAdminRecipe.id, secondAdminRecipe.id), Math.max(firstAdminRecipe.id, secondAdminRecipe.id)])).rows[0]?.count), 1);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM kitchenware_mapping_reviews
    WHERE source_type='recipe' AND source_id=$1 AND raw_name='Postgres 管理员未知锅'`, [String(firstAdminRecipe.id)])).rows[0]?.count), 1);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE action='recipe.create' AND resource_id=$1`, [String(firstAdminRecipe.id)])).rows[0]?.count), 1);

  const beforeFailedMapping = (await pool.query("SELECT required_kitchenware_json FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0]?.required_kitchenware_json;
  await assert.rejects(() => adminRecipesRepository.replaceKitchenware(firstAdminRecipe.id, ["无效 FK 锅"], [], [{
    rawName: "无效 FK 锅", normalizedName: "无效fk锅", catalogId: 2_147_483_647, capabilityCode: null,
    role: "required", confidence: 1,
  }], { ...adminContext, action: "recipe.kitchenware_update", resourceId: firstAdminRecipe.id, summary: "必须回滚" }));
  assert.deepEqual((await pool.query("SELECT required_kitchenware_json FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0]?.required_kitchenware_json, beforeFailedMapping);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs
    WHERE action='recipe.kitchenware_update' AND resource_id=$1 AND summary='必须回滚'`, [String(firstAdminRecipe.id)])).rows[0]?.count), 0);
  const adminCoverage = await adminRecipesService.coverage();
  assert(adminCoverage.byCategory.some((row) => row.value === "晚餐"));
  await adminRecipesService.reviewQuality(user.id, firstAdminRecipe.id, "needs_review", "PostgreSQL 集成复核", adminContext);
  assert.equal((await pool.query("SELECT quality_status FROM recipes WHERE id=$1", [firstAdminRecipe.id])).rows[0]?.quality_status, "needs_review");
  await adminRecipesService.remove(user.id, secondAdminRecipe.id, adminContext);
  assert((await pool.query("SELECT deleted_at FROM recipes WHERE id=$1", [secondAdminRecipe.id])).rows[0]?.deleted_at);

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

  const authAccountRepository = new PostgresAuthAccountRepository(pool);
  const authAccountService = new AuthAccountService(authAccountRepository);
  const registeredAuth = await authAccountService.register("postgres-auth@example.com", "PostgresAuth", "initialPass1");
  const authUserId = Number(registeredAuth.user.id);
  assert.equal((await authAccountService.me(authUserId)).must_change_password, 0);
  const loggedInAuth = await authAccountService.login("POSTGRES-AUTH@EXAMPLE.COM", "initialPass1", "127.0.0.7");
  assert.equal(loggedInAuth.rawIdentifier, "postgres-auth@example.com");
  assert.equal(loggedInAuth.user.last_login_ip, "127.0.0.7");
  await authAccountService.changePassword(authUserId, "initialPass1", "changedPass2");
  await assert.rejects(() => authAccountService.login("postgres-auth@example.com", "initialPass1", "127.0.0.7"), /密码错误/);
  assert.equal((await authAccountService.login("postgres-auth@example.com", "changedPass2", "127.0.0.7")).user.id, authUserId);
  await assert.rejects(() => authAccountService.updateProfile(authUserId, { username: "ADMIN" }), /用户名/);
  const profile = await authAccountService.updateProfile(authUserId, { username: "PostgresAuthUpdated", bio: "PostgreSQL 认证资料" });
  assert.equal(profile.bio, "PostgreSQL 认证资料");

  const usernameRace = await Promise.allSettled([
    authAccountService.register("postgres-auth-race-a@example.com", "PostgresRace", "racePass1"),
    authAccountService.register("postgres-auth-race-b@example.com", "postgresrace", "racePass1"),
  ]);
  assert.deepEqual(usernameRace.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(Number((await pool.query("SELECT COUNT(*)::integer AS count FROM users WHERE LOWER(username)='postgresrace'")).rows[0]?.count), 1);

  await pool.query(`INSERT INTO ai_chat_messages (user_id,session_id,role,content,source,status,payload_json)
    VALUES ($1,'postgres-auth-export','user','导出测试','assistant','completed','{"kind":"auth"}'::jsonb)`, [authUserId]);
  await pool.query(`INSERT INTO inventory_scan_jobs (id,user_id,image_hash,status,result_json)
    VALUES ('postgres-auth-scan',$1,'postgres-auth-image','completed','[{"foodName":"番茄"}]'::jsonb)`, [authUserId]);
  await pool.query(`INSERT INTO agent_runs (id,user_id,session_id,modality,source,status,input_json,checkpoint_thread_id)
    VALUES ('postgres-auth-run',$1,'postgres-auth-export','text','assistant','completed','{"message":"测试"}'::jsonb,'postgres-auth-thread')`, [authUserId]);
  await pool.query(`INSERT INTO agent_actions (id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key)
    VALUES ('postgres-auth-action','postgres-auth-run',$1,'add_shopping_items','low','executed','{"items":[]}'::jsonb,'postgres-auth-action-key')`, [authUserId]);
  const authCheckpointConfig = await postgresCheckpointer.put(
    { configurable: { thread_id: "postgres-auth-thread", checkpoint_ns: "" } },
    {
      v: 1, id: "00000000-0000-6000-8000-000000000003", ts: new Date().toISOString(),
      channel_values: { message: "导出 checkpoint" }, channel_versions: { message: "1" }, versions_seen: {},
    },
    { source: "input", step: 0, parents: {} }, { message: "1" },
  );
  await postgresCheckpointer.putWrites(authCheckpointConfig, [["export_test", { exported: true }]], "auth-export-task");
  const exportedAuthData = await authAccountService.exportAiData(authUserId);
  assert.equal(typeof exportedAuthData.messages[0]?.payload_json, "string");
  assert.equal(typeof exportedAuthData.scan_jobs[0]?.result_json, "string");
  assert.equal(typeof exportedAuthData.agent_runs[0]?.input_json, "string");
  assert.equal(typeof exportedAuthData.agent_actions[0]?.payload_json, "string");
  assert.equal(exportedAuthData.agent_checkpoints.length, 1);
  assert.equal(typeof exportedAuthData.agent_checkpoints[0]?.checkpoint_json, "string");
  assert.equal(exportedAuthData.agent_checkpoint_blobs.length, 1);
  assert.equal(typeof exportedAuthData.agent_checkpoint_blobs[0]?.blob_base64, "string");
  assert.equal(exportedAuthData.agent_checkpoint_writes.length, 1);
  assert.equal(typeof exportedAuthData.agent_checkpoint_writes[0]?.value_base64, "string");
  const deletedAuthData = await authAccountService.deleteAiData(authUserId);
  assert.deepEqual({ messages: deletedAuthData.deleted.messages, scanJobs: deletedAuthData.deleted.scan_jobs,
    runs: deletedAuthData.deleted.agent_runs }, { messages: 1, scanJobs: 1, runs: 1 });
  assert.deepEqual((await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM checkpoints WHERE thread_id='postgres-auth-thread') AS checkpoints,
    (SELECT COUNT(*)::integer FROM checkpoint_blobs WHERE thread_id='postgres-auth-thread') AS blobs,
    (SELECT COUNT(*)::integer FROM checkpoint_writes WHERE thread_id='postgres-auth-thread') AS writes`)).rows[0],
  { checkpoints: 0, blobs: 0, writes: 0 });

  const deletingAccount = await authAccountService.register("postgres-delete@example.com", "PostgresDelete", "deletePass1");
  const deletingUserId = Number(deletingAccount.user.id);
  const successorAccount = await authAccountService.register("postgres-successor@example.com", "PostgresSuccessor", "successPass1");
  const successorUserId = Number(successorAccount.user.id);
  const deletionHouseholdId = Number((await pool.query(`INSERT INTO households (name,invite_code,owner_id)
    VALUES ('Postgres 删号家庭','PGDELETE',$1) RETURNING id`, [deletingUserId])).rows[0]?.id);
  await pool.query(`INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')`,
    [deletionHouseholdId,deletingUserId,successorUserId]);
  const deletionMediaUrl = `/media/uploads/community/${deletingUserId}/2026-09-01/photo.png`;
  await pool.query(`INSERT INTO community_posts (user_id,username,content,image_url,image_urls)
    VALUES ($1,'PostgresDelete','媒体清理事务',$2,$3)`, [deletingUserId,deletionMediaUrl,JSON.stringify([deletionMediaUrl])]);
  assert.equal((await authAccountService.deleteAccount(deletingUserId,"deletePass1")).success,true);
  assert.equal((await pool.query("SELECT 1 FROM users WHERE id=$1",[deletingUserId])).rowCount,0);
  assert.equal(Number((await pool.query("SELECT owner_id FROM households WHERE id=$1",[deletionHouseholdId])).rows[0]?.owner_id),successorUserId);
  assert.equal((await pool.query("SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2",[deletionHouseholdId,deletingUserId])).rowCount,0);
  const deletionCleanup = (await pool.query("SELECT urls_json,objects_json FROM media_cleanup_jobs WHERE owner_user_id=$1",[deletingUserId])).rows[0];
  assert.deepEqual(deletionCleanup?.urls_json,[deletionMediaUrl]);
  assert.equal(deletionCleanup?.objects_json[0]?.backend,"local");

  const communityRepository = new PostgresCommunityRepository(pool);
  const communityService = new CommunityService(communityRepository);
  const checkInResults = await Promise.all([
    communityRepository.checkIn(successorUserId, "2026-09-01"),
    communityRepository.checkIn(successorUserId, "2026-09-01"),
  ]);
  assert.deepEqual(checkInResults.sort(), [false, true]);
  const followResults = await Promise.all([
    communityRepository.toggleFollow(successorUserId, user.id),
    communityRepository.toggleFollow(successorUserId, user.id),
  ]);
  assert(followResults.every((result) => result.kind === "updated"));
  assert.deepEqual(followResults.map((result) => result.kind === "updated" && result.active).sort(), [false, true]);
  const followed = await communityRepository.toggleFollow(successorUserId, user.id);
  assert.equal(followed.kind === "updated" && followed.active, true);

  const questionResult = await communityRepository.createPost({
    userId: user.id,
    username: "PostgresAuthor",
    avatarUrl: null,
    category: "问答",
    content: "如何准备一份高蛋白燕麦早餐搭配？",
    imageUrls: [],
    eventStartAt: null,
    eventEndAt: null,
    questionStatus: "open",
    ipLocation: "集成测试",
    linkedRecipeId: null,
  });
  assert.equal(questionResult.kind, "created");
  if (questionResult.kind !== "created") throw new Error("PostgreSQL community question was not created");
  const questionId = Number(questionResult.post.id);
  const eventResult = await communityRepository.createPost({
    userId: user.id,
    username: "PostgresAuthor",
    avatarUrl: null,
    category: "活动",
    content: "一起完成七天健康早餐打卡活动",
    imageUrls: [],
    eventStartAt: "2026-09-01T00:00:00.000Z",
    eventEndAt: "2099-09-30T00:00:00.000Z",
    questionStatus: null,
    ipLocation: null,
    linkedRecipeId: null,
  });
  assert.equal(eventResult.kind, "created");
  if (eventResult.kind !== "created") throw new Error("PostgreSQL community event was not created");
  const eventId = Number(eventResult.post.id);

  const likeResults = await Promise.all([
    communityRepository.togglePostLike(successorUserId, questionId),
    communityRepository.togglePostLike(successorUserId, questionId),
  ]);
  assert.deepEqual(likeResults.map((result) => result.kind === "updated" && result.active).sort(), [false, true]);
  const liked = await communityRepository.togglePostLike(successorUserId, questionId);
  assert.equal(liked.kind === "updated" && liked.active && liked.count === 1, true);
  const joinResults = await Promise.all([
    communityRepository.toggleJoin(successorUserId, eventId, Date.now()),
    communityRepository.toggleJoin(successorUserId, eventId, Date.now()),
  ]);
  assert.deepEqual(joinResults.map((result) => result.kind === "updated" && result.active).sort(), [false, true]);
  const joined = await communityRepository.toggleJoin(successorUserId, eventId, Date.now());
  assert.equal(joined.kind === "updated" && joined.active && joined.count === 1, true);

  const comment = await communityRepository.createComment(successorUserId, questionId, "PostgresSuccessor", null, "可以提前浸泡燕麦并搭配鸡蛋。", null);
  assert(comment);
  const accepted = await communityRepository.acceptComment(user.id, questionId, Number(comment.id));
  assert.deepEqual(accepted, { kind: "updated", acceptedCommentId: Number(comment.id) });
  const commentLike = await communityRepository.toggleCommentLike(user.id, Number(comment.id));
  assert.equal(commentLike.kind === "updated" && commentLike.active && commentLike.count === 1, true);
  const comments = await communityService.comments(user.id, questionId);
  assert.equal(comments[0]?.is_accepted, true);
  assert.equal(comments[0]?.is_liked, true);

  const shareResults = await Promise.all([
    communityRepository.share(questionId, successorUserId, ["PGSHARE001"], "2099-10-01T00:00:00.000Z"),
    communityRepository.share(questionId, successorUserId, ["PGSHARE002"], "2099-10-01T00:00:00.000Z"),
  ]);
  assert(shareResults.every((result) => result && result !== "not_found"));
  assert.equal(shareResults[0] && shareResults[0] !== "not_found" ? shareResults[0].code : null,
    shareResults[1] && shareResults[1] !== "not_found" ? shareResults[1].code : null);
  const resolvedShare = await communityRepository.resolveShare(String(shareResults[0] && shareResults[0] !== "not_found" ? shareResults[0].code : ""));
  assert.equal(Number(resolvedShare?.post_id), questionId);
  assert.equal(resolvedShare?.content,"如何准备一份高蛋白燕麦早餐搭配？");

  await pool.query(`UPDATE user_health_profiles SET health_goal='lose_weight',allergies_json=$1::jsonb,
    dietary_restrictions_json=$2::jsonb WHERE user_id=$3`, [JSON.stringify([{ name: "花生" }]), JSON.stringify(["高盐"]), successorUserId]);
  const recommendationSource = await communityRepository.recommendationSource(successorUserId);
  assert.deepEqual(recommendationSource.health?.allergies_json, [{ name: "花生" }]);
  const feed = await communityService.posts(successorUserId, { sort: "recommended", pageSize: 1 });
  if (Array.isArray(feed.body)) throw new Error("PostgreSQL community cursor response was not returned");
  assert.equal(feed.body.items.length, 1);
  assert.equal(typeof feed.body.items[0]?.is_liked, "boolean");
  const viewed = await communityService.post(successorUserId, questionId);
  assert(Number(viewed.views_count) >= 1);
  const communityProfile = await communityService.profile(successorUserId, user.id);
  assert.equal(communityProfile.is_following, true);

  const adminCommunityRepository = new PostgresAdminCommunityRepository(pool);
  const moderationContext = { adminUserId:user.id,ipAddress:"127.0.0.1",userAgent:"postgres-integration" };
  const activeCommunityPosts = await adminCommunityRepository.listPosts({status:"active",cursorId:null,limit:2});
  assert.equal(activeCommunityPosts.length,2);
  const eventUpdated = await adminCommunityRepository.updateEvent(eventId,{startAt:"2026-09-02T00:00:00.000Z",endAt:"2099-10-01T00:00:00.000Z"},moderationContext);
  assert.equal(eventUpdated.kind,"updated");
  const reopened = await adminCommunityRepository.updateQuestion(questionId,{status:"open",acceptedCommentId:null},moderationContext);
  assert.equal(reopened.kind,"updated");
  const resolved = await adminCommunityRepository.updateQuestion(questionId,{status:"resolved",acceptedCommentId:Number(comment.id)},moderationContext);
  assert.equal(resolved.kind,"updated");
  assert.equal(await adminCommunityRepository.deleteComment(Number(comment.id),moderationContext),true);
  const moderatedQuestion=(await pool.query("SELECT question_status,accepted_comment_id,comment_count FROM community_posts WHERE id=$1",[questionId])).rows[0];
  assert.equal(moderatedQuestion?.question_status,"open");
  assert.equal(moderatedQuestion?.accepted_comment_id,null);
  assert.equal(Number(moderatedQuestion?.comment_count),0);
  assert.equal(await adminCommunityRepository.softDeletePost(eventId,moderationContext),true);
  const deletedCommunityPosts=await adminCommunityRepository.listPosts({status:"deleted",cursorId:null,limit:null});
  assert(deletedCommunityPosts.some((post)=>Number(post.id)===eventId));
  const moderationAudits=await pool.query(`SELECT action,details_json FROM admin_audit_logs WHERE admin_user_id=$1
    AND action LIKE 'community.%' ORDER BY id`,[user.id]);
  assert(moderationAudits.rows.some((audit)=>audit.action==="community.comment.delete"&&typeof audit.details_json?.contentPreview==="string"));

  const adminUsersRepository=new PostgresAdminUsersRepository(pool);
  const adminUsersService=new AdminUsersService(adminUsersRepository);
  const accessControlService=new AccessControlService(new PostgresAccessControlRepository(pool));
  const migratedAccessUser=await accessControlService.user(user.id);
  assert.equal(migratedAccessUser?.role,"admin");
  assert.equal(migratedAccessUser?.isDisabled,false);
  const migratedToken=await accessControlService.signUserToken(user.id);
  const migratedClaims=JSON.parse(Buffer.from(migratedToken.split(".")[1]!,"base64url").toString()) as Record<string,unknown>;
  assert.equal(migratedClaims.sessionVersion,migratedAccessUser?.sessionVersion);
  const bootstrapUserId=Number((await pool.query(`INSERT INTO users(username,email,password_hash)
    VALUES('Postgres Bootstrap','postgres-bootstrap@example.com','not-used') RETURNING id`)).rows[0].id);
  await accessControlService.ensureUserInitialState(bootstrapUserId);
  await accessControlService.ensureUserInitialState(bootstrapUserId);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM user_health_profiles WHERE user_id=$1",[bootstrapUserId])).rows[0].count),1);
  const postgresLevelRule=await adminUsersService.levelRule();
  postgresLevelRule.xp.dailyCheckIn=9;
  assert.equal((await adminUsersService.saveLevelRule(postgresLevelRule,moderationContext)).rule.xp.dailyCheckIn,9);
  assert.equal((await adminUsersService.levelRule()).xp.dailyCheckIn,9);
  const adminUsersPage=await adminUsersService.users({pageSize:2});
  assert(!Array.isArray(adminUsersPage)&&adminUsersPage.items.length===2);
  assert.equal(typeof (!Array.isArray(adminUsersPage)&&adminUsersPage.items[0]?.level.xp),"number");
  const adminHealth=await adminUsersService.healthProfile(successorUserId,moderationContext);
  assert(Array.isArray(adminHealth.profile?.allergies));
  const adjustedLevel=await adminUsersService.adjustLevel(successorUserId,25,"PostgreSQL 集成调整",moderationContext);
  assert(Number(adjustedLevel.level.adjustmentXp)>=25);
  const credentialUpdate=await adminUsersService.credentials(successorUserId,{identifier:"postgres-admin-updated@example.com",newPassword:"updatedPass1"},moderationContext);
  assert.equal(credentialUpdate.user.email,"postgres-admin-updated@example.com");
  const existingAdminEmail=String((await pool.query("SELECT email FROM users WHERE id<>$1 AND email IS NOT NULL LIMIT 1",[successorUserId])).rows[0]?.email);
  await assert.rejects(()=>adminUsersService.credentials(successorUserId,{identifier:existingAdminEmail},moderationContext),/已被其他账号/);
  assert.equal((await adminUsersService.expert(successorUserId,true,moderationContext)).is_verified_expert,true);
  assert.equal((await adminUsersService.status(user.id,successorUserId,true,moderationContext)).is_disabled,1);
  assert.equal((await adminUsersService.status(user.id,successorUserId,false,moderationContext)).is_disabled,0);
  assert.equal((await adminUsersService.role(user.id,successorUserId,"admin",moderationContext)).success,true);
  assert.equal((await adminUsersService.role(user.id,successorUserId,"user",moderationContext)).success,true);
  const adminUserAudits=await pool.query("SELECT details_json FROM admin_audit_logs WHERE admin_user_id=$1 AND action='user.credentials.update'",[user.id]);
  assert.equal(adminUserAudits.rows.at(-1)?.details_json?.passwordReset,true);

  const rateLimitsService = new RateLimitsService(new PostgresRateLimitsRepository(pool));
  const sharedStatuses = await Promise.all(Array.from({ length: 5 }, () =>
    rateLimitsService.consume("postgres-concurrent", "shared-client", 3, 60_000, 1_000_000)));
  assert.equal(sharedStatuses.filter((status) => !status.blocked).length, 3);
  assert.equal(sharedStatuses.filter((status) => status.blocked).length, 2);
  assert.equal(sharedStatuses.filter((status) => status.blocked).every((status) => status.retryAfterSeconds === 60), true);
  assert.equal((await rateLimitsService.consume("postgres-concurrent", "shared-client", 3, 60_000, 1_060_001)).blocked, false);
  await Promise.all(Array.from({ length: 5 }, (_, attempt) =>
    rateLimitsService.recordLoginFailure("postgres-rate@example.com", `192.0.2.${attempt + 1}`, 2_000_000)));
  assert.equal((await rateLimitsService.loginStatus("POSTGRES-rate@example.com", "198.51.100.1", 2_000_001)).blocked, true);
  await rateLimitsService.clearLoginFailures("postgres-rate@example.com");
  assert.equal((await rateLimitsService.loginStatus("postgres-rate@example.com", "198.51.100.1", 2_000_002)).blocked, false);

  const mediaCleanupRepository = new PostgresMediaCleanupRepository(pool);
  const mediaJobId = await mediaCleanupRepository.enqueue(user.id, ["/media/uploads/postgres-cleanup.png"], [
    { backend: "local", path: "/tmp/postgres-cleanup.png" },
  ]);
  const concurrentClaims = await Promise.all([
    mediaCleanupRepository.claim(mediaJobId, "postgres-claim-a", 30),
    mediaCleanupRepository.claim(mediaJobId, "postgres-claim-b", 30),
  ]);
  assert.equal(concurrentClaims.filter(Boolean).length, 1);
  const winningClaim = concurrentClaims.find(Boolean)!;
  await mediaCleanupRepository.release(mediaJobId, winningClaim.claim_token!, "integration retry");
  const deletedMediaReferences: unknown[] = [];
  const mediaCleanupService = new MediaCleanupService(mediaCleanupRepository, async (references) => {
    deletedMediaReferences.push(...references);
  });
  assert.equal(await mediaCleanupService.process(mediaJobId), true);
  assert.deepEqual(deletedMediaReferences, [{ backend: "local", path: "/tmp/postgres-cleanup.png" }]);
  const mediaCleanupPage = await mediaCleanupService.list({ status: "completed", page: 1, pageSize: 10 });
  assert(mediaCleanupPage.items.some((job) => job.id === mediaJobId && job.urlCount === 1));

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

  process.env.DATABASE_DRIVER = "postgresql";
  process.env.DATABASE_URL = connectionString;
  process.env.REQUIRE_HTTPS = "0";
  const { createApp } = await import("../src/app.js");
  const app = await createApp();
  const runtimeServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
  const address = runtimeServer.address();
  assert(address && typeof address === "object");
  const health = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { databaseDriver: string }).databaseDriver, "postgresql");
  await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
  await app.locals.closeRuntime();

  console.log(JSON.stringify({
    ok: true,
    tables: report.tableCount,
    rows: report.rowCount,
    schema: archive.baselineSchemaSha256,
    repeatedAndConcurrentImportVerified: true,
    postgresInventoryRepositoryVerified: true,
    postgresAiContextRepositoryVerified: true,
    postgresAIConversationsRepositoryVerified: true,
    postgresAdminAgentRunsRepositoryVerified: true,
    postgresAgentOperationsRepositoryVerified: true,
    postgresAgentCheckpointerVerified: true,
    postgresAgentRunsRepositoryVerified: true,
    postgresAgentSchedulingRepositoryVerified: true,
    postgresAIRuntimeRepositoryVerified: true,
    postgresAiToolDataRepositoryVerified: true,
    postgresAIWriteConfirmationsRepositoryVerified: true,
    postgresAdminAuditRepositoryVerified: true,
    postgresDietRecordsRepositoryVerified: true,
    postgresInsightsRepositoryVerified: true,
    postgresCookingQueueRepositoryVerified: true,
    postgresMealPlansRepositoryVerified: true,
    postgresVoicePacksRepositoryVerified: true,
    postgresKitchenwareRepositoryVerified: true,
    postgresRecommendationsRepositoryVerified: true,
    postgresRealtimeVoiceRepositoryVerified: true,
    postgresRecipesRepositoryVerified: true,
    postgresFeedbackRepositoryVerified: true,
    postgresFoodRepositoryVerified: true,
    postgresAdminConsoleRepositoryVerified: true,
    postgresHouseholdsRepositoryVerified: true,
    postgresHealthRepositoryVerified: true,
    postgresShoppingRepositoryVerified: true,
    postgresAuthAccountRepositoryVerified: true,
    postgresCommunityRepositoryVerified: true,
    postgresAdminCommunityRepositoryVerified: true,
    postgresAdminUsersRepositoryVerified: true,
    postgresRateLimitsRepositoryVerified: true,
    postgresMediaCleanupRepositoryVerified: true,
    postgresWorkerRepositoryVerified: true,
    postgresNotificationsRepositoryVerified: true,
    leastPrivilegeGrantVerified: true,
    rollbackVerified: true,
    postgresApplicationRuntimeVerified: true,
  }, null, 2));
} finally {
  await pool.end();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
