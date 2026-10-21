import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MealPlansError } from "../src/modules/mealPlans/errors.js";
import { formatMealPlan, formatMealPlanItem } from "../src/modules/mealPlans/formatters.js";
import type { MealPlansRepository } from "../src/modules/mealPlans/repository.js";
import { MealPlansService } from "../src/modules/mealPlans/service.js";

const item = {
  id: "22222222-2222-4222-8222-222222222222", plan_id: "11111111-1111-4111-8111-111111111111",
  planned_date: "2026-09-02", meal_type: "晚餐", title: "番茄炒蛋", recipe_title: "番茄炒蛋",
  recipe_id: 1, recipe_status: "approved", recipe_deleted_at: null, recipe_image_url: null,
  recipe_cook_time: 10, recipe_difficulty: "简单", ingredients_json: [{ name: "番茄", amount: "2个" }],
  steps_json: ["切番茄"], calories: 200, protein: 12, carbs: 8, fat: 10, status: "planned",
  version: 1, diet_record_id: null, queue_item_id: null, completed_at: null, updated_at: "2026-09-01T00:00:00.000Z",
};
const view = formatMealPlan({
  id: item.plan_id, title: "本周餐单", start_date: "2026-09-01", end_date: "2026-09-07", status: "active",
  source: "manual", constraints_json: { servings: 2 }, version: 1, created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z", deleted_at: null,
}, [formatMealPlanItem(item)]);

function fakeRepository(overrides: Partial<MealPlansRepository> = {}): MealPlansRepository {
  return {
    listChanges: async () => [],
    reviewChange: async () => ({ kind: "updated", value: formatMealPlanItem(item) }),
    confirmItem: async () => ({ kind: "updated", value: formatMealPlanItem(item) }),
    activateDraft: async () => ({ kind: "updated", value: { plan: view, repeated: false } }),
    updateDraft: async () => ({ kind: "updated", value: { plan: view, repeated: false } }),
    saveDraft: async () => ({ plan: view, repeated: false }),
    list: async () => [view], find: async () => view,
    updatePlan: async () => ({ kind: "updated", value: { ...view, version: 2 } }),
    removePlan: async () => "removed", updateItem: async () => ({ kind: "updated", value: formatMealPlanItem(item) }),
    addShopping: async () => ({ kind: "completed", value: { added: 1, repeated: false } }),
    enqueue: async () => ({ kind: "completed", value: { queueItemId: "queue-1", repeated: false } }),
    complete: async () => ({ kind: "completed", value: { dietRecordId: 1, repeated: false } }),
    ...overrides,
  };
}

describe("meal plans module", () => {
  test("formats SQLite text JSON and PostgreSQL JSONB identically", () => {
    const postgres = formatMealPlanItem(item);
    const sqlite = formatMealPlanItem({
      ...item, ingredients_json: JSON.stringify(item.ingredients_json), steps_json: JSON.stringify(item.steps_json),
    });
    assert.deepEqual(sqlite, postgres);
    assert.deepEqual(postgres.ingredients, [{ name: "番茄", amount: "2个" }]);
    assert.deepEqual(view.constraints, { servings: 2 });
  });

  test("maps optimistic plan conflicts to a stable domain error", async () => {
    const service = new MealPlansService(fakeRepository({ updatePlan: async () => ({ kind: "version_conflict" }) }));
    await assert.rejects(
      () => service.updatePlan(7, String(view.id), { version: 1, title: "新标题" }),
      (error: unknown) => error instanceof MealPlansError && error.code === "MEAL_PLAN_VERSION_CONFLICT",
    );
  });

  test("maps execution capacity and ownership outcomes without driver-specific errors", async () => {
    const full = new MealPlansService(fakeRepository({ enqueue: async () => ({ kind: "queue_full" }) }));
    await assert.rejects(
      () => full.queue(7, String(view.id), String(item.id), { version: 1, idempotencyKey: "meal-plan-unit-queue-0001" }),
      (error: unknown) => error instanceof MealPlansError && error.code === "COOKING_QUEUE_FULL",
    );
    const missing = new MealPlansService(fakeRepository({ complete: async () => ({ kind: "diet_record_not_found" }) }));
    await assert.rejects(
      () => missing.complete(7, String(view.id), String(item.id), {
        version: 1, idempotencyKey: "meal-plan-unit-complete-0001", dietRecordId: 99,
      }),
      (error: unknown) => error instanceof MealPlansError && error.code === "DIET_RECORD_NOT_FOUND",
    );
  });
});

test("automatic meal changes distinguish shopping-list intent, actual purchases, confirmation and cooking", async () => {
  const { mealChangeDecision } = await import("../src/modules/mealPlans/changePolicy.js");
  assert.equal(mealChangeDecision({ status: "planned" }, undefined, [{ checked: false }]), "apply");
  assert.equal(mealChangeDecision({ status: "planned", confirmed_at: "2026-09-12" }, undefined, []), "suggest");
  assert.equal(mealChangeDecision({ status: "planned" }, undefined, [{ checked: true }]), "suggest");
  for (const status of ["preparing", "ready", "cooking", "completed"]) assert.equal(mealChangeDecision({ status: "planned" }, { status }, []), "keep");
});

import { commonProduction, productionReservations } from "../src/modules/mealPlans/commonProduction.js";
import { mealPlanQueueSchema } from "../src/validation/schemas.js";

test("common production combines compatible session demands and leaves replaced, queued and shared meals alone", () => {
  const execution = { targetMealId: "first", recipeId: 1, title: "番茄炒蛋", servings: 1.5, recipeYield: 2,
    demands: [{ food_name: "番茄", amount_value: 150, unit: "g" }, { food_name: "鸡蛋", amount_value: 1.5, unit: "piece" }] };
  const first = { ...item, plan_constraints_json: { savedCookingDraft: { draft: { planningMode: "single_session" } }, executionItems: {
    [item.id]: execution, second: { ...execution, targetMealId: "next", servings: 0.5, demands: [{ food_name: "番茄", amount_value: 50, unit: "g" }, { food_name: "鸡蛋", amount_value: 0.5, unit: "piece" }] },
    replaced: execution, queued: execution, dining: execution,
  } } };
  const second = { ...item, id: "second", planned_date: "2026-09-03", version: 4 };
  const group = commonProduction(first, [first, second, { ...item, id: "replaced", recipe_id: 2 }, { ...item, id: "queued", queue_item_id: "existing" }, { ...item, id: "dining", dining_json: {} }])!;
  assert.equal(group.servings, 2);
  assert.deepEqual(group.ingredients, [{ name: "番茄", amount: "200g" }, { name: "鸡蛋", amount: "2个" }]);
  assert.equal(group.targets.find(target => target.id === "second")!.version, 5);
  assert.equal(group.targets.find(target => target.id === "second")!.date, "2026-09-03");
  assert.equal(commonProduction({ ...first, plan_constraints_json: { ...first.plan_constraints_json, currentCookingDraft: { planningMode: "weekly" } } }, [first, second]), null);
  assert.equal(commonProduction({ ...first, plan_constraints_json: {} }, [first, second]), null);
  const reservations = productionReservations(group.targets, { food_name: "番茄炒蛋", produced_servings: 3, eaten_servings: 0.5,
    plan_item_id: "second", meal_type: "晚餐", nutrition_per_serving: {} }, "made-batch");
  assert.deepEqual(reservations.map(meal => [meal.id, meal.preparedServings]), [["first", 1.5]], "selected next meal is eaten first; excess portions remain unallocated");
});

test("common production requires an explicit boolean and old queue requests stay valid", () => {
  const input = { version: 1, idempotencyKey: "queue-compatibility-0001" };
  assert.equal(mealPlanQueueSchema.parse(input).combineSameRecipe, undefined);
  assert.equal(mealPlanQueueSchema.parse({ ...input, combineSameRecipe: true }).combineSameRecipe, true);
  assert.equal(mealPlanQueueSchema.safeParse({ ...input, combineSameRecipe: "true" }).success, false);
});

import Database from "better-sqlite3";
import type { Pool } from "pg";
import { SqliteMealPlansRepository } from "../src/modules/mealPlans/sqliteRepository.js";
import { PostgresMealPlansRepository } from "../src/modules/mealPlans/postgresRepository.js";

for (const driver of ["sqlite", "postgres"] as const) {
  test(`${driver} meal-plan replay binds keys to the action and item before returning a result`, async () => {
    const rows = [
      { action: "shopping", meal_plan_item_id: "meal-a", result_json: { added: 1, itemIds: ["shopping-a"], repeated: false } },
      { action: "queue", meal_plan_item_id: "meal-a", result_json: { queueItemId: "queue-a", combineSameRecipe: false, repeated: false } },
      { action: "complete", meal_plan_item_id: "meal-a", result_json: { dietRecordId: 42, repeated: false } },
    ];
    const database = new Database(":memory:");
    database.exec("CREATE TABLE meal_plan_execution_requests (user_id INTEGER, idempotency_key TEXT, action TEXT, meal_plan_item_id TEXT, result_json TEXT)");
    for (const row of rows) database.prepare("INSERT INTO meal_plan_execution_requests VALUES (?, ?, ?, ?, ?)")
      .run(7, `original-${row.action}`, row.action, row.meal_plan_item_id, JSON.stringify(row.result_json));
    const statements: string[] = [];
    // PostgreSQL protocol fixture only; this is not a live database integration test.
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        statements.push(sql);
        if (sql.includes("FROM meal_plan_execution_requests")) {
          assert.match(sql, /SELECT action, meal_plan_item_id, result_json/);
          assert.equal(values?.[0], 7);
          return { rows: rows.filter(row => `original-${row.action}` === values?.[1]) };
        }
        assert(/^(BEGIN|COMMIT|ROLLBACK)|pg_advisory_xact_lock/.test(sql), `Unexpected state access: ${sql}`);
        return { rows: [] };
      },
      release: () => {},
    };
    const repository = driver === "sqlite" ? new SqliteMealPlansRepository(database)
      : new PostgresMealPlansRepository({ connect: async () => client } as unknown as Pool);
    const methods = { shopping: repository.addShopping.bind(repository), queue: repository.enqueue.bind(repository), complete: repository.complete.bind(repository) };
    try {
      for (const row of rows) {
        const action = row.action as keyof typeof methods;
        // No meal row is present: committed retries must not consult today's item/version.
        for (const version of [1, 999]) {
          const result = await methods[action](7, "plan-a", "meal-a", { version, idempotencyKey: `original-${action}` });
          assert.equal(result.kind, "completed");
          if (result.kind === "completed") assert.deepEqual(result.value, { ...row.result_json, repeated: true });
        }
        await assert.rejects(methods[action](7, "plan-b", "meal-b", { version: 1, idempotencyKey: `original-${action}` }), { code: "MEAL_PLAN_KEY_CONFLICT" });
        for (const other of Object.keys(methods) as Array<keyof typeof methods>) {
          if (other === action) continue;
          await assert.rejects(methods[other](7, "plan-a", "meal-a", { version: 1, idempotencyKey: `original-${action}` }), { code: "MEAL_PLAN_KEY_CONFLICT" });
        }
      }
      await assert.rejects(repository.enqueue(7, "plan-a", "meal-a", { version: 1, idempotencyKey: "original-queue", combineSameRecipe: true }), { code: "MEAL_SOURCE_CONFLICT" });
      await assert.rejects(repository.addShopping(7, "plan-a", "meal-a", { version: 1, idempotencyKey: "original-shopping", householdRecipeFingerprint: "a".repeat(64),
        householdTotalDemand: {} as NonNullable<Parameters<MealPlansRepository["addShopping"]>[3]["householdTotalDemand"]> }), { code: "DINING_PLAN_CHANGED" });
      assert.equal((database.prepare("SELECT COUNT(*) AS n FROM meal_plan_execution_requests").get() as { n: number }).n, 3);
      if (driver === "postgres") assert.equal(statements.filter(sql => sql === "ROLLBACK").length, 11);
    } finally { database.close(); }
  });
}
