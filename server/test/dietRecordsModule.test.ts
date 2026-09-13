import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DietRecordsRepository } from "../src/modules/dietRecords/repository.js";
import { DietRecordsService } from "../src/modules/dietRecords/service.js";

function fakeRepository(overrides: Partial<DietRecordsRepository> = {}): DietRecordsRepository {
  return {
    recordFunnelEvent: async () => undefined,
    list: async () => [],
    listPreparedMeals: async () => [],
    applyMealEvent: async () => ({ repeated: false }),
    create: async (_userId, record) => ({ id: 1, ...record }),
    remove: async () => true,
    completeCooking: async (_userId, input) => ({
      diet_record: { id: 1, ...input.diet_record },
      consumed_inventory_item_ids: input.inventory_item_ids,
      inventory_consumption_changes: [],
      repeated: false,
    }),
    ...overrides,
  };
}

describe("diet records module", () => {
  test("prepares driver-neutral dates and delegates CRUD through the repository", async () => {
    let capturedRecord: Record<string, unknown> = {};
    const service = new DietRecordsService(fakeRepository({
      create: async (_userId, record) => {
        capturedRecord = record;
        return { id: 7, ...record };
      },
    }));

    const created = await service.create(42, {
      meal_type: "午餐",
      food_name: "番茄料理",
      amount: "1份",
      recorded_at: "2026-08-03",
    });
    assert.equal(created.id, 7);
    assert.equal(capturedRecord.recorded_at, "2026-08-03");
    assert.equal(capturedRecord.recorded_time, null);
    assert.deepEqual(await service.list(42, "2026-08-03"), []);
    assert.equal(await service.remove(42, 7), true);
  });

  test("deduplicates legacy inventory ids and records the funnel only for the first completion", async () => {
    const capturedIds: number[][] = [];
    let calls = 0;
    let funnelEvents = 0;
    const service = new DietRecordsService(fakeRepository({
      completeCooking: async (_userId, input) => {
        capturedIds.push(input.inventory_item_ids);
        calls += 1;
        return { repeated: calls > 1 };
      },
      recordFunnelEvent: async () => { funnelEvents += 1; },
    }));
    const input = {
      idempotency_key: "cooking-module-test-0001",
      inventory_item_ids: [3, 3, 5],
      inventory_consumptions: [],
      diet_record: { meal_type: "晚餐", food_name: "番茄料理", amount: "1份", recorded_at: "2026-08-03" },
    };

    assert.equal((await service.completeCooking(42, input)).repeated, false);
    assert.equal((await service.completeCooking(42, input)).repeated, true);
    assert.deepEqual(capturedIds, [[3, 5], [3, 5]]);
    assert.equal(funnelEvents, 1);
  });
});

describe("prepared meal quantity conservation", () => {
  test("repeated decimal consumption and exact small-remainder disposal preserve quantity", async () => {
    const { transitionMeal, prepareMealEvent } = await import("../src/modules/dietRecords/preparedMeals.js");
    const { mealProductionSchema } = await import("@dietdigidose/contracts");
    mealProductionSchema.parse({ food_name: "饭", produced_servings: 1, eaten_servings: 0.9995 });
    let meal: import("@dietdigidose/contracts").PreparedMeal = { id: "meal", food_name: "饭", produced_servings: 1, remaining_servings: 1, version: 1,
      is_reserved: false, recipe_id: null, nutrition_per_serving: {}, planned_date: null, meal_type: "午餐",
      storage_location: null, produced_at: "2026-09-12", queue_item_id: null, plan_item_id: null };
    for (let index = 0; index < 10; index++) {
      meal = transitionMeal(meal, prepareMealEvent({ idempotency_key: `precision-loop-${index}`, version: meal.version, type: "eat", servings: 0.09995 }));
    }
    assert.equal(meal.remaining_servings, 0.0005);
    const staleVersion = meal.version;
    meal = transitionMeal(meal, prepareMealEvent({ idempotency_key: "precision-discard-last", version: meal.version, type: "discard", servings: 0.0005 }));
    assert.equal(meal.remaining_servings, 0);
    assert.throws(() => transitionMeal(meal, { idempotency_key: "precision-stale-event", version: staleVersion, type: "eat", servings: 0.0005 }), /刷新/);
    assert.throws(() => transitionMeal(meal, { idempotency_key: "precision-empty-event", version: meal.version, type: "eat", servings: 0.000001 }), /不足/);
  });
});


test("meal event identity ignores generated retry times but detects explicit request changes", async () => {
  const { prepareMealEvent } = await import("../src/modules/dietRecords/preparedMeals.js");
  const { mealEventIdentity, replayMealEvent } = await import("../src/modules/dietRecords/mealEventIdentity.js");
  const input = { idempotency_key: "meal-event-identity-test", type: "eat" as const, servings: 0.5, version: 1 };
  const first = prepareMealEvent(input);
  const retry = { ...prepareMealEvent(input), recorded_at: "2099-09-10", recorded_time: "23:59" };
  assert.equal(mealEventIdentity(first), mealEventIdentity(retry));
  const result = { prepared_meal: { version: 2 }, request_identity: mealEventIdentity(first) };
  const stored = { prepared_meal_id: "meal", event_type: "eat", servings: 0.5, result_json: result };
  assert.equal(replayMealEvent(stored, "meal", retry).repeated, true);
  assert.throws(() => replayMealEvent(stored, "meal", prepareMealEvent({ ...input, recorded_at: "2099-09-10" })), /操作编号/);
  const legacy = { ...stored, result_json: JSON.stringify({ prepared_meal: { version: 2 } }) };
  assert.equal(replayMealEvent(legacy, "meal", retry).repeated, true);
  assert.throws(() => replayMealEvent(legacy, "meal", { ...retry, type: "discard" }), /操作编号/);
  assert.throws(() => replayMealEvent(legacy, "meal", { ...retry, servings: 1 }), /操作编号/);
  assert.throws(() => replayMealEvent(stored, "other", retry), /操作编号/);
});
