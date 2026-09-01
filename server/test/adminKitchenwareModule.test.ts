import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AdminKitchenwareRepository } from "../src/modules/adminKitchenware/repository.js";
import { AdminKitchenwareService } from "../src/modules/adminKitchenware/service.js";

function repository(overrides: Partial<AdminKitchenwareRepository> = {}): AdminKitchenwareRepository {
  return {
    listCatalog: async () => [], createCatalog: async () => ({ kind: "created", item: { id: 1 } }),
    updateCatalog: async () => ({ kind: "missing" }), removeCatalog: async () => false,
    listAssets: async () => [], updateAssetStatus: async () => false, removeAsset: async () => false, ...overrides,
  };
}

describe("admin kitchenware module", () => {
  test("keeps PostgreSQL JSONB compatible with the legacy admin JSON-string contract", async () => {
    const service = new AdminKitchenwareService(repository({
      listCatalog: async () => [{ id: 3, name: "空气炸锅", aliases: ["气炸锅"], cooking_methods: ["烤"] }],
    }));
    const items = await service.catalog({ search: "空气" });
    assert.equal(items[0]?.aliases, '["气炸锅"]');
    assert.equal(items[0]?.cooking_methods, '["烤"]');
  });

  test("maps repository outcomes to stable admin errors", async () => {
    const service = new AdminKitchenwareService(repository({ createCatalog: async () => ({ kind: "duplicate" }) }));
    await assert.rejects(() => service.createCatalog({ name: "锅", category: "其他", aliases: [], cooking_methods: [] }, { adminUserId: 1 }), /已存在/);
    await assert.rejects(() => service.updateCatalog(99, { name: "锅", category: "其他", aliases: [], cooking_methods: [] }, { adminUserId: 1 }), /不存在/);
    await assert.rejects(() => service.updateAssetStatus(1, "损坏", { adminUserId: 1 }), /无效的厨具状态/);
  });
});
