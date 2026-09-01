import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PostgresAdminConsoleRepository } from "../src/modules/adminConsole/postgresRepository.js";
import { AdminConsoleService } from "../src/modules/adminConsole/service.js";
import { PostgresAdminFoodAssetsRepository } from "../src/modules/adminFoodAssets/postgresRepository.js";
import { AdminFoodAssetsService } from "../src/modules/adminFoodAssets/service.js";
import { PostgresAdminKitchenwareRepository } from "../src/modules/adminKitchenware/postgresRepository.js";
import { AdminKitchenwareService } from "../src/modules/adminKitchenware/service.js";
import { PostgresAdminRecipesRepository } from "../src/modules/adminRecipes/postgresRepository.js";
import { AdminRecipesService } from "../src/modules/adminRecipes/service.js";
import { PostgresCookingQueueRepository } from "../src/modules/cookingQueue/postgresRepository.js";
import { PostgresDietRecordsRepository } from "../src/modules/dietRecords/postgresRepository.js";
import { PostgresFeedbackRepository } from "../src/modules/feedback/postgresRepository.js";
import { PostgresFoodRepository } from "../src/modules/foods/postgresRepository.js";
import { PostgresHealthRepository } from "../src/modules/health/postgresRepository.js";
import { PostgresHouseholdsRepository } from "../src/modules/households/postgresRepository.js";
import { HouseholdsService } from "../src/modules/households/service.js";
import { PostgresInsightsRepository } from "../src/modules/insights/postgresRepository.js";
import { InsightsService } from "../src/modules/insights/service.js";
import { consumeInventoryWithPostgresClient, PostgresInventoryRepository } from "../src/modules/inventory/postgresRepository.js";
import { PostgresKitchenwareRepository } from "../src/modules/kitchenware/postgresRepository.js";
import { KitchenwareService } from "../src/modules/kitchenware/service.js";
import { PostgresMealPlansRepository } from "../src/modules/mealPlans/postgresRepository.js";
import { PostgresRecommendationsRepository } from "../src/modules/recommendations/postgresRepository.js";
import { RecommendationsService } from "../src/modules/recommendations/service.js";
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
    dietRepository.completeCooking(user.id, completionInput),
    dietRepository.completeCooking(user.id, completionInput),
  ]);
  assert.deepEqual(cookingCompletions.map((result) => result.repeated).sort(), [false, true]);
  const completionRecordIds = cookingCompletions.map((result) => Number((result.diet_record as { id: number }).id));
  assert.equal(completionRecordIds[0], completionRecordIds[1]);
  const storedDietInventory = await inventoryRepository.findOwned(user.id, dietInventory.id);
  assert.equal(storedDietInventory?.quantity_value, 275);
  const completedMeals = await dietRepository.list(user.id, "2026-09-03");
  assert.equal(completedMeals.filter((record) => record.food_name === "Postgres 土豆料理").length, 1);
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
    postgresDietRecordsRepositoryVerified: true,
    postgresInsightsRepositoryVerified: true,
    postgresCookingQueueRepositoryVerified: true,
    postgresMealPlansRepositoryVerified: true,
    postgresVoicePacksRepositoryVerified: true,
    postgresKitchenwareRepositoryVerified: true,
    postgresRecommendationsRepositoryVerified: true,
    postgresRecipesRepositoryVerified: true,
    postgresFeedbackRepositoryVerified: true,
    postgresFoodRepositoryVerified: true,
    postgresAdminConsoleRepositoryVerified: true,
    postgresHouseholdsRepositoryVerified: true,
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
