import { appendPostgresMaintenanceEvent } from "../planMaintenance/postgresEventWriter.js";
import { randomUUID } from "node:crypto";
import type { PreparedMealEventInput } from "@dietdigidose/contracts";
import { formatPreparedMeal, mealConsumptionRecord, transitionMeal, roundServings, undoMealIntake } from "./preparedMeals.js";
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

  async recordFunnelEvent(eventName: string, actorHash: string) {
    await this.pool.query("INSERT INTO funnel_events (event_name,actor_hash) VALUES ($1,$2)", [eventName, actorHash]);
  }

  async list(userId: number, date?: string) {
    const result = date
      ? await this.pool.query(`SELECT *, (SELECT prepared_meal_id FROM prepared_meal_events WHERE diet_record_id=diet_records.id AND user_id=diet_records.user_id LIMIT 1) AS prepared_meal_id FROM diet_records WHERE user_id = $1 AND recorded_at = $2
          ORDER BY CASE WHEN recorded_time IS NULL THEN 1 ELSE 0 END, recorded_time DESC, id DESC`, [userId, date])
      : await this.pool.query(`SELECT *, (SELECT prepared_meal_id FROM prepared_meal_events WHERE diet_record_id=diet_records.id AND user_id=diet_records.user_id LIMIT 1) AS prepared_meal_id FROM diet_records WHERE user_id = $1
          ORDER BY CASE WHEN recorded_time IS NULL THEN 1 ELSE 0 END, recorded_time DESC, id DESC`, [userId]);
    return result.rows as Array<Record<string, unknown>>;
  }

  create(userId: number, record: PreparedDietRecord) { return insertRecord(this.pool, userId, record); }

  async remove(userId: number, id: number, mode?: "undo_eating" | "delete_intake") {
    return this.transaction(async client => {
      // Same account lock as production and consumption, before reading event state.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prepared-meals:${userId}`]);
      const correction = (await client.query("SELECT mode FROM prepared_meal_intake_corrections WHERE user_id=$1 AND original_diet_record_id=$2", [userId, id])).rows[0];
      if (correction) {
        if (correction.mode !== mode) throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT", "该记录已按另一种方式处理");
        return true;
      }
      const event = (await client.query("SELECT * FROM prepared_meal_events WHERE user_id=$1 AND diet_record_id=$2 AND event_type='eat'", [userId, id])).rows[0];
      if (event) {
        if (!mode) throw new InventoryQuantityError("PREPARED_MEAL_DELETE_MODE_REQUIRED", "此记录关联待吃餐，请选择撤销误记食用或仅删除摄入记录");
        const row = (await client.query("SELECT * FROM prepared_meals WHERE id=$1 AND user_id=$2 FOR UPDATE", [event.prepared_meal_id, userId])).rows[0];
        const meal = formatPreparedMeal(row);
        const next = mode === "undo_eating" ? undoMealIntake(meal, event) : meal;
        if (mode === "undo_eating") {
          const changed = await client.query("UPDATE prepared_meals SET remaining_servings=$1,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND user_id=$3 AND version=$4", [next.remaining_servings, meal.id, userId, meal.version]);
          if (changed.rowCount !== 1) throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT", "餐食已变化，请刷新后重试");
        }
        await client.query("INSERT INTO prepared_meal_intake_corrections(id,user_id,event_id,original_diet_record_id,mode,result_json) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
          [randomUUID(), userId, event.id, id, mode, JSON.stringify({ prepared_meal: next, original_event: event.id, original_diet_record_id: id, mode })]);
        await appendPostgresMaintenanceEvent(client, { userId, kind: "intake_correction", sourceId: event.id,
          subjectId: meal.id, details: { mode, version: next.version, planItemId: meal.plan_item_id } });
      } else if (mode === "undo_eating") {
        throw new InventoryQuantityError("PREPARED_MEAL_NOT_FOUND", "此记录没有可撤销的关联食用");
      }
      return (await client.query("DELETE FROM diet_records WHERE id = $1 AND user_id = $2", [id, userId])).rowCount === 1;
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async completeCooking(userId: number, input: PreparedCookingCompletion) {
    return this.transaction(client => this.completeCookingWithClient(client, userId, input));
  }

  async completeCookingWithClient(client: PoolClient, userId: number, input: PreparedCookingCompletion) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`diet:cooking:${userId}:${input.idempotency_key}`]);
      const existing = await client.query("SELECT result_json FROM cooking_completions WHERE user_id = $1 AND idempotency_key = $2",
        [userId, input.idempotency_key]);
      if (existing.rows[0]) {
        return { ...existing.rows[0].result_json, repeated: true };
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prepared-meals:${userId}`]);
      const produced = (await client.query("SELECT result_json FROM prepared_meals WHERE user_id=$1 AND idempotency_key=$2", [userId, input.idempotency_key])).rows[0];
      if (produced) return { ...produced.result_json, repeated: true };
      if (input.production) {
        const repeated = await this.productionBefore(client, userId, input);
        if (repeated) return repeated;
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
      const consumedIds = consumptions.map((item) => item.item_id);
      if (input.production) return this.saveProduction(client, userId, input, consumedIds, inventoryResult.changes);
      if (!input.diet_record) throw new Error("缺少饮食记录或制作分配");
      const dietRecord = await insertRecord(client, userId, input.diet_record);
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
      await appendPostgresMaintenanceEvent(client, { userId, kind: "cooking_completion", sourceId: input.idempotency_key,
        subjectId: String(dietRecord.id), details: { inventoryItemIds: consumedIds } });
      return response;
  }

  async listPreparedMeals(userId: number) {
    return (await this.pool.query("SELECT * FROM prepared_meals WHERE user_id=$1 ORDER BY produced_at DESC,id DESC", [userId])).rows.map(formatPreparedMeal);
  }

  async applyMealEvent(userId: number, mealId: string, input: PreparedMealEventInput) {
    return this.transaction(client => this.applyMealEventWithClient(client, userId, mealId, input));
  }

  async applyMealEventWithClient(client: PoolClient, userId: number, mealId: string, input: PreparedMealEventInput) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prepared-meals:${userId}`]);
    const existing = (await client.query("SELECT prepared_meal_id,result_json FROM prepared_meal_events WHERE user_id=$1 AND idempotency_key=$2", [userId, input.idempotency_key])).rows[0];
    if (existing) {
      if (existing.prepared_meal_id !== mealId) throw new InventoryQuantityError("PREPARED_MEAL_KEY_CONFLICT", "该操作编号已用于另一份待吃餐");
      return { ...existing.result_json, repeated: true };
    }
    const row = (await client.query("SELECT * FROM prepared_meals WHERE id=$1 AND user_id=$2 FOR UPDATE", [mealId, userId])).rows[0];
    if (!row) throw new InventoryQuantityError("PREPARED_MEAL_NOT_FOUND", "待吃餐不存在或不属于当前账号");
    const meal = formatPreparedMeal(row);
    const next = transitionMeal(meal, input);
    const record = input.type === "eat" ? await insertRecord(client, userId, mealConsumptionRecord({ ...meal, meal_type: input.meal_type ?? meal.meal_type }, input.servings!, input.recorded_at!, input.recorded_time ?? null)) : null;
    const changed = await client.query("UPDATE prepared_meals SET reported_cooking_minutes=$8,is_reserved=$7,remaining_servings=$1,planned_date=$2,meal_type=$3,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND user_id=$5 AND version=$6",
      [next.remaining_servings, next.planned_date, next.meal_type, mealId, userId, input.version, next.is_reserved,next.reported_cooking_minutes ?? null]);
    if (changed.rowCount !== 1) throw new InventoryQuantityError("PREPARED_MEAL_VERSION_CONFLICT", "待吃餐已变化，请刷新后重试");
    const result = { prepared_meal: next, diet_record: record, repeated: false };
    await client.query("INSERT INTO prepared_meal_events(id,user_id,prepared_meal_id,idempotency_key,event_type,servings,recorded_at,diet_record_id,result_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
      [randomUUID(), userId, mealId, input.idempotency_key, input.type, input.servings ?? null, input.recorded_at!, record?.id ?? null, JSON.stringify(result)]);
    await appendPostgresMaintenanceEvent(client, { userId, kind: input.type, sourceId: input.idempotency_key,
        subjectId: mealId, details: { version: next.version, planItemId: meal.plan_item_id } });
    return result;
  }

  private async productionBefore(client: PoolClient, userId: number, input: PreparedCookingCompletion) {
    const production = input.production!;
    if (production.queue_item_id) {
      const plan = (await client.query("SELECT id,version FROM meal_plan_items WHERE user_id=$1 AND queue_item_id=$2", [userId, production.queue_item_id])).rows[0];
      if (plan) {
        if (production.plan_item_id && production.plan_item_id !== plan.id) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "制作队列与餐单不一致");
        production.plan_item_id = plan.id;
        production.plan_version ??= Number(plan.version);
      }
    }
    if (production.plan_item_id && !production.queue_item_id) {
      const plan = (await client.query("SELECT queue_item_id FROM meal_plan_items WHERE id=$1 AND user_id=$2", [production.plan_item_id, userId])).rows[0];
      if (plan?.queue_item_id) {
        const queue = (await client.query("SELECT version FROM cooking_queue_items WHERE id=$1 AND user_id=$2", [plan.queue_item_id, userId])).rows[0];
        if (queue) { production.queue_item_id = plan.queue_item_id; production.queue_version = Number(queue.version); }
      }
    }
    const existing = (await client.query("SELECT result_json FROM prepared_meals WHERE user_id=$1 AND (idempotency_key=$2 OR queue_item_id=$3 OR plan_item_id=$4)",
      [userId, input.idempotency_key, production.queue_item_id ?? null, production.plan_item_id ?? null])).rows[0];
    if (existing) return { ...existing.result_json, repeated: true };
    if (production.queue_item_id) {
      const row = (await client.query("SELECT version,status,recipe_id FROM cooking_queue_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [production.queue_item_id, userId])).rows[0];
      if (!row || Number(row.version) !== production.queue_version || ["completed", "cancelled"].includes(row.status) || (input.recipe_id && Number(row.recipe_id) !== input.recipe_id)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "制作队列已变化，请刷新后重试");
    }
    if (production.plan_item_id) {
      const row = (await client.query("SELECT i.version,i.status,i.recipe_id FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.id=$1 AND i.user_id=$2 AND i.deleted_at IS NULL AND p.deleted_at IS NULL FOR UPDATE OF i", [production.plan_item_id, userId])).rows[0];
      if (!row || Number(row.version) !== production.plan_version || ["completed", "skipped"].includes(row.status) || (input.recipe_id && Number(row.recipe_id) !== input.recipe_id)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "餐次已变化，请刷新后重试");
    }
    return null;
  }

  private async saveProduction(client: PoolClient, userId: number, input: PreparedCookingCompletion, consumedIds: number[], changes: unknown[]) {
    const production = input.production!;
    const id = randomUUID();
    const inserted = await client.query(`INSERT INTO prepared_meals(id,user_id,idempotency_key,recipe_id,food_name,produced_servings,remaining_servings,nutrition_per_serving_json,planned_date,meal_type,storage_location,queue_item_id,plan_item_id,reported_cooking_minutes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14) RETURNING *`, [id, userId, input.idempotency_key, input.recipe_id ?? null, production.food_name, production.produced_servings,
        roundServings(production.produced_servings - production.eaten_servings), JSON.stringify(production.nutrition_per_serving), production.planned_date ?? null,
        production.meal_type, production.storage_location ?? null, production.queue_item_id ?? null, production.plan_item_id ?? null,production.reported_cooking_minutes ?? null]);
    const meal = formatPreparedMeal(inserted.rows[0]);
    const record = production.eaten_servings > 0 ? await insertRecord(client, userId, mealConsumptionRecord(meal, production.eaten_servings, production.eaten_at!, production.eaten_time ?? null)) : null;
    const response = { prepared_meal: meal, diet_record: record, consumed_inventory_item_ids: consumedIds, inventory_consumption_changes: changes, repeated: false };
    await client.query("UPDATE prepared_meals SET result_json=$1::jsonb WHERE id=$2", [JSON.stringify(response), id]);
    if (record) await client.query("INSERT INTO prepared_meal_events(id,user_id,prepared_meal_id,idempotency_key,event_type,servings,recorded_at,diet_record_id,result_json) VALUES($1,$2,$3,$4,'eat',$5,$6,$7,$8::jsonb)",
      [randomUUID(), userId, id, `production:${id}`, production.eaten_servings, production.eaten_at!, record.id, JSON.stringify(response)]);
    if (production.queue_item_id) await client.query("UPDATE cooking_queue_items SET status='completed',completed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2", [production.queue_item_id, userId]);
    if (production.plan_item_id) await client.query("UPDATE meal_plan_items SET status='completed',completed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2", [production.plan_item_id, userId]);
    await appendPostgresMaintenanceEvent(client, { userId, kind: "production", sourceId: id, subjectId: id,
      details: { version: meal.version, planItemId: production.plan_item_id ?? null, inventoryItemIds: consumedIds } });
    return response;
  }
}
