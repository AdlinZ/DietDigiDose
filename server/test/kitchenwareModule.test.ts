import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { KITCHENWARE_CATALOG_V4, KITCHENWARE_CATALOG_V4_RELEASE } from "../src/data/kitchenwareCatalogV4.generated.js";
import { KitchenwareError } from "../src/modules/kitchenware/errors.js";
import type { KitchenwareRepository } from "../src/modules/kitchenware/repository.js";
import { KitchenwareService } from "../src/modules/kitchenware/service.js";
import { kitchenwareCatalogV4Sql } from "../src/services/kitchenwareCatalogSeed.js";
import { normalizeContentTerm } from "../src/utils/contentNormalization.js";

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

  test("does not resolve an unknown phrase from a one-character generic alias", async () => {
    const service = new KitchenwareService(repository());
    const resolved = await service.resolveCatalog("契约测试未知锅", [{ id: 8, name: "通用锅", category: "烹饪锅具", aliases: ["锅"] }]);
    assert.equal(resolved, null);
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

  test("does not bypass a catalog requirement with a broad matching capability", async () => {
    const service = new KitchenwareService(repository({
      recipeAvailable: async () => true,
      requirementsForRecipe: async () => [{ role: "required", catalog_id: 2, catalog_name: "空气炸锅", capability_code: "bake", confidence: 1, notes: "" }],
      ownedItems: async () => [{ id: 4, name: "烤箱", catalog_id: 3 }],
      capabilityCodesForCatalogIds: async () => ["bake"],
      substitutionFor: async () => null,
    }));
    const result = await service.compatibility(7, 99);
    assert.equal(result.blocking.length, 1);
  });

  test("accepts a capability-only requirement", async () => {
    const service = new KitchenwareService(repository({
      recipeAvailable: async () => true,
      requirementsForRecipe: async () => [{ role: "required", catalog_id: null, catalog_name: null, capability_code: "bake", confidence: 1, notes: "" }],
      ownedItems: async () => [{ id: 4, name: "烤箱", catalog_id: 3 }],
      capabilityCodesForCatalogIds: async () => ["bake"],
    }));
    const result = await service.compatibility(7, 99);
    assert.equal(result.blocking.length, 0);
  });

  test("defensively rejects forbidden substitutions", async () => {
    const service = new KitchenwareService(repository({
      recipeAvailable: async () => true,
      requirementsForRecipe: async () => [{ role: "required", catalog_id: 2, catalog_name: "豆浆机", confidence: 1, notes: "" }],
      ownedItems: async () => [{ id: 4, name: "养生壶", catalog_id: 3 }],
      capabilityCodesForCatalogIds: async () => [],
      substitutionFor: async () => ({ name: "养生壶", relation_type: "forbidden", impact_json: {}, safety_note: "不可替代" }),
    }));
    const result = await service.compatibility(7, 99);
    assert.equal(result.blocking.length, 1);
    assert.equal(result.requirements[0]?.substitution, null);
  });

  test("ships the verified v4 concept and alias layer without ambiguous names", () => {
    assert.equal(KITCHENWARE_CATALOG_V4_RELEASE.typeConcepts, 241);
    assert.equal(KITCHENWARE_CATALOG_V4.length, 241);
    assert.equal(new Set(KITCHENWARE_CATALOG_V4.map((entry) => entry.conceptId)).size, 241);
    assert.equal(new Set(KITCHENWARE_CATALOG_V4.map((entry) => entry.name)).size, 241);
    assert.equal(KITCHENWARE_CATALOG_V4.reduce((total, entry) => total + entry.aliases.length, 0), 271);
    const owners = new Map<string, string>();
    for (const entry of KITCHENWARE_CATALOG_V4) {
      for (const value of [entry.name, ...entry.aliases]) {
        const normalized = normalizeContentTerm(value);
        assert(!owners.has(normalized), `${value} is shared by ${owners.get(normalized)} and ${entry.name}`);
        owners.set(normalized, entry.name);
      }
    }
  });

  test("seeds v4 idempotently and removes legacy aliases that became canonical concepts", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE kitchenware_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]', cooking_methods TEXT NOT NULL DEFAULT '[]', care_note TEXT,
        source TEXT NOT NULL DEFAULT 'system', attributes_json TEXT NOT NULL DEFAULT '{}',
        quality_status TEXT NOT NULL DEFAULT 'trusted', capability_version INTEGER NOT NULL DEFAULT 1,
        updated_at DATETIME
      );
      CREATE TABLE kitchenware_capabilities (
        code TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', safety_level TEXT NOT NULL
      );
      CREATE TABLE kitchenware_catalog_capabilities (
        catalog_id INTEGER NOT NULL, capability_code TEXT NOT NULL, constraints_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (catalog_id, capability_code)
      );
      CREATE TABLE kitchenware_substitutions (
        source_catalog_id INTEGER NOT NULL, substitute_catalog_id INTEGER NOT NULL, relation_type TEXT NOT NULL,
        impact_json TEXT NOT NULL DEFAULT '{}', safety_note TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (source_catalog_id, substitute_catalog_id)
      );
      INSERT INTO kitchenware_catalog (name, category, aliases, source)
        VALUES ('慢炖锅', '小家电', '["电炖锅"]', 'system');
    `);
    database.exec(kitchenwareCatalogV4Sql());
    database.exec(kitchenwareCatalogV4Sql());
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM kitchenware_catalog").get() as { count: number }).count, 242);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM kitchenware_catalog WHERE quality_status='trusted'").get() as { count: number }).count, 241);
    assert.deepEqual(JSON.parse((database.prepare("SELECT aliases FROM kitchenware_catalog WHERE name='慢炖锅'").get() as { aliases: string }).aliases), []);
    assert.equal((database.prepare("SELECT quality_status FROM kitchenware_catalog WHERE name='慢炖锅'").get() as { quality_status: string }).quality_status, "deprecated");
    assert.equal((database.prepare("SELECT source FROM kitchenware_catalog WHERE name='空气炸锅'").get() as { source: string }).source,
      KITCHENWARE_CATALOG_V4_RELEASE.release);
    assert.equal((database.prepare("SELECT relation_type FROM kitchenware_substitutions s JOIN kitchenware_catalog source ON source.id=s.source_catalog_id JOIN kitchenware_catalog substitute ON substitute.id=s.substitute_catalog_id WHERE source.name='豆浆机' AND substitute.name='养生壶'").get() as { relation_type: string }).relation_type, "forbidden");
    database.close();
  });
});
