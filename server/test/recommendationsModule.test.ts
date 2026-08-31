import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RecommendationsError } from "../src/modules/recommendations/errors.js";
import type { RecommendationsRepository } from "../src/modules/recommendations/repository.js";
import { RecommendationsService } from "../src/modules/recommendations/service.js";

function repository(overrides: Partial<RecommendationsRepository> = {}) {
  return {
    profile: async () => null, inventory: async () => [], kitchenware: async () => [],
    recipes: async () => [{ id: 1, title: "番茄汤", ingredients_json: [{ name: "番茄" }], steps_json: ["煮熟"], status: "approved" }],
    favoriteRecipeIds: async () => [], recentRecipeIds: async () => [], skippedRecipeIds: async () => [],
    dietTotals: async () => ({ calories: 0, protein: 0 }), dailyCaloriesTarget: async () => 2000,
    createRequest: async () => {},
    ...overrides,
  } as RecommendationsRepository;
}
const kitchenware = {
  requirements: async () => [],
  evaluateRequirements: async () => ({ requirements: [], blocking: [] }),
};

describe("recommendations module", () => {
  test("scores PostgreSQL-style JSON values and persists a driver-neutral snapshot", async () => {
    let stored: unknown;
    const service = new RecommendationsService(repository({ createRequest: async (input) => { stored = input; } }), kitchenware);
    const page = await service.page(7, { surface: "home", matchStatus: "all", pageSize: 10 });
    assert.equal(page.total, 1);
    assert.equal((page.items[0]?.recipe as Record<string, unknown>).title, "番茄汤");
    assert.equal(typeof page.scoringVersion, "string");
    assert(stored);
  });

  test("maps missing and mismatched request versions to stable errors", async () => {
    const missing = new RecommendationsService(repository({
      findEvent: async () => null, recipeAvailable: async () => true, requestScoringVersion: async () => null,
    }), kitchenware);
    await assert.rejects(missing.event(7, { requestId: "missing", recipeId: 1, eventType: "view", scoringVersion: "v1",
      surface: "home", idempotencyKey: "event-key-0001" }), (error: unknown) => {
      assert(error instanceof RecommendationsError); assert.equal(error.code, "RECOMMENDATION_REQUEST_NOT_FOUND"); return true;
    });
    const mismatch = new RecommendationsService(repository({
      findEvent: async () => null, recipeAvailable: async () => true, requestScoringVersion: async () => "v2",
    }), kitchenware);
    await assert.rejects(mismatch.event(7, { requestId: "request", recipeId: 1, eventType: "view", scoringVersion: "v1",
      surface: "home", idempotencyKey: "event-key-0002" }), (error: unknown) => {
      assert(error instanceof RecommendationsError); assert.equal(error.code, "RECOMMENDATION_VERSION_MISMATCH"); return true;
    });
  });
});
