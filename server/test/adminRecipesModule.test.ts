import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AdminRecipesRepository } from "../src/modules/adminRecipes/repository.js";
import { AdminRecipesService } from "../src/modules/adminRecipes/service.js";
import type { AdminRecipeWrite } from "../src/modules/adminRecipes/types.js";

function repository(overrides: Partial<AdminRecipesRepository> = {}): AdminRecipesRepository {
  return {
    list: async () => ({ rows: [], summary: { total: 0, platform: 0, user: 0, pending: 0, needs_review: 0 } }),
    duplicateSources: async () => [], create: async () => 1, update: async () => false, find: async () => null,
    replaceKitchenware: async () => false, scanDuplicates: async () => undefined,
    coverage: async () => ({ byCategory: [], byDifficulty: [], byTime: [], sources: [], qualityFailures: [], duplicates: [], baselines: [] }),
    approve: async () => false, reviewQuality: async () => false, reject: async () => false, remove: async () => false,
    ...overrides,
  };
}

describe("admin recipes module", () => {
  test("maps catalog and review requirements before one atomic repository create", async () => {
    let captured: AdminRecipeWrite | undefined;
    const service = new AdminRecipesService(repository({
      duplicateSources: async () => [{ id: 9, title: "空气炸锅番茄", ingredients_json: [{ name: "番茄" }], steps_json: ["切块", "烤熟"] }],
      create: async (input) => { captured = input; return 42; },
    }), { resolveCatalog: async (name) => name === "空气炸锅" ? { id: 3, confidence: 1, capabilities: [{ code: "dry_heat" }] } : null });
    const result = await service.create(7, {
      title: "空气炸锅番茄", description: "", cook_time: 15, difficulty: "简单", calories: 100,
      protein: 3, carbs: 12, fat: 2, category: "晚餐", tags: ["快手"], steps: ["切块", "烤熟"],
      ingredients: [{ name: "番茄" }], required_kitchenware: ["空气炸锅", "未知锅"], serving_size: 2,
    }, { adminUserId: 7, ipAddress: "127.0.0.1" });
    assert.deepEqual(result, { success: true, id: 42 });
    assert.equal(captured?.sourceContentHash.length, 64);
    assert.deepEqual(captured?.requirements.map((item) => [item.rawName, item.catalogId, item.capabilityCode]), [
      ["空气炸锅", 3, "dry_heat"], ["未知锅", null, null],
    ]);
    assert.deepEqual(captured?.duplicates.map((item) => item.candidateRecipeId), [9]);
  });

  test("keeps cursor and publication errors independent of the database driver", async () => {
    const service = new AdminRecipesService(repository(), { resolveCatalog: async () => null });
    await assert.rejects(() => service.list({ cursor: "invalid" }), /分页游标无效/);
    await assert.rejects(() => service.create(1, {
      title: "缺少步骤", ingredients: [{ name: "番茄" }], steps: [], cook_time: 10,
    }, { adminUserId: 1 }), /食谱发布质量校验未通过/);
    await assert.rejects(() => service.remove(1, 999, { adminUserId: 1 }), /食谱未找到/);
  });
});
