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

  test("conditional substitutions remain suggestions until their conditions are verified", async () => {
    const service = new KitchenwareService(repository({
      recipeAvailable: async () => true,
      requirementsForRecipe: async () => [{ role: "required", catalog_id: 2, catalog_name: "空气炸锅", confidence: 1, notes: "" }],
      ownedItems: async () => [{ id: 4, name: "烤箱", catalog_id: 3 }],
      capabilityCodesForCatalogIds: async () => ["bake"],
      substitutionFor: async () => ({ name: "烤箱", relation_type: "conditional", impact_json: { time: "延长" }, safety_note: "检查温度" }),
    }));
    const result = await service.compatibility(7, 99);
    assert.equal(result.blocking.length, 1);
    assert.equal(result.requirements[0]?.substitution?.name, "烤箱");
    assert.equal(result.requirements[0]?.substitution?.safetyNote, "检查温度");
  });

  test("partial names are reviewed without assigning ownership of the suggested catalog device", async () => {
    const reviews: unknown[] = []; const saved: Record<string,unknown>[] = [];
    const service = new KitchenwareService(repository({
      upsertMappingReview: async input => { reviews.push(input); },
      createItem: async (_userId,input) => { saved.push(input); return input; },
      findOwnedItem: async () => ({ id: 4 }),
      updateItem: async (_userId,_id,input) => { saved.push(input); return input; },
      requirementsForRecipe: async () => [{ role: "required",catalog_id: 1,catalog_name: "平底锅",confidence: 1 }],
      ownedItems: async () => [{ id: 4,name: "迷你平底锅玩具",catalog_id: null }],
      capabilityCodesForCatalogIds: async ids => { assert.deepEqual(ids,[]); return []; },
    }));
    await service.create(7,{ name: "迷你平底锅玩具" });
    await service.update(7,4,{ name: "迷你平底锅玩具" });
    assert.equal(reviews.length,2);
    assert(saved.every(item => item.catalogId === null && item.name === "迷你平底锅玩具"));
    assert.equal((await service.evaluateRequirements(7,99)).blocking.length,1);
    await service.create(7,{ name: "不粘锅" });
    assert.equal(saved[2].catalogId,1);
    assert.equal(saved[2].name,"平底锅");
    assert.equal(reviews.length,2);
  });
  test("a shared capability cannot bypass a prohibited or conditional equipment substitution", async () => {
    for (const relation of ["forbidden","conditional","equivalent"]) {
      const service = new KitchenwareService(repository({
        requirementsForRecipe: async () => [{ role: "required",catalog_id: 1,capability_code: "fry",confidence: 1 }],
        ownedItems: async () => [{ id: 7,name: "替代设备",catalog_id: 2 }],
        substitutionsForCatalog: async () => [{ id: 2,relation_type: relation }],
        capabilityCodesForCatalogIds: async ids => ids.includes(2) ? ["fry"] : [],
        substitutionFor: async () => relation === "forbidden" ? null : { name: "替代设备",relation_type: relation },
      }));
      const result = await service.evaluateRequirements(1,99);
      assert.equal(result.blocking.length,relation === "equivalent" ? 0 : 1,relation);
    }
  });
});
