import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { formatMealPlan, formatMealPlanItem, ingredient, normalizedName, parseJson, queueMealType, type Row } from "./formatters.js";
import type { MealPlansRepository } from "./repository.js";
import type { MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput, MealPlanUpdateInput } from "./types.js";

const activeQueueStatuses = "'waiting', 'preparing', 'ready', 'cooking'";
const itemSelect = `SELECT i.*, r.title AS recipe_title, r.image_url AS recipe_image_url,
  r.cook_time AS recipe_cook_time, r.difficulty AS recipe_difficulty,
  r.status AS recipe_status, r.deleted_at AS recipe_deleted_at
  FROM meal_plan_items i LEFT JOIN recipes r ON r.id = i.recipe_id`;

export class PostgresMealPlansRepository implements MealPlansRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  async list(userId: number, includeArchived: boolean) {
    const result = await this.pool.query(`SELECT * FROM meal_plans WHERE user_id = $1${includeArchived ? "" : " AND deleted_at IS NULL"}
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, start_date DESC, created_at DESC`, [userId]);
    return Promise.all((result.rows as Row[]).map((row) => this.formatPlan(this.pool, row, userId)));
  }

  async find(userId: number, id: string, includeArchived: boolean) {
    const row = await this.getPlan(this.pool, id, userId, includeArchived);
    return row ? this.formatPlan(this.pool, row, userId) : null;
  }

  async updatePlan(userId: number, id: string, input: MealPlanUpdateInput) {
    const current = await this.getPlan(this.pool, id, userId, false);
    if (!current) return { kind: "not_found" as const };
    const startDate = input.startDate ?? String(current.start_date);
    const endDate = input.endDate ?? String(current.end_date);
    if (startDate > endDate) return { kind: "invalid_date_range" as const };
    const changed = await this.pool.query(`UPDATE meal_plans SET title = $1, start_date = $2, end_date = $3, status = $4,
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND user_id = $6 AND version = $7 AND deleted_at IS NULL`,
    [input.title ?? current.title, startDate, endDate, input.status ?? current.status, id, userId, input.version]);
    if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
    return { kind: "updated" as const, value: await this.formatPlan(this.pool, (await this.getPlan(this.pool, id, userId, false))!, userId) };
  }

  async removePlan(userId: number, id: string, version: number) {
    const changed = await this.pool.query(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled',
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND version = $3 AND deleted_at IS NULL`,
    [id, userId, version]);
    if (changed.rowCount === 1) return "removed" as const;
    return await this.getPlan(this.pool, id, userId, false) ? "version_conflict" as const : "not_found" as const;
  }

  async updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput) {
    const current = await this.getItem(this.pool, planId, itemId, userId);
    if (!current) return { kind: "not_found" as const };
    let replacement: Row | undefined;
    if (input.recipeId !== undefined && input.recipeId !== null) {
      const selected = await this.pool.query(`SELECT id, title, ingredients_json, steps_json, calories, protein, carbs, fat
        FROM recipes WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL`, [input.recipeId]);
      replacement = selected.rows[0] as Row | undefined;
      if (!replacement) return { kind: "recipe_not_available" as const };
    }
    const changed = await this.pool.query(`UPDATE meal_plan_items SET planned_date = $1, meal_type = $2, recipe_id = $3, title = $4,
      ingredients_json = $5::jsonb, steps_json = $6::jsonb, calories = $7, protein = $8, carbs = $9, fat = $10, status = $11,
      queue_item_id = CASE WHEN $12::boolean THEN NULL ELSE queue_item_id END,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $13 AND plan_id = $14 AND user_id = $15 AND version = $16 AND deleted_at IS NULL`, [
      input.plannedDate ?? current.planned_date, input.mealType ?? current.meal_type,
      input.recipeId === undefined ? current.recipe_id : input.recipeId,
      replacement?.title ?? current.title, JSON.stringify(replacement?.ingredients_json ?? current.ingredients_json),
      JSON.stringify(replacement?.steps_json ?? current.steps_json), replacement?.calories ?? current.calories,
      replacement?.protein ?? current.protein, replacement?.carbs ?? current.carbs, replacement?.fat ?? current.fat,
      input.status ?? current.status, input.recipeId !== undefined, itemId, planId, userId, input.version,
    ]);
    if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
    return { kind: "updated" as const, value: formatMealPlanItem((await this.getItem(this.pool, planId, itemId, userId))!) };
  }

  addShopping(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.transaction(async (client) => {
      await this.lockExecution(client, userId, input.idempotencyKey);
      const repeated = await this.repeated(client, userId, input.idempotencyKey);
      if (repeated) return { kind: "completed" as const, value: repeated };
      const item = await this.getItem(client, planId, itemId, userId, true);
      if (!item) return { kind: "not_found" as const };
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      const ingredients = parseJson<unknown[]>(item.ingredients_json, []).map(ingredient)
        .filter((entry): entry is { name: string; amount: string } => Boolean(entry?.name));
      const stock = (await client.query(`SELECT food_name FROM inventory_items
        WHERE user_id = $1 AND is_available = TRUE AND deleted_at IS NULL`, [userId])).rows
        .map((row) => normalizedName(String(row.food_name)));
      const shopping = (await client.query(`SELECT name FROM shopping_list_items
        WHERE user_id = $1 AND checked = FALSE AND deleted_at IS NULL`, [userId])).rows
        .map((row) => normalizedName(String(row.name)));
      const missing = ingredients.filter((entry) => {
        const name = normalizedName(entry.name);
        return name && !stock.some((owned) => owned.includes(name) || name.includes(owned))
          && !shopping.some((saved) => saved.includes(name) || name.includes(saved));
      });
      const itemIds: string[] = [];
      for (const entry of missing) {
        const id = randomUUID();
        const inserted = await client.query(`INSERT INTO shopping_list_items (id, user_id, client_id, name, amount, category)
          VALUES ($1, $2, $3, $4, $5, '餐单') ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id`,
        [id, userId, `meal-plan:${itemId}:${normalizedName(entry.name)}`.slice(0, 120), entry.name.slice(0, 120), entry.amount.slice(0, 80)]);
        if (inserted.rowCount === 1) itemIds.push(id);
      }
      const value = { added: itemIds.length, itemIds, repeated: false };
      await this.saveExecution(client, userId, input.idempotencyKey, "shopping", itemId, value);
      return { kind: "completed" as const, value };
    });
  }

  enqueue(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.transaction(async (client) => {
      await this.lockExecution(client, userId, input.idempotencyKey);
      const repeated = await this.repeated(client, userId, input.idempotencyKey);
      if (repeated) return { kind: "completed" as const, value: repeated };
      const item = await this.getItem(client, planId, itemId, userId, true);
      if (!item) return { kind: "not_found" as const };
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      if (!item.recipe_id || item.recipe_status !== "approved" || item.recipe_deleted_at) return { kind: "recipe_unavailable" as const };
      await client.query("SELECT pg_advisory_xact_lock(9471, $1::integer)", [userId]);
      const existing = await client.query(`SELECT id FROM cooking_queue_items WHERE user_id = $1 AND recipe_id = $2
        AND deleted_at IS NULL AND status IN (${activeQueueStatuses})`, [userId, item.recipe_id]);
      let queueItemId = existing.rows[0]?.id as string | undefined;
      let added = false;
      if (!queueItemId) {
        const count = Number((await client.query(`SELECT COUNT(*)::integer AS count FROM cooking_queue_items WHERE user_id = $1
          AND deleted_at IS NULL AND status IN (${activeQueueStatuses})`, [userId])).rows[0]!.count);
        if (count >= 30) return { kind: "queue_full" as const };
        const position = Number((await client.query(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items WHERE user_id = $1
          AND deleted_at IS NULL AND status IN (${activeQueueStatuses})`, [userId])).rows[0]!.position);
        queueItemId = randomUUID();
        await client.query(`INSERT INTO cooking_queue_items
          (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`, [queueItemId, userId, item.recipe_id, position,
          queueMealType(item.meal_type), null, JSON.stringify({
            title: item.recipe_title || item.title, imageUrl: item.recipe_image_url || null,
            cookTime: item.recipe_cook_time || 0, difficulty: item.recipe_difficulty || "难度未知",
            ingredients: parseJson(item.ingredients_json, []),
          }), `meal-plan:${itemId}`]);
        added = true;
      }
      const changed = await client.query(`UPDATE meal_plan_items SET queue_item_id = $1, status = 'queued', version = version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND version = $4`, [queueItemId, itemId, userId, input.version]);
      if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
      const value = { queueItemId, added, repeated: false };
      await this.saveExecution(client, userId, input.idempotencyKey, "queue", itemId, value);
      return { kind: "completed" as const, value };
    });
  }

  complete(userId: number, planId: string, itemId: string, input: MealPlanCompleteInput) {
    return this.transaction(async (client) => {
      await this.lockExecution(client, userId, input.idempotencyKey);
      const repeated = await this.repeated(client, userId, input.idempotencyKey);
      if (repeated) return { kind: "completed" as const, value: repeated };
      const item = await this.getItem(client, planId, itemId, userId, true);
      if (!item) return { kind: "not_found" as const };
      if (item.status === "completed" && item.diet_record_id) {
        return { kind: "completed" as const, value: { dietRecordId: Number(item.diet_record_id), repeated: true } };
      }
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      let dietRecordId = input.dietRecordId;
      if (dietRecordId) {
        const record = await client.query("SELECT id FROM diet_records WHERE id = $1 AND user_id = $2", [dietRecordId, userId]);
        if (!record.rows[0]) return { kind: "diet_record_not_found" as const };
      } else {
        const inserted = await client.query(`INSERT INTO diet_records
          (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
          VALUES ($1, $2, $3, '1份', $4, $5, $6, $7, $8, $9) RETURNING id`, [userId, item.meal_type,
          item.recipe_title || item.title, item.calories, item.protein, item.carbs, item.fat, item.planned_date,
          item.planned_date === currentDateKey() ? currentTimeKey() : null]);
        dietRecordId = Number(inserted.rows[0]!.id);
      }
      const changed = await client.query(`UPDATE meal_plan_items SET status = 'completed', diet_record_id = $1, completed_at = CURRENT_TIMESTAMP,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND version = $4`,
      [dietRecordId, itemId, userId, input.version]);
      if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
      const value = { dietRecordId, repeated: false };
      await this.saveExecution(client, userId, input.idempotencyKey, "complete", itemId, value);
      return { kind: "completed" as const, value };
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async getPlan(client: Pool | PoolClient, id: string, userId: number, includeArchived: boolean) {
    const result = await client.query(`SELECT * FROM meal_plans WHERE id = $1 AND user_id = $2${includeArchived ? "" : " AND deleted_at IS NULL"}`,
      [id, userId]);
    return result.rows[0] as Row | undefined;
  }

  private async getItem(client: Pool | PoolClient, planId: string, itemId: string, userId: number, lock = false) {
    const result = await client.query(`${itemSelect} WHERE i.id = $1 AND i.plan_id = $2 AND i.user_id = $3 AND i.deleted_at IS NULL${lock ? " FOR UPDATE OF i" : ""}`,
      [itemId, planId, userId]);
    return result.rows[0] as Row | undefined;
  }

  private async getItems(client: Pool | PoolClient, planId: string, userId: number) {
    const result = await client.query(`${itemSelect} WHERE i.plan_id = $1 AND i.user_id = $2 AND i.deleted_at IS NULL
      ORDER BY i.planned_date, CASE i.meal_type WHEN '早餐' THEN 0 WHEN '午餐' THEN 1 WHEN '晚餐' THEN 2 ELSE 3 END, i.id`,
    [planId, userId]);
    return (result.rows as Row[]).map(formatMealPlanItem);
  }

  private async formatPlan(client: Pool | PoolClient, row: Row, userId: number) {
    return formatMealPlan(row, await this.getItems(client, String(row.id), userId));
  }

  private lockExecution(client: PoolClient, userId: number, key: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`meal-plan:${userId}:${key}`]);
  }

  private async repeated(client: PoolClient, userId: number, key: string) {
    const result = await client.query("SELECT result_json FROM meal_plan_execution_requests WHERE user_id = $1 AND idempotency_key = $2", [userId, key]);
    return result.rows[0] ? { ...(result.rows[0].result_json as Record<string, unknown>), repeated: true } : null;
  }

  private saveExecution(client: PoolClient, userId: number, key: string, action: string, itemId: string, result: unknown) {
    return client.query(`INSERT INTO meal_plan_execution_requests
      (user_id, idempotency_key, action, meal_plan_item_id, result_json) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, key, action, itemId, JSON.stringify(result)]);
  }
}
