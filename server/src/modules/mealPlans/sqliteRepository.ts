import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { formatMealPlan, formatMealPlanItem, ingredient, normalizedName, parseJson, queueMealType, type Row } from "./formatters.js";
import type { MealPlansRepository } from "./repository.js";
import type { MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput, MealPlanUpdateInput } from "./types.js";

const itemSelect = `SELECT i.*, r.title AS recipe_title, r.image_url AS recipe_image_url,
  r.cook_time AS recipe_cook_time, r.difficulty AS recipe_difficulty,
  r.status AS recipe_status, r.deleted_at AS recipe_deleted_at
  FROM meal_plan_items i LEFT JOIN recipes r ON r.id = i.recipe_id`;

export class SqliteMealPlansRepository implements MealPlansRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }

  async list(userId: number, includeArchived: boolean) {
    const rows = this.database.prepare(`SELECT * FROM meal_plans WHERE user_id = ?${includeArchived ? "" : " AND deleted_at IS NULL"}
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, start_date DESC, created_at DESC`).all(userId) as Row[];
    return rows.map((row) => this.formatPlan(row, userId));
  }

  async find(userId: number, id: string, includeArchived: boolean) {
    const row = this.getPlan(id, userId, includeArchived);
    return row ? this.formatPlan(row, userId) : null;
  }

  async updatePlan(userId: number, id: string, input: MealPlanUpdateInput) {
    const current = this.getPlan(id, userId, false);
    if (!current) return { kind: "not_found" as const };
    const startDate = input.startDate ?? String(current.start_date);
    const endDate = input.endDate ?? String(current.end_date);
    if (startDate > endDate) return { kind: "invalid_date_range" as const };
    const changed = this.database.prepare(`UPDATE meal_plans SET title = ?, start_date = ?, end_date = ?, status = ?,
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
      .run(input.title ?? current.title, startDate, endDate, input.status ?? current.status, id, userId, input.version);
    if (changed.changes !== 1) return { kind: "version_conflict" as const };
    return { kind: "updated" as const, value: this.formatPlan(this.getPlan(id, userId, false)!, userId) };
  }

  async removePlan(userId: number, id: string, version: number) {
    const changed = this.database.prepare(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled',
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
      .run(id, userId, version);
    if (changed.changes === 1) return "removed" as const;
    return this.getPlan(id, userId, false) ? "version_conflict" as const : "not_found" as const;
  }

  async updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput) {
    const current = this.getItem(planId, itemId, userId);
    if (!current) return { kind: "not_found" as const };
    let replacement: Row | undefined;
    if (input.recipeId !== undefined && input.recipeId !== null) {
      replacement = this.database.prepare(`SELECT id, title, ingredients_json, steps_json, calories, protein, carbs, fat
        FROM recipes WHERE id = ? AND status = 'approved' AND deleted_at IS NULL`).get(input.recipeId) as Row | undefined;
      if (!replacement) return { kind: "recipe_not_available" as const };
    }
    const changed = this.database.prepare(`UPDATE meal_plan_items SET planned_date = ?, meal_type = ?, recipe_id = ?, title = ?,
      ingredients_json = ?, steps_json = ?, calories = ?, protein = ?, carbs = ?, fat = ?, status = ?,
      queue_item_id = CASE WHEN ? THEN NULL ELSE queue_item_id END,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND plan_id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`).run(
      input.plannedDate ?? current.planned_date, input.mealType ?? current.meal_type,
      input.recipeId === undefined ? current.recipe_id : input.recipeId,
      replacement?.title ?? current.title, replacement?.ingredients_json ?? current.ingredients_json,
      replacement?.steps_json ?? current.steps_json, replacement?.calories ?? current.calories,
      replacement?.protein ?? current.protein, replacement?.carbs ?? current.carbs, replacement?.fat ?? current.fat,
      input.status ?? current.status, input.recipeId !== undefined ? 1 : 0,
      itemId, planId, userId, input.version,
    );
    if (changed.changes !== 1) return { kind: "version_conflict" as const };
    return { kind: "updated" as const, value: formatMealPlanItem(this.getItem(planId, itemId, userId)!) };
  }

  async addShopping(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.database.transaction(() => {
      const repeated = this.repeated(userId, input.idempotencyKey);
      if (repeated) return { kind: "completed" as const, value: repeated };
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      const ingredients = parseJson<unknown[]>(item.ingredients_json, []).map(ingredient)
        .filter((entry): entry is { name: string; amount: string } => Boolean(entry?.name));
      const stock = (this.database.prepare(`SELECT food_name FROM inventory_items
        WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL`).all(userId) as Array<{ food_name: string }>).map((row) => normalizedName(row.food_name));
      const shopping = (this.database.prepare(`SELECT name FROM shopping_list_items
        WHERE user_id = ? AND checked = 0 AND deleted_at IS NULL`).all(userId) as Array<{ name: string }>).map((row) => normalizedName(row.name));
      const missing = ingredients.filter((entry) => {
        const name = normalizedName(entry.name);
        return name && !stock.some((owned) => owned.includes(name) || name.includes(owned))
          && !shopping.some((saved) => saved.includes(name) || name.includes(saved));
      });
      const insert = this.database.prepare(`INSERT INTO shopping_list_items (id, user_id, client_id, name, amount, category)
        VALUES (?, ?, ?, ?, ?, '餐单')`);
      const itemIds = missing.map((entry) => {
        const id = randomUUID();
        insert.run(id, userId, `meal-plan:${itemId}:${normalizedName(entry.name)}`.slice(0, 120), entry.name.slice(0, 120), entry.amount.slice(0, 80));
        return id;
      });
      const value = { added: itemIds.length, itemIds, repeated: false };
      this.saveExecution(userId, input.idempotencyKey, "shopping", itemId, value);
      return { kind: "completed" as const, value };
    })();
  }

  async enqueue(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    try {
      return this.database.transaction(() => {
        const repeated = this.repeated(userId, input.idempotencyKey);
        if (repeated) return { kind: "completed" as const, value: repeated };
        const item = this.getItem(planId, itemId, userId);
        if (!item) return { kind: "not_found" as const };
        if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
        if (!item.recipe_id || item.recipe_status !== "approved" || item.recipe_deleted_at) return { kind: "recipe_unavailable" as const };
        const existing = this.database.prepare(`SELECT id FROM cooking_queue_items WHERE user_id = ? AND recipe_id = ?
          AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(userId, item.recipe_id) as { id: string } | undefined;
        let queueItemId = existing?.id;
        let added = false;
        if (!queueItemId) {
          const count = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM cooking_queue_items WHERE user_id = ?
            AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(userId) as { count: number }).count);
          if (count >= 30) return { kind: "queue_full" as const };
          const position = Number((this.database.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items WHERE user_id = ?
            AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(userId) as { position: number }).position);
          queueItemId = randomUUID();
          this.database.prepare(`INSERT INTO cooking_queue_items
            (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(queueItemId, userId, item.recipe_id, position, queueMealType(item.meal_type), null, JSON.stringify({
            title: item.recipe_title || item.title, imageUrl: item.recipe_image_url || null,
            cookTime: item.recipe_cook_time || 0, difficulty: item.recipe_difficulty || "难度未知",
            ingredients: parseJson(item.ingredients_json, []),
          }), `meal-plan:${itemId}`);
          added = true;
        }
        const changed = this.database.prepare(`UPDATE meal_plan_items SET queue_item_id = ?, status = 'queued', version = version + 1,
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`).run(queueItemId, itemId, userId, input.version);
        if (changed.changes !== 1) throw new Error("MEAL_PLAN_VERSION_CONFLICT");
        const value = { queueItemId, added, repeated: false };
        this.saveExecution(userId, input.idempotencyKey, "queue", itemId, value);
        return { kind: "completed" as const, value };
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_PLAN_VERSION_CONFLICT") return { kind: "version_conflict" as const };
      throw error;
    }
  }

  async complete(userId: number, planId: string, itemId: string, input: MealPlanCompleteInput) {
    try {
      return this.database.transaction(() => {
        const repeated = this.repeated(userId, input.idempotencyKey);
        if (repeated) return { kind: "completed" as const, value: repeated };
        const item = this.getItem(planId, itemId, userId);
        if (!item) return { kind: "not_found" as const };
        if (item.status === "completed" && item.diet_record_id) {
          return { kind: "completed" as const, value: { dietRecordId: Number(item.diet_record_id), repeated: true } };
        }
        if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
        let dietRecordId = input.dietRecordId;
        if (dietRecordId) {
          if (!this.database.prepare("SELECT id FROM diet_records WHERE id = ? AND user_id = ?").get(dietRecordId, userId)) {
            return { kind: "diet_record_not_found" as const };
          }
        } else {
          const inserted = this.database.prepare(`INSERT INTO diet_records
            (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
            VALUES (?, ?, ?, '1份', ?, ?, ?, ?, ?, ?)`).run(userId, item.meal_type, item.recipe_title || item.title,
            item.calories, item.protein, item.carbs, item.fat, item.planned_date,
            item.planned_date === currentDateKey() ? currentTimeKey() : null);
          dietRecordId = Number(inserted.lastInsertRowid);
        }
        const changed = this.database.prepare(`UPDATE meal_plan_items SET status = 'completed', diet_record_id = ?, completed_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
          .run(dietRecordId, itemId, userId, input.version);
        if (changed.changes !== 1) throw new Error("MEAL_PLAN_VERSION_CONFLICT");
        const value = { dietRecordId, repeated: false };
        this.saveExecution(userId, input.idempotencyKey, "complete", itemId, value);
        return { kind: "completed" as const, value };
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_PLAN_VERSION_CONFLICT") return { kind: "version_conflict" as const };
      throw error;
    }
  }

  private getPlan(id: string, userId: number, includeArchived: boolean) {
    return this.database.prepare(`SELECT * FROM meal_plans WHERE id = ? AND user_id = ?${includeArchived ? "" : " AND deleted_at IS NULL"}`)
      .get(id, userId) as Row | undefined;
  }
  private getItem(planId: string, itemId: string, userId: number) {
    return this.database.prepare(`${itemSelect} WHERE i.id = ? AND i.plan_id = ? AND i.user_id = ? AND i.deleted_at IS NULL`)
      .get(itemId, planId, userId) as Row | undefined;
  }
  private getItems(planId: string, userId: number) {
    return (this.database.prepare(`${itemSelect} WHERE i.plan_id = ? AND i.user_id = ? AND i.deleted_at IS NULL
      ORDER BY i.planned_date, CASE i.meal_type WHEN '早餐' THEN 0 WHEN '午餐' THEN 1 WHEN '晚餐' THEN 2 ELSE 3 END, i.id`)
      .all(planId, userId) as Row[]).map(formatMealPlanItem);
  }
  private formatPlan(row: Row, userId: number) { return formatMealPlan(row, this.getItems(String(row.id), userId)); }
  private repeated(userId: number, key: string) {
    const row = this.database.prepare("SELECT result_json FROM meal_plan_execution_requests WHERE user_id = ? AND idempotency_key = ?")
      .get(userId, key) as { result_json: string } | undefined;
    return row ? { ...JSON.parse(row.result_json), repeated: true } : null;
  }
  private saveExecution(userId: number, key: string, action: string, itemId: string, result: unknown) {
    this.database.prepare(`INSERT INTO meal_plan_execution_requests
      (user_id, idempotency_key, action, meal_plan_item_id, result_json) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, key, action, itemId, JSON.stringify(result));
  }
}
