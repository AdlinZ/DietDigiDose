import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CookingQueueRepository } from "../src/modules/cookingQueue/repository.js";
import { CookingQueueService, formatQueueItem } from "../src/modules/cookingQueue/service.js";
import type { QueueRow } from "../src/modules/cookingQueue/types.js";

const row: QueueRow = {
  id: "11111111-1111-4111-8111-111111111111", recipe_id: 1, position: 0, status: "waiting",
  version: 1, recipe_snapshot_json: { title: "番茄炒蛋", ingredients: ["番茄"] },
  prepared_ingredients_json: [], created_at: "2026-09-01", updated_at: "2026-09-01",
};

function fakeRepository(overrides: Partial<CookingQueueRepository> = {}): CookingQueueRepository {
  return {
    recommendationRequest: async () => null,
    list: async () => [row], findOwned: async () => row,
    findApprovedRecipe: async () => ({ id: 1, title: "番茄炒蛋", image_url: null, cook_time: 10, calories: 200, difficulty: "简单", ingredients_json: ["番茄"] }),
    enqueue: async () => ({ kind: "created", row }), update: async () => ({ ...row, version: 2 }),
    reorder: async () => [row], transition: async (_id, _user, _version, status) => ({ ...row, status, version: 2 }),
    cancel: async () => true, cancelAll: async () => 1, ...overrides,
  };
}

describe("cooking queue module", () => {
  test("formats SQLite text JSON and PostgreSQL JSONB identically", () => {
    assert.deepEqual(formatQueueItem(row).ingredients, ["番茄"]);
    assert.equal(formatQueueItem({ ...row, recipe_snapshot_json: JSON.stringify({ title: "番茄炒蛋", ingredients: ["番茄"] }) }).title, "番茄炒蛋");
  });

  test("rejects invalid state transitions before persistence", async () => {
    const service = new CookingQueueService(fakeRepository({ findOwned: async () => ({ ...row, status: "completed" }) }));
    await assert.rejects(() => service.start(String(row.id), 1, 1), (error: any) => error.code === "COOKING_QUEUE_INVALID_TRANSITION");
  });

  test("maps atomic repository capacity results to a stable conflict", async () => {
    const service = new CookingQueueService(fakeRepository({ enqueue: async () => ({ kind: "full" }) }));
    await assert.rejects(() => service.create(1, { recipeId: 1 }), (error: any) => error.code === "COOKING_QUEUE_FULL");
  });
});

test("queue selection snapshots belong to the user and recipe and cannot be taken from a client payload", async () => {
  const inventory = { version: 1, scope: "personal", allocations: [{ itemId: 4, itemVersion: 2, amount: 3, unit: "g" }] };
  let snapshot: Record<string, unknown> | undefined;
  const service = new CookingQueueService(fakeRepository({
    recommendationRequest: async (userId, requestId) => userId === 7 && requestId === "request" ? { scoring_version: "v1", results_json: JSON.stringify([{ recipeId: 1, features: { inventoryEvidence: inventory } }]) } : null,
    enqueue: async input => { snapshot = input.snapshot; return { kind: "created", row }; },
  }));
  await service.create(7, { recipeId: 1, recommendationRequestId: "request" });
  assert.equal(typeof (snapshot?.selectionEvidence as Record<string, unknown>).selectedAt, "string");
  assert.deepEqual({ ...(snapshot?.selectionEvidence as Record<string, unknown>), selectedAt: undefined }, { selectedAt: undefined, version: 1, requestId: "request", recipeId: 1, scoringVersion: "v1", inventory });
  await assert.rejects(service.create(8, { recipeId: 1, recommendationRequestId: "request" }), /推荐来源/);
  await assert.rejects(service.create(7, { recipeId: 2, recommendationRequestId: "request" }), /推荐来源/);
  await service.create(7, { recipeId: 1 });
  assert.equal(snapshot?.selectionEvidence, null);
});
