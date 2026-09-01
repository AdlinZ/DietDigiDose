import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AdminFoodAssetsRepository } from "../src/modules/adminFoodAssets/repository.js";
import { AdminFoodAssetsService } from "../src/modules/adminFoodAssets/service.js";

function repository(overrides: Partial<AdminFoodAssetsRepository> = {}): AdminFoodAssetsRepository {
  return {
    listIngredients: async () => ({ items: [], total: 0 }), createIngredient: async () => 1,
    updateIngredient: async () => false, removeIngredient: async () => false,
    addAlias: async () => ({ kind: "missing" }), mergeIngredient: async () => ({ kind: "missing" }),
    coverage: async () => ({ categories: [], gaps: [], anomalies: [] }), pendingCustomFoods: async () => [],
    approveCustomFood: async () => ({ kind: "missing" }), rejectCustomFood: async () => ({ kind: "missing" }),
    ...overrides,
  };
}

describe("admin food assets module", () => {
  test("preserves legacy JSON strings while normalizing pagination", async () => {
    const service = new AdminFoodAssetsService(repository({
      listIngredients: async () => ({ items: [{ id: 2, aliases_json: ["西红柿"], micronutrients_json: { iron: 1 } }], total: 1 }),
    }));
    const result = await service.ingredients({ page: -3, pageSize: 500 });
    assert.equal(result.page, 1); assert.equal(result.pageSize, 100);
    assert.equal(result.items[0]?.aliases_json, '["西红柿"]');
    assert.equal(result.items[0]?.micronutrients_json, '{"iron":1}');
  });

  test("enforces quality and maps repository misses without a database driver", async () => {
    const service = new AdminFoodAssetsService(repository());
    await assert.rejects(() => service.createIngredient({
      name: "异常食材", calories_100g: 1001, protein_100g: 0, carbs_100g: 0, fat_100g: 0,
      source: "official", source_version: "v1", data_license: "test", aliases: [],
    }, { adminUserId: 1 }), /质量校验未通过/);
    await assert.rejects(() => service.removeIngredient(99, { adminUserId: 1 }), /食材未找到/);
    await assert.rejects(() => service.mergeIngredient(1, { targetId: 1 }, { adminUserId: 1 }), /目标食材无效/);
    await assert.rejects(() => service.approveCustomFood(99, { adminUserId: 1 }), /记录未找到/);
  });
});
