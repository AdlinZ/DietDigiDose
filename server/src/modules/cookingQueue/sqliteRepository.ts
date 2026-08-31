import type Database from "better-sqlite3";
import type { CookingQueueRepository } from "./repository.js";
import type { QueueEnqueueData, QueuePatch, QueueRecipe, QueueRow } from "./types.js";

const activeStatuses = "'waiting', 'preparing', 'ready', 'cooking'";
const selectQueue = `
  SELECT q.*, r.title AS current_title, r.image_url AS current_image_url,
    r.cook_time AS current_cook_time, r.calories AS current_calories,
    r.difficulty AS current_difficulty, r.ingredients_json AS current_ingredients_json
  FROM cooking_queue_items q
  LEFT JOIN recipes r ON r.id = q.recipe_id AND r.deleted_at IS NULL AND r.status = 'approved'
`;

function jsonValue(value: unknown) {
  return typeof value === "string" || value === null || value === undefined ? value ?? null : JSON.stringify(value);
}

export class SqliteCookingQueueRepository implements CookingQueueRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async list(userId: number, includeHistory: boolean) {
    const where = includeHistory ? "q.user_id = ?" : `q.user_id = ? AND q.deleted_at IS NULL AND q.status IN (${activeStatuses})`;
    const order = includeHistory
      ? "CASE WHEN q.status IN ('waiting', 'preparing', 'ready', 'cooking') THEN 0 ELSE 1 END, q.position, q.updated_at DESC"
      : "q.position, q.created_at";
    return this.database.prepare(`${selectQueue} WHERE ${where} ORDER BY ${order}`).all(userId) as QueueRow[];
  }

  async findOwned(id: string, userId: number) {
    return (this.database.prepare(`${selectQueue} WHERE q.id = ? AND q.user_id = ?`).get(id, userId) as QueueRow | undefined) ?? null;
  }

  async findApprovedRecipe(recipeId: number) {
    return (this.database.prepare(`
      SELECT id, title, image_url, cook_time, calories, difficulty, ingredients_json
      FROM recipes WHERE id = ? AND deleted_at IS NULL AND status = 'approved'
    `).get(recipeId) as QueueRecipe | undefined) ?? null;
  }

  async enqueue(input: QueueEnqueueData, maximumActive: number) {
    return this.database.transaction(() => {
      const existingId = input.idempotencyKey
        ? (this.database.prepare("SELECT id FROM cooking_queue_items WHERE user_id = ? AND idempotency_key = ?")
          .get(input.userId, input.idempotencyKey) as { id: string } | undefined)?.id
        : undefined;
      const activeId = (this.database.prepare(`
        SELECT id FROM cooking_queue_items
        WHERE user_id = ? AND recipe_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
      `).get(input.userId, input.recipeId) as { id: string } | undefined)?.id;
      const foundId = existingId || activeId;
      if (foundId) {
        return { kind: "existing" as const, row: this.database.prepare(`${selectQueue} WHERE q.id = ? AND q.user_id = ?`).get(foundId, input.userId) as QueueRow };
      }
      const count = Number((this.database.prepare(`
        SELECT COUNT(*) AS count FROM cooking_queue_items
        WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
      `).get(input.userId) as { count: number }).count);
      if (count >= maximumActive) return { kind: "full" as const };
      const position = Number((this.database.prepare(`
        SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items
        WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
      `).get(input.userId) as { position: number }).position);
      this.database.prepare(`
        INSERT INTO cooking_queue_items
          (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, input.userId, input.recipeId, position, input.mealType ?? null, input.plannedAt ?? null,
        JSON.stringify(input.snapshot), input.idempotencyKey ?? null);
      return { kind: "created" as const, row: this.database.prepare(`${selectQueue} WHERE q.id = ? AND q.user_id = ?`).get(input.id, input.userId) as QueueRow };
    })();
  }

  async update(id: string, userId: number, version: number, patch: QueuePatch) {
    const result = this.database.prepare(`
      UPDATE cooking_queue_items SET status = ?, meal_type = ?, planned_at = ?, prepared_ingredients_json = ?,
        shopping_list_synced_at = ?, completed_at = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND version = ?
    `).run(patch.status, patch.mealType ?? null, patch.plannedAt ?? null, jsonValue(patch.preparedIngredients),
      patch.shoppingListSyncedAt ?? null, patch.completedAt ?? null, id, userId, version);
    if (result.changes !== 1) return null;
    return this.database.prepare(`${selectQueue} WHERE q.id = ? AND q.user_id = ?`).get(id, userId) as QueueRow;
  }

  async reorder(userId: number, items: Array<{ id: string; version: number }>) {
    try {
      this.database.transaction(() => {
        const active = this.database.prepare(`SELECT id, version FROM cooking_queue_items
          WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})`).all(userId) as Array<{ id: string; version: number }>;
        if (active.length !== items.length) throw new Error("VERSION_CONFLICT");
        const versions = new Map(active.map((item) => [item.id, item.version]));
        const update = this.database.prepare(`UPDATE cooking_queue_items SET position = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL AND status IN (${activeStatuses})`);
        items.forEach((item, index) => {
          if (versions.get(item.id) !== item.version || update.run(index, item.id, userId, item.version).changes !== 1) {
            throw new Error("VERSION_CONFLICT");
          }
        });
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") return null;
      throw error;
    }
    return this.database.prepare(`${selectQueue} WHERE q.user_id = ? AND q.deleted_at IS NULL
      AND q.status IN (${activeStatuses}) ORDER BY q.position, q.created_at`).all(userId) as QueueRow[];
  }

  async transition(id: string, userId: number, version: number, status: "cooking" | "completed") {
    const result = status === "cooking"
      ? this.database.prepare(`UPDATE cooking_queue_items SET status = 'cooking', planned_at = NULL,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`).run(id, userId, version)
      : this.database.prepare(`UPDATE cooking_queue_items SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`).run(id, userId, version);
    if (result.changes !== 1) return null;
    return this.database.prepare(`${selectQueue} WHERE q.id = ? AND q.user_id = ?`).get(id, userId) as QueueRow;
  }

  async cancel(id: string, userId: number) {
    return this.database.prepare(`UPDATE cooking_queue_items SET status = 'cancelled', version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})`).run(id, userId).changes === 1;
  }

  async cancelAll(userId: number) {
    return this.database.prepare(`UPDATE cooking_queue_items SET status = 'cancelled', version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})`).run(userId).changes;
  }
}
