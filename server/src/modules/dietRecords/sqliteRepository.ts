import { randomUUID } from "node:crypto";
import type { PreparedMealEventInput } from "@dietdigidose/contracts";
import { formatPreparedMeal, mealConsumptionRecord, transitionMeal, roundServings, undoMealIntake } from "./preparedMeals.js";
import type Database from "better-sqlite3";
import { applyInventoryConsumptions, InventoryQuantityError, type InventoryConsumption } from "../../services/inventoryQuantity.js";
import type { DietRecordsRepository } from "./repository.js";
import type { PreparedCookingCompletion, PreparedDietRecord } from "./types.js";

export class SqliteDietRecordsRepository implements DietRecordsRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async recordFunnelEvent(eventName: string, actorHash: string) {
    this.database.prepare("INSERT INTO funnel_events (event_name,actor_hash) VALUES (?,?)").run(eventName, actorHash);
  }

  async list(userId: number, date?: string) {
    const where = date ? "WHERE user_id = ? AND recorded_at = ?" : "WHERE user_id = ?";
    const params = date ? [userId, date] : [userId];
    return this.database.prepare(`SELECT *, (SELECT prepared_meal_id FROM prepared_meal_events WHERE diet_record_id=diet_records.id AND user_id=diet_records.user_id LIMIT 1) AS prepared_meal_id FROM diet_records ${where}
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

  async remove(userId: number, id: number, mode?: "undo_eating" | "delete_intake") {
    return this.database.transaction(() => {
      const correction = this.database.prepare("SELECT mode FROM prepared_meal_intake_corrections WHERE user_id=? AND original_diet_record_id=?").get(userId, id) as { mode: string } | undefined;
      if (correction) {
        if (correction.mode !== mode) throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT", "该记录已按另一种方式处理");
        return true;
      }
      const event = this.database.prepare("SELECT * FROM prepared_meal_events WHERE user_id=? AND diet_record_id=? AND event_type='eat'").get(userId, id) as { id: string; prepared_meal_id: string; servings: number; result_json: string } | undefined;
      if (event) {
        if (!mode) throw new InventoryQuantityError("PREPARED_MEAL_DELETE_MODE_REQUIRED", "此记录关联待吃餐，请选择撤销误记食用或仅删除摄入记录");
        const row = this.database.prepare("SELECT * FROM prepared_meals WHERE id=? AND user_id=?").get(event.prepared_meal_id, userId) as Record<string, unknown>;
        const meal = formatPreparedMeal(row);
        const next = mode === "undo_eating" ? undoMealIntake(meal, event) : meal;
        if (mode === "undo_eating") {
          const changed = this.database.prepare("UPDATE prepared_meals SET remaining_servings=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=?")
            .run(next.remaining_servings, meal.id, userId, meal.version);
          if (changed.changes !== 1) throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT", "餐食已变化，请刷新后重试");
        }
        this.database.prepare("INSERT INTO prepared_meal_intake_corrections(id,user_id,event_id,original_diet_record_id,mode,result_json) VALUES(?,?,?,?,?,?)")
          .run(randomUUID(), userId, event.id, id, mode, JSON.stringify({ prepared_meal: next, original_event: event.id, original_diet_record_id: id, mode }));
      } else if (mode === "undo_eating") {
        throw new InventoryQuantityError("PREPARED_MEAL_NOT_FOUND", "此记录没有可撤销的关联食用");
      }
      return this.database.prepare("DELETE FROM diet_records WHERE id = ? AND user_id = ?").run(id, userId).changes === 1;
    })();
  }

  async completeCooking(userId: number, input: PreparedCookingCompletion) {
    return this.completeCookingInTransaction(userId, input);
  }

  completeCookingInTransaction(userId: number, input: PreparedCookingCompletion) {
    return this.database.transaction(() => {
      const existing = this.database.prepare("SELECT result_json FROM cooking_completions WHERE user_id = ? AND idempotency_key = ?")
        .get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) return { ...JSON.parse(existing.result_json), repeated: true };
      const produced = this.database.prepare("SELECT result_json FROM prepared_meals WHERE user_id=? AND idempotency_key=?")
        .get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (produced) return { ...JSON.parse(produced.result_json), repeated: true };
      if (input.production) {
        const repeated = this.productionBefore(userId, input);
        if (repeated) return repeated;
      }
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
      const consumedIds = consumptions.map((item) => item.item_id);
      if (input.production) return this.saveProduction(userId, input, consumedIds, changes);
      if (!input.diet_record) throw new Error("缺少饮食记录或制作分配");
      const dietRecord = this.createSync(userId, input.diet_record);
      const response = { diet_record: dietRecord, consumed_inventory_item_ids: consumedIds, inventory_consumption_changes: changes, repeated: false };
      this.database.prepare(`INSERT INTO cooking_completions
        (user_id, idempotency_key, recipe_id, diet_record_id, consumed_inventory_ids_json, result_json)
        VALUES (?, ?, ?, ?, ?, ?)`).run(userId, input.idempotency_key, input.recipe_id ?? null, dietRecord.id,
        JSON.stringify(consumedIds), JSON.stringify(response));
      return response;
    })();
  }

  async listPreparedMeals(userId: number) {
    return (this.database.prepare("SELECT * FROM prepared_meals WHERE user_id=? ORDER BY produced_at DESC,id DESC").all(userId) as Record<string, unknown>[]).map(formatPreparedMeal);
  }

  async applyMealEvent(userId: number, mealId: string, input: PreparedMealEventInput) {
    return this.applyMealEventInTransaction(userId, mealId, input);
  }

  applyMealEventInTransaction(userId: number, mealId: string, input: PreparedMealEventInput) {
    return this.database.transaction(() => {
      const existing = this.database.prepare("SELECT prepared_meal_id,result_json FROM prepared_meal_events WHERE user_id=? AND idempotency_key=?").get(userId, input.idempotency_key) as { prepared_meal_id: string; result_json: string } | undefined;
      if (existing) {
        if (existing.prepared_meal_id !== mealId) throw new InventoryQuantityError("PREPARED_MEAL_KEY_CONFLICT", "该操作编号已用于另一份待吃餐");
        return { ...JSON.parse(existing.result_json), repeated: true };
      }
      const row = this.database.prepare("SELECT * FROM prepared_meals WHERE id=? AND user_id=?").get(mealId, userId) as Record<string, unknown> | undefined;
      if (!row) throw new InventoryQuantityError("PREPARED_MEAL_NOT_FOUND", "待吃餐不存在或不属于当前账号");
      const meal = formatPreparedMeal(row);
      const next = transitionMeal(meal, input);
      const record = input.type === "eat" ? this.createSync(userId, mealConsumptionRecord({ ...meal, meal_type: input.meal_type ?? meal.meal_type }, input.servings!, input.recorded_at!, input.recorded_time ?? null)) : null;
      const changed = this.database.prepare("UPDATE prepared_meals SET is_reserved=?,remaining_servings=?,planned_date=?,meal_type=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=?")
        .run(Number(next.is_reserved), next.remaining_servings, next.planned_date, next.meal_type, mealId, userId, input.version);
      if (changed.changes !== 1) throw new InventoryQuantityError("PREPARED_MEAL_VERSION_CONFLICT", "待吃餐已变化，请刷新后重试");
      const result = { prepared_meal: next, diet_record: record, repeated: false };
      this.database.prepare("INSERT INTO prepared_meal_events(id,user_id,prepared_meal_id,idempotency_key,event_type,servings,recorded_at,diet_record_id,result_json) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), userId, mealId, input.idempotency_key, input.type, input.servings ?? null, input.recorded_at!, record?.id ?? null, JSON.stringify(result));
      return result;
    })();
  }

  private productionBefore(userId: number, input: PreparedCookingCompletion) {
    const production = input.production!;
    if (production.queue_item_id) {
      const plan = this.database.prepare("SELECT id,version FROM meal_plan_items WHERE user_id=? AND queue_item_id=?").get(userId, production.queue_item_id) as { id: string; version: number } | undefined;
      if (plan) {
        if (production.plan_item_id && production.plan_item_id !== plan.id) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "制作队列与餐单不一致");
        production.plan_item_id = plan.id;
        production.plan_version ??= plan.version;
      }
    }
    if (production.plan_item_id && !production.queue_item_id) {
      const plan = this.database.prepare("SELECT queue_item_id FROM meal_plan_items WHERE id=? AND user_id=?").get(production.plan_item_id, userId) as { queue_item_id: string | null } | undefined;
      if (plan?.queue_item_id) {
        const queue = this.database.prepare("SELECT version FROM cooking_queue_items WHERE id=? AND user_id=?").get(plan.queue_item_id, userId) as { version: number } | undefined;
        if (queue) { production.queue_item_id = plan.queue_item_id; production.queue_version = queue.version; }
      }
    }
    const existing = this.database.prepare("SELECT result_json FROM prepared_meals WHERE user_id=? AND (idempotency_key=? OR queue_item_id=? OR plan_item_id=?)")
      .get(userId, input.idempotency_key, production.queue_item_id ?? null, production.plan_item_id ?? null) as { result_json: string } | undefined;
    if (existing) return { ...JSON.parse(existing.result_json), repeated: true };
    if (production.queue_item_id) {
      const row = this.database.prepare("SELECT version,status,recipe_id FROM cooking_queue_items WHERE id=? AND user_id=? AND deleted_at IS NULL").get(production.queue_item_id, userId) as Record<string, unknown> | undefined;
      if (!row || row.version !== production.queue_version || ["completed", "cancelled"].includes(String(row.status)) || (input.recipe_id && Number(row.recipe_id) !== input.recipe_id)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "制作队列已变化，请刷新后重试");
    }
    if (production.plan_item_id) {
      const row = this.database.prepare("SELECT i.version,i.status,i.recipe_id FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.id=? AND i.user_id=? AND i.deleted_at IS NULL AND p.deleted_at IS NULL").get(production.plan_item_id, userId) as Record<string, unknown> | undefined;
      if (!row || row.version !== production.plan_version || ["completed", "skipped"].includes(String(row.status)) || (input.recipe_id && Number(row.recipe_id) !== input.recipe_id)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "餐次已变化，请刷新后重试");
    }
    return null;
  }

  private saveProduction(userId: number, input: PreparedCookingCompletion, consumedIds: number[], changes: unknown[]) {
    const production = input.production!;
    const id = randomUUID();
    this.database.prepare(`INSERT INTO prepared_meals(id,user_id,idempotency_key,recipe_id,food_name,produced_servings,remaining_servings,nutrition_per_serving_json,planned_date,meal_type,storage_location,queue_item_id,plan_item_id,reported_cooking_minutes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, input.idempotency_key, input.recipe_id ?? null, production.food_name, production.produced_servings,
        roundServings(production.produced_servings - production.eaten_servings), JSON.stringify(production.nutrition_per_serving), production.planned_date ?? null,
        production.meal_type, production.storage_location ?? null, production.queue_item_id ?? null, production.plan_item_id ?? null,production.reported_cooking_minutes ?? null);
    const meal = formatPreparedMeal(this.database.prepare("SELECT * FROM prepared_meals WHERE id=?").get(id) as Record<string, unknown>);
    const record = production.eaten_servings > 0 ? this.createSync(userId, mealConsumptionRecord(meal, production.eaten_servings, production.eaten_at!, production.eaten_time ?? null)) : null;
    const response = { prepared_meal: meal, diet_record: record, consumed_inventory_item_ids: consumedIds, inventory_consumption_changes: changes, repeated: false };
    this.database.prepare("UPDATE prepared_meals SET result_json=? WHERE id=?").run(JSON.stringify(response), id);
    if (record) this.database.prepare("INSERT INTO prepared_meal_events(id,user_id,prepared_meal_id,idempotency_key,event_type,servings,recorded_at,diet_record_id,result_json) VALUES(?,?,?,?,'eat',?,?,?,?)")
      .run(randomUUID(), userId, id, `production:${id}`, production.eaten_servings, production.eaten_at!, record.id, JSON.stringify(response));
    if (production.queue_item_id) this.database.prepare("UPDATE cooking_queue_items SET status='completed',completed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(production.queue_item_id, userId);
    if (production.plan_item_id) this.database.prepare("UPDATE meal_plan_items SET status='completed',completed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(production.plan_item_id, userId);
    return response;
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
