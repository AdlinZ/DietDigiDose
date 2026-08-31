import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { KitchenwareError } from "../src/modules/kitchenware/errors.js";
import type { KitchenwareRepository } from "../src/modules/kitchenware/repository.js";
import { KitchenwareService } from "../src/modules/kitchenware/service.js";

function repository(overrides: Partial<KitchenwareRepository> = {}) {
  return {
    listCatalog: async () => [{ id: 1, name: "平底锅", category: "烹饪锅具", aliases: ["不粘锅"], attributes_json: { coating: true } }],
    capabilitiesForCatalog: async () => [{ code: "fry", name: "煎炒", safety_level: "normal", constraints_json: {} }],
    substitutionsForCatalog: async () => [],
    recipeAvailable: async () => false,
    ...overrides,
  } as KitchenwareRepository;
}

describe("kitchenware module", () => {
  test("resolves JSONB catalog aliases without a database-driver dependency", async () => {
    const service = new KitchenwareService(repository());
    const catalog = await service.catalog("不粘锅");
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.name, "平底锅");
    assert.deepEqual(catalog[0]?.attributes, { coating: true });
    assert.equal(catalog[0]?.capabilities[0]?.code, "fry");
  });

  test("keeps recipe availability errors stable", async () => {
    const service = new KitchenwareService(repository());
    await assert.rejects(service.compatibility(7, 99), (error: unknown) => {
      assert(error instanceof KitchenwareError);
      assert.equal(error.status, 404);
      assert.equal(error.message, "菜谱不存在");
      return true;
    });
  });

  test("accepts governed substitutions for required equipment", async () => {
    const service = new KitchenwareService(repository({
      recipeAvailable: async () => true,
      requirementsForRecipe: async () => [{ role: "required", catalog_id: 2, catalog_name: "空气炸锅", confidence: 1, notes: "" }],
      ownedItems: async () => [{ id: 4, name: "烤箱", catalog_id: 3 }],
      capabilityCodesForCatalogIds: async () => ["bake"],
      substitutionFor: async () => ({ name: "烤箱", relation_type: "conditional", impact_json: { time: "延长" }, safety_note: "检查温度" }),
    }));
    const result = await service.compatibility(7, 99);
    assert.equal(result.blocking.length, 0);
    assert.equal(result.requirements[0]?.substitution?.name, "烤箱");
  });
});
