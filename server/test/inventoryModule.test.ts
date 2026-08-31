import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InventoryItem } from "@dietdigidose/contracts";
import { InventoryDomainError } from "../src/modules/inventory/errors.js";
import type { InventoryRepository } from "../src/modules/inventory/repository.js";
import { InventoryService } from "../src/modules/inventory/service.js";

const item: InventoryItem = {
  id: 1,
  food_name: "番茄",
  category: "蔬菜",
  quantity: "2g",
  expiration_date: "2026-09-05",
  storage_location: "冷藏",
  image_url: null,
  is_available: true,
  quantity_value: 2,
  quantity_unit: "g",
  package_size_value: null,
  package_size_unit: null,
  batch_code: null,
  version: 1,
};

function fakeRepository(overrides: Partial<InventoryRepository> = {}): InventoryRepository {
  return {
    list: async () => [item],
    findOwned: async () => item,
    create: async () => item,
    importShoppingList: async () => ({ items: [item], repeated: false }),
    bulkIntake: async () => ({ batch_id: "11111111-1111-4111-8111-111111111111", items: [item], repeated: false }),
    listPreviewCandidates: async () => [{
      id: item.id,
      food_name: item.food_name,
      quantity_value: item.quantity_value ?? null,
      quantity_unit: item.quantity_unit ?? null,
      expiration_date: item.expiration_date,
      batch_code: item.batch_code ?? null,
      version: item.version,
    }],
    consume: async () => ({ changes: [], items: [item], repeated: false }),
    history: async () => [],
    update: async () => ({ kind: "updated", item: { ...item, version: 2 } }),
    remove: async () => ({ kind: "removed" }),
    ...overrides,
  };
}

describe("inventory module service", () => {
  test("runs business behavior against a replacement repository", async () => {
    const events: number[] = [];
    const service = new InventoryService(fakeRepository(), {
      recordInventoryAdded: (userId) => events.push(userId),
    });

    assert.deepEqual(await service.list(42), [item]);
    assert.equal((await service.create(42, {
      food_name: "番茄",
      category: "蔬菜",
      quantity: "2g",
      expiration_date: "2026-09-05",
      storage_location: "冷藏",
    })).id, 1);
    assert.deepEqual(events, [42]);
  });

  test("keeps structured quantity rules in the service boundary", async () => {
    let updateCalls = 0;
    const service = new InventoryService(fakeRepository({
      update: async () => {
        updateCalls += 1;
        return { kind: "updated", item };
      },
    }));

    await assert.rejects(
      () => service.update(42, 1, { quantity_value: null }),
      (error: unknown) => error instanceof InventoryDomainError && error.code === "INVALID_STRUCTURED_QUANTITY",
    );
    assert.equal(updateCalls, 0);
  });

  test("maps optimistic concurrency independently of the database driver", async () => {
    const service = new InventoryService(fakeRepository({
      update: async () => ({ kind: "conflict" }),
    }));

    await assert.rejects(
      () => service.update(42, 1, { storage_location: "冷冻", version: 1 }),
      (error: unknown) => error instanceof InventoryDomainError && error.code === "INVENTORY_VERSION_CONFLICT",
    );
  });

  test("does not duplicate funnel events for idempotent imports", async () => {
    let events = 0;
    const service = new InventoryService(fakeRepository({
      importShoppingList: async () => ({ items: [item], repeated: true }),
    }), { recordInventoryAdded: () => { events += 1; } });

    const response = await service.importShoppingList(42, {
      idempotency_key: "shopping-import-key-0001",
      items: [{
        food_name: "番茄",
        category: "蔬菜",
        quantity: "2g",
        expiration_date: "2026-09-05",
        storage_location: "冷藏",
      }],
    });
    assert.equal(response.repeated, true);
    assert.equal(events, 0);
  });

  test("keeps FEFO preview logic testable without SQLite", async () => {
    const service = new InventoryService(fakeRepository());
    const preview = await service.previewConsumption(42, {
      items: [{ food_name: "番茄", amount_value: 1, unit: "g" }],
    });
    assert.equal(preview.items[0].fully_covered, true);
    assert.equal(preview.items[0].deductions[0].item_id, 1);
  });
});
