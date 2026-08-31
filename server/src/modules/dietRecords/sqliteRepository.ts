import type Database from "better-sqlite3";
import { applyInventoryConsumptions, InventoryQuantityError, type InventoryConsumption } from "../../services/inventoryQuantity.js";
import type { DietRecordsRepository } from "./repository.js";
import type { PreparedCookingCompletion, PreparedDietRecord } from "./types.js";

export class SqliteDietRecordsRepository implements DietRecordsRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async list(userId: number, date?: string) {
    const where = date ? "WHERE user_id = ? AND recorded_at = ?" : "WHERE user_id = ?";
    const params = date ? [userId, date] : [userId];
    return this.database.prepare(`SELECT * FROM diet_records ${where}
      ORDER BY CASE WHEN recorded_time IS NULL THEN 1 ELSE 0 END, recorded_time DESC, id DESC`).all(...params) as Array<Record<string, unknown>>;
  }

  async create(userId: number, record: PreparedDietRecord) {
    const result = this.database.prepare(`INSERT INTO diet_records
      (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, record.meal_type, record.food_name, record.amount,
      record.calories ?? null, record.protein ?? null, record.carbs ?? null, record.fat ?? null,
      record.recorded_at, record.recorded_time, record.image_url || null);
    return this.database.prepare("SELECT * FROM diet_records WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>;
  }

  async remove(userId: number, id: number) {
    return this.database.prepare("DELETE FROM diet_records WHERE id = ? AND user_id = ?").run(id, userId).changes === 1;
  }

  async completeCooking(userId: number, input: PreparedCookingCompletion) {
    return this.database.transaction(() => {
      const existing = this.database.prepare("SELECT result_json FROM cooking_completions WHERE user_id = ? AND idempotency_key = ?")
        .get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) return { ...JSON.parse(existing.result_json), repeated: true };
      const legacy = input.inventory_item_ids.map((id) => {
        const item = this.database.prepare(`SELECT id, version FROM inventory_items
          WHERE id = ? AND user_id = ? AND is_available = 1 AND deleted_at IS NULL`).get(id, userId) as { id: number; version: number } | undefined;
        if (!item) throw new InventoryQuantityError("INVENTORY_CONFLICT", "部分库存食材不存在、已用完或不属于当前账号");
        return { item_id: item.id, version: item.version, mode: "all" as const };
      });
      const consumptions = (input.inventory_consumptions.length ? input.inventory_consumptions : legacy) as InventoryConsumption[];
      const changes = consumptions.length ? applyInventoryConsumptions(this.database, userId, consumptions, {
        idempotencyKey: `cooking:${input.idempotency_key}`, source: "cooking", metadata: { recipeId: input.recipe_id ?? null },
      }) : [];
      const dietRecord = this.createSync(userId, input.diet_record);
      const consumedIds = consumptions.map((item) => item.item_id);
      const response = { diet_record: dietRecord, consumed_inventory_item_ids: consumedIds, inventory_consumption_changes: changes, repeated: false };
      this.database.prepare(`INSERT INTO cooking_completions
        (user_id, idempotency_key, recipe_id, diet_record_id, consumed_inventory_ids_json, result_json)
        VALUES (?, ?, ?, ?, ?, ?)`).run(userId, input.idempotency_key, input.recipe_id ?? null, dietRecord.id,
        JSON.stringify(consumedIds), JSON.stringify(response));
      return response;
    })();
  }

  private createSync(userId: number, record: PreparedDietRecord) {
    const result = this.database.prepare(`INSERT INTO diet_records
      (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, record.meal_type, record.food_name, record.amount,
      record.calories ?? null, record.protein ?? null, record.carbs ?? null, record.fat ?? null,
      record.recorded_at, record.recorded_time, record.image_url || null);
    return this.database.prepare("SELECT * FROM diet_records WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>;
  }
}
