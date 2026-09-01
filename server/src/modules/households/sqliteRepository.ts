import type Database from "better-sqlite3";
import type { HouseholdsRepository } from "./repository.js";
import type {
  IntakeResult, InventoryCreateInput, InventoryUpdateInput, Row, ShoppingCreateInput, ShoppingIntakeInput, ShoppingUpdateInput,
} from "./types.js";

const shoppingSelect = `SELECT hs.*,
  COALESCE(creator.nickname,creator.username) AS creator_name,
  COALESCE(editor.nickname,editor.username) AS updater_name,
  COALESCE(buyer.nickname,buyer.username) AS purchaser_name
  FROM household_shopping_items hs JOIN users creator ON creator.id=hs.created_by_user_id
  JOIN users editor ON editor.id=hs.updated_by_user_id LEFT JOIN users buyer ON buyer.id=hs.purchased_by_user_id`;
const inventorySelect = `SELECT hi.*,COALESCE(u.nickname,u.username) AS creator_name FROM household_inventory_items hi
  LEFT JOIN users u ON hi.created_by_user_id=u.id`;

export class SqliteHouseholdsRepository implements HouseholdsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async create(userId: number, name: string, inviteCode: string) {
    try {
      return this.database.transaction(() => {
        const inserted = this.database.prepare("INSERT INTO households (name,invite_code,owner_id) VALUES (?,?,?)")
          .run(name, inviteCode, userId);
        const id = Number(inserted.lastInsertRowid);
        this.database.prepare("INSERT INTO household_members (household_id,user_id,role) VALUES (?,?,'owner')").run(id, userId);
        return this.database.prepare("SELECT * FROM households WHERE id=?").get(id) as Row;
      })();
    } catch (error) {
      if (error instanceof Error && error.message.includes("households.invite_code")) return null;
      throw error;
    }
  }

  async mine(userId: number) {
    const households = this.database.prepare(`SELECT h.*,hm.role AS my_role FROM households h
      JOIN household_members hm ON h.id=hm.household_id WHERE hm.user_id=? ORDER BY h.created_at DESC`).all(userId) as Row[];
    return households.map((household) => ({ ...household, members: this.database.prepare(`SELECT u.id AS user_id,u.username,
      COALESCE(u.nickname,u.username) AS nickname,u.avatar_url,hm.role,hm.joined_at FROM household_members hm
      JOIN users u ON hm.user_id=u.id WHERE hm.household_id=? ORDER BY hm.joined_at`).all(household.id) }));
  }

  async join(userId: number, inviteCode: string) {
    return this.database.transaction(() => {
      const household = this.database.prepare("SELECT * FROM households WHERE invite_code=?").get(inviteCode) as Row | undefined;
      if (!household) return { kind: "not_found" as const };
      if (this.member(Number(household.id), userId)) return { kind: "existing" as const, household };
      this.database.prepare("INSERT INTO household_members (household_id,user_id,role) VALUES (?,?,'member')")
        .run(household.id, userId);
      return { kind: "joined" as const, household };
    })();
  }

  async leave(userId: number, householdId: number) {
    return this.database.transaction(() => {
      const member = this.member(householdId, userId);
      if (!member) return { kind: "not_member" as const };
      if (member.role === "owner") {
        const next = this.database.prepare("SELECT * FROM household_members WHERE household_id=? AND user_id<>? ORDER BY id LIMIT 1")
          .get(householdId, userId) as Row | undefined;
        if (!next) {
          this.database.prepare("DELETE FROM households WHERE id=?").run(householdId);
          return { kind: "dissolved" as const };
        }
        this.database.prepare("UPDATE household_members SET role='owner' WHERE id=?").run(next.id);
        this.database.prepare("UPDATE households SET owner_id=?,version=version+1 WHERE id=?").run(next.user_id, householdId);
        this.database.prepare("DELETE FROM household_members WHERE household_id=? AND user_id=?").run(householdId, userId);
        this.activity(householdId, userId, "owner_transfer_leave", "家庭所有者", "1次");
        return { kind: "transferred" as const, newOwnerUserId: Number(next.user_id) };
      }
      this.database.prepare("DELETE FROM household_members WHERE household_id=? AND user_id=?").run(householdId, userId);
      return { kind: "left" as const };
    })();
  }

  async transferOwner(userId: number, householdId: number, newOwnerUserId: number, version: number) {
    return this.database.transaction(() => {
      const household = this.database.prepare("SELECT * FROM households WHERE id=? AND owner_id=?").get(householdId, userId) as Row | undefined;
      if (!household) return { kind: "not_owner" as const };
      if (!this.member(householdId, newOwnerUserId)) return { kind: "target_not_member" as const };
      const changed = this.database.prepare(`UPDATE households SET owner_id=?,version=version+1
        WHERE id=? AND owner_id=? AND version=?`).run(newOwnerUserId, householdId, userId, version);
      if (changed.changes !== 1) return { kind: "version_conflict" as const };
      this.database.prepare("UPDATE household_members SET role='member' WHERE household_id=? AND user_id=?").run(householdId, userId);
      this.database.prepare("UPDATE household_members SET role='owner' WHERE household_id=? AND user_id=?").run(householdId, newOwnerUserId);
      this.activity(householdId, userId, "owner_transfer", "家庭所有者", "1次");
      return { kind: "transferred" as const, version: Number(household.version) + 1 };
    })();
  }

  async shoppingList(userId: number, householdId: number) {
    if (!this.member(householdId, userId)) return null;
    return this.database.prepare(`${shoppingSelect} WHERE hs.household_id=? AND hs.deleted_at IS NULL
      AND hs.transferred_at IS NULL ORDER BY hs.checked,hs.updated_at DESC`).all(householdId) as Row[];
  }

  async createShopping(userId: number, householdId: number, id: string, input: ShoppingCreateInput) {
    return this.database.transaction(() => {
      if (!this.member(householdId, userId)) return { kind: "not_member" as const };
      const active = this.database.prepare(`SELECT id,name,amount,category FROM household_shopping_items
        WHERE household_id=? AND deleted_at IS NULL AND transferred_at IS NULL`).all(householdId) as Row[];
      this.database.prepare(`INSERT INTO household_shopping_items
        (id,household_id,name,amount,category,storage_location,expiration_date,created_by_user_id,updated_by_user_id)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, householdId, input.name, input.amount, input.category,
      input.storageLocation ?? null, input.expirationDate ?? null, userId, userId);
      this.activity(householdId, userId, "shopping_add", input.name, input.amount, input.storageLocation);
      const item = this.database.prepare(`${shoppingSelect} WHERE hs.id=? AND hs.household_id=?`).get(id, householdId) as Row;
      return { kind: "created" as const, item, active };
    })();
  }

  async updateShopping(userId: number, householdId: number, itemId: string, input: ShoppingUpdateInput) {
    return this.database.transaction(() => {
      if (!this.member(householdId, userId)) return { kind: "not_member" as const };
      const current = this.database.prepare(`SELECT * FROM household_shopping_items WHERE id=? AND household_id=?
        AND deleted_at IS NULL AND transferred_at IS NULL`).get(itemId, householdId) as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      const checked = input.checked === undefined ? Boolean(current.checked) : input.checked;
      const purchasedBy = checked ? (input.checked === true ? userId : current.purchased_by_user_id) : null;
      const changed = this.database.prepare(`UPDATE household_shopping_items SET name=?,amount=?,category=?,checked=?,
        storage_location=?,expiration_date=?,updated_by_user_id=?,purchased_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND household_id=? AND version=? AND deleted_at IS NULL AND transferred_at IS NULL`).run(
        input.name ?? current.name, input.amount ?? current.amount, input.category ?? current.category, checked ? 1 : 0,
        input.storageLocation ?? current.storage_location, input.expirationDate ?? current.expiration_date, userId, purchasedBy,
        itemId, householdId, input.version,
      );
      if (changed.changes !== 1) return { kind: "version_conflict" as const };
      this.activity(householdId, userId, input.checked === undefined ? "shopping_edit" : checked ? "shopping_purchase" : "shopping_uncheck",
        input.name ?? String(current.name), input.amount ?? String(current.amount), input.storageLocation ?? String(current.storage_location || ""));
      const item = this.database.prepare(`${shoppingSelect} WHERE hs.id=? AND hs.household_id=?`).get(itemId, householdId) as Row;
      return { kind: "updated" as const, item };
    })();
  }

  async removeShopping(userId: number, householdId: number, itemId: string, version: number) {
    return this.database.transaction(() => {
      if (!this.member(householdId, userId)) return "not_member" as const;
      const item = this.database.prepare(`SELECT * FROM household_shopping_items WHERE id=? AND household_id=?
        AND deleted_at IS NULL AND transferred_at IS NULL`).get(itemId, householdId) as Row | undefined;
      if (!item) return "not_found" as const;
      const changed = this.database.prepare(`UPDATE household_shopping_items SET deleted_at=CURRENT_TIMESTAMP,
        updated_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND household_id=? AND version=?
        AND deleted_at IS NULL AND transferred_at IS NULL`).run(userId, itemId, householdId, version);
      if (changed.changes !== 1) return "version_conflict" as const;
      this.activity(householdId, userId, "shopping_delete", String(item.name), String(item.amount), String(item.storage_location || ""));
      return "deleted" as const;
    })();
  }

  async intake(userId: number, householdId: number, batchId: string, input: ShoppingIntakeInput) {
    try {
      return this.database.transaction(() => {
        if (!this.member(householdId, userId)) return { kind: "not_member" as const };
        const saved = this.database.prepare(`SELECT result_json FROM household_shopping_intake_batches
          WHERE household_id=? AND idempotency_key=?`).get(householdId, input.idempotencyKey) as { result_json: string } | undefined;
        if (saved) return { kind: "repeated" as const, value: { ...JSON.parse(saved.result_json), repeated: true } as IntakeResult };
        const inventoryIds: number[] = [];
        for (const confirmed of input.items) {
          const item = this.database.prepare(`SELECT * FROM household_shopping_items WHERE id=? AND household_id=?
            AND checked=1 AND deleted_at IS NULL AND transferred_at IS NULL`).get(confirmed.id, householdId) as Row | undefined;
          if (!item || Number(item.version) !== confirmed.version) throw new Error("HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
          const inserted = this.database.prepare(`INSERT INTO household_inventory_items
            (household_id,created_by_user_id,food_name,category,quantity,expiration_date,storage_location,image_url,is_available)
            VALUES (?,?,?,?,?,?,?,NULL,1)`).run(householdId, userId, item.name, item.category,
          confirmed.quantity, confirmed.expirationDate, confirmed.storageLocation);
          inventoryIds.push(Number(inserted.lastInsertRowid));
          const moved = this.database.prepare(`UPDATE household_shopping_items SET transferred_at=CURRENT_TIMESTAMP,intake_batch_id=?,
            updated_by_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND household_id=? AND version=?
            AND transferred_at IS NULL`).run(batchId, userId, item.id, householdId, confirmed.version);
          if (moved.changes !== 1) throw new Error("HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
          this.activity(householdId, userId, "shopping_intake", String(item.name), confirmed.quantity, confirmed.storageLocation);
        }
        const value: IntakeResult = { batchId, inventoryIds, count: inventoryIds.length, repeated: false };
        this.database.prepare(`INSERT INTO household_shopping_intake_batches
          (id,household_id,user_id,idempotency_key,result_json) VALUES (?,?,?,?,?)`)
          .run(batchId, householdId, userId, input.idempotencyKey, JSON.stringify(value));
        return { kind: "created" as const, value };
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "HOUSEHOLD_SHOPPING_VERSION_CONFLICT") return { kind: "version_conflict" as const };
      throw error;
    }
  }

  async inventory(userId: number, householdId: number) {
    if (!this.member(householdId, userId)) return null;
    return this.database.prepare(`${inventorySelect} WHERE hi.household_id=? AND hi.is_available=1 ORDER BY hi.expiration_date`)
      .all(householdId) as Row[];
  }

  async createInventory(userId: number, householdId: number, input: InventoryCreateInput) {
    return this.database.transaction(() => {
      if (!this.member(householdId, userId)) return { kind: "not_member" as const };
      const inserted = this.database.prepare(`INSERT INTO household_inventory_items
        (household_id,created_by_user_id,food_name,category,quantity,expiration_date,storage_location,image_url,is_available)
        VALUES (?,?,?,?,?,?,?,?,1)`).run(householdId, userId, input.food_name, input.category || "蔬菜", input.quantity || "1份",
      input.expiration_date, input.storage_location || "冷藏", input.image_url || null);
      this.activity(householdId, userId, "add", input.food_name, input.quantity || "1份", input.storage_location || "冷藏");
      const item = this.database.prepare(`${inventorySelect} WHERE hi.id=?`).get(inserted.lastInsertRowid) as Row;
      return { kind: "completed" as const, item };
    })();
  }

  async updateInventory(userId: number, householdId: number, itemId: number, input: InventoryUpdateInput) {
    return this.database.transaction(() => {
      if (!this.member(householdId, userId)) return { kind: "not_member" as const };
      const current = this.database.prepare("SELECT * FROM household_inventory_items WHERE id=? AND household_id=?")
        .get(itemId, householdId) as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      this.database.prepare(`UPDATE household_inventory_items SET food_name=?,category=?,quantity=?,expiration_date=?,storage_location=?,
        image_url=?,is_available=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND household_id=?`).run(
        input.food_name ?? current.food_name, input.category ?? current.category, input.quantity ?? current.quantity,
        input.expiration_date ?? current.expiration_date, input.storage_location ?? current.storage_location,
        input.image_url ?? current.image_url, input.is_available === undefined ? current.is_available : input.is_available ? 1 : 0,
        itemId, householdId,
      );
      this.activity(householdId, userId, "edit", input.food_name || String(current.food_name), input.quantity || String(current.quantity),
        input.storage_location || String(current.storage_location));
      const item = this.database.prepare("SELECT * FROM household_inventory_items WHERE id=?").get(itemId) as Row;
      return { kind: "completed" as const, item };
    })();
  }

  async removeInventory(userId: number, householdId: number, itemId: number) {
    return this.database.transaction(() => {
      if (!this.member(householdId, userId)) return "not_member" as const;
      const item = this.database.prepare("SELECT * FROM household_inventory_items WHERE id=? AND household_id=?")
        .get(itemId, householdId) as Row | undefined;
      if (!item) return "not_found" as const;
      this.database.prepare("DELETE FROM household_inventory_items WHERE id=?").run(itemId);
      this.activity(householdId, userId, "consume", String(item.food_name), String(item.quantity), String(item.storage_location));
      return "removed" as const;
    })();
  }

  async history(userId: number, householdId: number) {
    if (!this.member(householdId, userId)) return null;
    return this.database.prepare(`SELECT hl.*,COALESCE(u.nickname,u.username) AS operator_name,u.avatar_url AS operator_avatar
      FROM household_activity_logs hl LEFT JOIN users u ON hl.operator_user_id=u.id WHERE hl.household_id=?
      ORDER BY hl.created_at DESC LIMIT 100`).all(householdId) as Row[];
  }

  private member(householdId: number, userId: number) {
    return this.database.prepare("SELECT * FROM household_members WHERE household_id=? AND user_id=?")
      .get(householdId, userId) as Row | undefined;
  }
  private activity(householdId: number, userId: number, action: string, name: string, quantity: string, location = "") {
    this.database.prepare(`INSERT INTO household_activity_logs
      (household_id,operator_user_id,action,food_name,quantity,storage_location) VALUES (?,?,?,?,?,?)`)
      .run(householdId, userId, action, name, quantity, location || "-");
  }
}
