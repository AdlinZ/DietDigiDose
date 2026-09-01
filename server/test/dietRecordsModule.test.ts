import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DietRecordsRepository } from "../src/modules/dietRecords/repository.js";
import { DietRecordsService } from "../src/modules/dietRecords/service.js";

function fakeRepository(overrides: Partial<DietRecordsRepository> = {}): DietRecordsRepository {
  return {
    recordFunnelEvent: async () => undefined,
    list: async () => [],
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
