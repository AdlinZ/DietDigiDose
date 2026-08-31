import type { Pool, PoolClient } from "pg";
import type { InventoryConsumptionData, InventoryConsumptionResponse } from "@dietdigidose/contracts";
import { InventoryQuantityError, type InventoryConsumption } from "../../services/inventoryQuantity.js";
import type { DietRecordsRepository } from "./repository.js";
import type { PreparedCookingCompletion, PreparedDietRecord } from "./types.js";

async function insertRecord(client: Pool | PoolClient, userId: number, record: PreparedDietRecord) {
  const result = await client.query(`INSERT INTO diet_records
    (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, image_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`, [userId, record.meal_type,
    record.food_name, record.amount, record.calories ?? null, record.protein ?? null, record.carbs ?? null,
    record.fat ?? null, record.recorded_at, record.recorded_time, record.image_url || null]);
  return result.rows[0] as Record<string, unknown>;
}

export type PostgresInventoryConsumer = (
  client: PoolClient,
  userId: number,
  input: InventoryConsumptionData,
) => Promise<InventoryConsumptionResponse>;

export class PostgresDietRecordsRepository implements DietRecordsRepository {
  private readonly pool: Pool;
  private readonly consumeInventory: PostgresInventoryConsumer;

  constructor(pool: Pool, consumeInventory: PostgresInventoryConsumer) {
    this.pool = pool;
    this.consumeInventory = consumeInventory;
  }

  async list(userId: number, date?: string) {
    const result = date
      ? await this.pool.query(`SELECT * FROM diet_records WHERE user_id = $1 AND recorded_at = $2
          ORDER BY CASE WHEN recorded_time IS NULL THEN 1 ELSE 0 END, recorded_time DESC, id DESC`, [userId, date])
      : await this.pool.query(`SELECT * FROM diet_records WHERE user_id = $1
          ORDER BY CASE WHEN recorded_time IS NULL THEN 1 ELSE 0 END, recorded_time DESC, id DESC`, [userId]);
    return result.rows as Array<Record<string, unknown>>;
  }

  create(userId: number, record: PreparedDietRecord) { return insertRecord(this.pool, userId, record); }

  async remove(userId: number, id: number) {
    return (await this.pool.query("DELETE FROM diet_records WHERE id = $1 AND user_id = $2", [id, userId])).rowCount === 1;
  }

  async completeCooking(userId: number, input: PreparedCookingCompletion) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`diet:cooking:${userId}:${input.idempotency_key}`]);
      const existing = await client.query("SELECT result_json FROM cooking_completions WHERE user_id = $1 AND idempotency_key = $2",
        [userId, input.idempotency_key]);
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { ...existing.rows[0].result_json, repeated: true };
      }
      const legacy: InventoryConsumption[] = [];
      for (const id of input.inventory_item_ids) {
        const selected = await client.query(`SELECT id, version FROM inventory_items
          WHERE id = $1 AND user_id = $2 AND is_available = TRUE AND deleted_at IS NULL`, [id, userId]);
        if (!selected.rows[0]) throw new InventoryQuantityError("INVENTORY_CONFLICT", "部分库存食材不存在、已用完或不属于当前账号");
        legacy.push({ item_id: Number(selected.rows[0].id), version: Number(selected.rows[0].version), mode: "all" });
      }
      const consumptions = input.inventory_consumptions.length ? input.inventory_consumptions : legacy;
      const inventoryResult = consumptions.length ? await this.consumeInventory(client, userId, {
        idempotency_key: `cooking:${input.idempotency_key}`, source: "cooking", items: consumptions,
      }) : { changes: [], items: [], repeated: false };
      const dietRecord = await insertRecord(client, userId, input.diet_record);
      const consumedIds = consumptions.map((item) => item.item_id);
      const response = {
        diet_record: dietRecord,
        consumed_inventory_item_ids: consumedIds,
        inventory_consumption_changes: inventoryResult.changes,
        repeated: false,
      };
      await client.query(`INSERT INTO cooking_completions
        (user_id, idempotency_key, recipe_id, diet_record_id, consumed_inventory_ids_json, result_json)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`, [userId, input.idempotency_key, input.recipe_id ?? null,
        dietRecord.id, JSON.stringify(consumedIds), JSON.stringify(response)]);
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
