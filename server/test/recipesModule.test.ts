import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RecipesRepository } from "../src/modules/recipes/repository.js";
import { RecipesService } from "../src/modules/recipes/service.js";
import type { RecipeSubmissionWrite } from "../src/modules/recipes/types.js";

function repository(overrides: Partial<RecipesRepository> = {}): RecipesRepository {
  return {
    listPublic: async () => ({ rows: [], total: 0 }), librarySummary: async () => ({ official: 0, community: 0, personal: 0, favorites: 0 }),
    listMine: async () => [], listFavorites: async () => [], favoriteCount: async () => 0, requirementsForRecipes: async () => [],
    createSubmission: async () => 1, findSubmission: async () => null, updateSubmission: async () => false,
    withdrawSubmission: async () => false, isFavorite: async () => false, addFavorite: async () => false,
    removeFavorite: async () => undefined, findPublic: async () => null, ...overrides,
  };
}

describe("recipes module", () => {
  test("formats PostgreSQL JSONB rows and batches kitchenware requirements", async () => {
    const calls: number[][] = [];
    const service = new RecipesService(repository({
      listPublic: async (input) => ({ rows: [{ id: 8, title: "番茄蛋", protein: 12, carbs: 8, fat: 5,
        tags: ["快手"], steps_json: ["煎熟"], ingredients_json: [{ name: "番茄", amount: "1个", group: "main" }],
        nutrition_json: [{ key: "fiber", label: "膳食纤维", value: 2, unit: "g" }],
        quality_status: "trusted", nutrition_basis: "source", updated_at: new Date("2026-09-01T01:02:03Z") }], total: 1 }),
      requirementsForRecipes: async (ids) => { calls.push(ids); return [{ recipe_id: 8, role: "required", catalog_id: 3,
        catalog_name: "平底锅", capability_code: null, confidence: 1, notes: "" }]; },
    }), { resolveCatalog: async () => null });
    const result = await service.list(undefined, { pageSize: "10" }, { protocol: "https", host: "api.example.test" });
    assert.deepEqual(calls, [[8]]);
    const body = result.body as { items: Array<Record<string, unknown>>; total: number };
    assert.equal(body.total, 1);
    assert.deepEqual(body.items[0]?.tags, ["快手"]);
    assert.equal((body.items[0]?.nutrition as unknown[]).length, 4);
    assert.equal((body.items[0]?.required_kitchenware as Array<{ catalogName: string }>)[0]?.catalogName, "平底锅");
    assert.equal(body.items[0]?.updated_at, "2026-09-01 01:02:03");
  });

  test("maps submission requirements before one repository write", async () => {
    let captured: RecipeSubmissionWrite | undefined;
    const service = new RecipesService(repository({
      createSubmission: async (input) => { captured = input; return 42; },
    }), { resolveCatalog: async (name) => name === "空气炸锅" ? { id: 9, confidence: 1 } : null });
    const result = await service.createSubmission(7, {
      title: "空气炸锅番茄", description: "", image_url: "", cook_time: 12, difficulty: "简单",
      calories: 100, protein: 4, carbs: 10, fat: 3, category: "晚餐", tags: ["快手"],
      steps: ["空气炸锅烤熟"], ingredients: [{ name: "番茄", amount: "1个" }],
      required_kitchenware: ["空气炸锅", "未知器具"], optional_kitchenware: [],
    });
    assert.equal(result.id, 42);
    assert.equal(captured?.authorUserId, 7);
    assert.equal(captured?.sourceContentHash.length, 64);
    assert.deepEqual(captured?.requirements.map((item) => [item.rawName, item.catalogId]),
      [["空气炸锅", 9], ["未知器具", null]]);
  });

  test("preserves ownership and public-visibility errors independently of the driver", async () => {
    const service = new RecipesService(repository(), { resolveCatalog: async () => null });
    await assert.rejects(() => service.updateSubmission(2, 99, {}), /未找到该投稿/);
    await assert.rejects(() => service.addFavorite(2, 99), /未找到该食谱/);
    await assert.rejects(() => service.list(undefined, { scope: "personal" }, { protocol: "http" }), /登录后查看个人食谱库/);
  });
});
