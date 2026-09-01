import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HouseholdsRepository } from "../src/modules/households/repository.js";
import { HouseholdsService } from "../src/modules/households/service.js";

function repository(overrides: Partial<HouseholdsRepository> = {}): HouseholdsRepository {
  return {
    create: async () => ({}), mine: async () => [], join: async () => ({ kind: "not_found" }),
    leave: async () => ({ kind: "not_member" }), transferOwner: async () => ({ kind: "not_owner" }),
    shoppingList: async () => null, createShopping: async () => ({ kind: "not_member" }),
    updateShopping: async () => ({ kind: "not_found" }), removeShopping: async () => "not_found",
    intake: async () => ({ kind: "not_member" }), inventory: async () => null,
    createInventory: async () => ({ kind: "not_member" }), updateInventory: async () => ({ kind: "not_found" }),
    removeInventory: async () => "not_found", history: async () => null, ...overrides,
  };
}

describe("households module", () => {
  test("retries invite collisions and preserves join status contracts", async () => {
    const codes: string[] = [];
    const service = new HouseholdsService(repository({
      create: async (_userId, name, code) => { codes.push(code); return codes.length === 1 ? null : { id: 9, name, invite_code: code }; },
      join: async () => ({ kind: "joined", household: { id: 9 } }),
    }), (() => { let next = 0; return () => ["COLLIDE1", "FRESH123"][next++]!; })());
    assert.equal((await service.create(7, " 家庭 ")).invite_code, "FRESH123");
    assert.deepEqual(codes, ["COLLIDE1", "FRESH123"]);
    assert.equal((await service.join(7, " fresh123 ")).status, 201);
  });

  test("formats driver-neutral shopping rows and maps optimistic conflicts", async () => {
    const row = { id: "item", household_id: "3", name: "牛奶", amount: "2盒", category: "乳制品", checked: true,
      storage_location: "冷藏", expiration_date: null, created_by_user_id: "1", updated_by_user_id: "2",
      purchased_by_user_id: "2", creator_name: "甲", updater_name: "乙", purchaser_name: "乙", version: "2",
      created_at: new Date("2030-01-01T00:00:00Z"), updated_at: "2030-01-02 00:00:00" };
    const service = new HouseholdsService(repository({
      shoppingList: async () => [row], createShopping: async () => ({ kind: "created", item: row,
        active: [{ id: "older", name: "牛奶（盒装）", amount: "1盒", category: "乳制品" }] }),
      updateShopping: async () => ({ kind: "version_conflict" }),
    }));
    const listed = await service.shoppingList(1, 3);
    assert.equal(listed[0]?.checked, true); assert.equal(listed[0]?.createdAt, "2030-01-01T00:00:00.000Z");
    assert.equal((await service.createShopping(1, 3, "item", { name: "牛奶", amount: "2盒", category: "乳制品" }))
      .mergeCandidates[0]?.id, "older");
    await assert.rejects(() => service.updateShopping(1, 3, "item", { version: 1, checked: true }), /其他成员更新/);
  });

  test("keeps repeated intake and household permissions independent of the driver", async () => {
    const service = new HouseholdsService(repository({
      intake: async () => ({ kind: "repeated", value: { batchId: "batch", inventoryIds: [4], count: 1, repeated: true } }),
      inventory: async () => [{ id: 4, is_available: 1 }], history: async () => null,
    }));
    const intake = await service.intake(1, 3, "batch", { idempotencyKey: "1234567890123456", items: [] });
    assert.equal(intake.status, 200); assert.equal(intake.body.repeated, true);
    assert.equal((await service.inventory(1, 3))[0]?.is_available, true);
    await assert.rejects(() => service.history(2, 3), /无权查看/);
  });
});
