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
