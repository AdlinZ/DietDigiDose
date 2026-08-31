import type { Pool, PoolClient } from "pg";
import type { CookingQueueRepository } from "./repository.js";
import type { QueueEnqueueData, QueuePatch, QueueRecipe, QueueRow } from "./types.js";

const active = "'waiting', 'preparing', 'ready', 'cooking'";
const selectQueue = `SELECT q.*, r.title AS current_title, r.image_url AS current_image_url,
  r.cook_time AS current_cook_time, r.calories AS current_calories,
  r.difficulty AS current_difficulty, r.ingredients_json AS current_ingredients_json
  FROM cooking_queue_items q LEFT JOIN recipes r
    ON r.id = q.recipe_id AND r.deleted_at IS NULL AND r.status = 'approved'`;
const json = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value ?? null);

async function owned(client: Pool | PoolClient, id: string, userId: number) {
  const result = await client.query(`${selectQueue} WHERE q.id = $1 AND q.user_id = $2`, [id, userId]);
  return (result.rows[0] as QueueRow | undefined) ?? null;
}

export class PostgresCookingQueueRepository implements CookingQueueRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async list(userId: number, includeHistory: boolean) {
    const where = includeHistory ? "q.user_id = $1" : `q.user_id = $1 AND q.deleted_at IS NULL AND q.status IN (${active})`;
    const order = includeHistory
      ? "CASE WHEN q.status IN ('waiting', 'preparing', 'ready', 'cooking') THEN 0 ELSE 1 END, q.position, q.updated_at DESC"
      : "q.position, q.created_at";
    return (await this.pool.query(`${selectQueue} WHERE ${where} ORDER BY ${order}`, [userId])).rows as QueueRow[];
  }

  findOwned(id: string, userId: number) { return owned(this.pool, id, userId); }

  async findApprovedRecipe(recipeId: number) {
    const result = await this.pool.query(`SELECT id, title, image_url, cook_time, calories, difficulty, ingredients_json
      FROM recipes WHERE id = $1 AND deleted_at IS NULL AND status = 'approved'`, [recipeId]);
    return (result.rows[0] as QueueRecipe | undefined) ?? null;
  }

  async enqueue(input: QueueEnqueueData, maximumActive: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(9471, $1::integer)", [input.userId]);
      let foundId: string | undefined;
      if (input.idempotencyKey) {
        foundId = (await client.query("SELECT id FROM cooking_queue_items WHERE user_id = $1 AND idempotency_key = $2",
          [input.userId, input.idempotencyKey])).rows[0]?.id;
      }
      if (!foundId) {
        foundId = (await client.query(`SELECT id FROM cooking_queue_items WHERE user_id = $1 AND recipe_id = $2
          AND deleted_at IS NULL AND status IN (${active})`, [input.userId, input.recipeId])).rows[0]?.id;
      }
      if (foundId) {
        const row = await owned(client, foundId, input.userId);
        await client.query("COMMIT");
        return { kind: "existing" as const, row: row! };
      }
      const count = Number((await client.query(`SELECT COUNT(*)::integer AS count FROM cooking_queue_items
        WHERE user_id = $1 AND deleted_at IS NULL AND status IN (${active})`, [input.userId])).rows[0]!.count);
      if (count >= maximumActive) {
        await client.query("COMMIT");
        return { kind: "full" as const };
      }
      const position = Number((await client.query(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items
        WHERE user_id = $1 AND deleted_at IS NULL AND status IN (${active})`, [input.userId])).rows[0]!.position);
      await client.query(`INSERT INTO cooking_queue_items
        (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`, [input.id, input.userId, input.recipeId, position,
        input.mealType ?? null, input.plannedAt ?? null, JSON.stringify(input.snapshot), input.idempotencyKey ?? null]);
      const row = await owned(client, input.id, input.userId);
      await client.query("COMMIT");
      return { kind: "created" as const, row: row! };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async update(id: string, userId: number, version: number, patch: QueuePatch) {
    const result = await this.pool.query(`UPDATE cooking_queue_items SET status = $1, meal_type = $2, planned_at = $3,
      prepared_ingredients_json = $4::jsonb, shopping_list_synced_at = $5, completed_at = $6,
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $7 AND user_id = $8 AND version = $9`,
    [patch.status, patch.mealType ?? null, patch.plannedAt ?? null, json(patch.preparedIngredients),
      patch.shoppingListSyncedAt ?? null, patch.completedAt ?? null, id, userId, version]);
    return result.rowCount === 1 ? owned(this.pool, id, userId) : null;
  }

  async reorder(userId: number, items: Array<{ id: string; version: number }>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(9471, $1::integer)", [userId]);
      const current = await client.query(`SELECT id, version FROM cooking_queue_items WHERE user_id = $1
        AND deleted_at IS NULL AND status IN (${active}) FOR UPDATE`, [userId]);
      if (current.rows.length !== items.length) { await client.query("ROLLBACK"); return null; }
      const versions = new Map(current.rows.map((row) => [String(row.id), Number(row.version)]));
      for (const [index, item] of items.entries()) {
        if (versions.get(item.id) !== item.version) { await client.query("ROLLBACK"); return null; }
        const updated = await client.query(`UPDATE cooking_queue_items SET position = $1, version = version + 1,
          updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND version = $4
          AND deleted_at IS NULL AND status IN (${active})`, [index, item.id, userId, item.version]);
        if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return null; }
      }
      await client.query("COMMIT");
      return (await client.query(`${selectQueue} WHERE q.user_id = $1 AND q.deleted_at IS NULL
        AND q.status IN (${active}) ORDER BY q.position, q.created_at`, [userId])).rows as QueueRow[];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async transition(id: string, userId: number, version: number, status: "cooking" | "completed") {
    const result = status === "cooking"
      ? await this.pool.query(`UPDATE cooking_queue_items SET status = 'cooking', planned_at = NULL,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND version = $3`, [id, userId, version])
      : await this.pool.query(`UPDATE cooking_queue_items SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND version = $3`, [id, userId, version]);
    return result.rowCount === 1 ? owned(this.pool, id, userId) : null;
  }

  async cancel(id: string, userId: number) {
    return (await this.pool.query(`UPDATE cooking_queue_items SET status = 'cancelled', version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND status IN (${active})`,
    [id, userId])).rowCount === 1;
  }

  async cancelAll(userId: number) {
    return (await this.pool.query(`UPDATE cooking_queue_items SET status = 'cancelled', version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND deleted_at IS NULL AND status IN (${active})`, [userId])).rowCount ?? 0;
  }
}
