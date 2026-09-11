import { replacementAllocation } from "./replacementAllocation.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { mealChangeDecision, mealChangeSnapshot, mealChangeFingerprint, formatMealChange, isMealChangeNoop, planMetadataPreservesItem, type PlanMetadataEdit } from "./changePolicy.js";
import { prepareDraftActivation } from "./draftActivation.js";
import type { SaveCookingPlanDraftInput, UpdateCookingPlanDraftInput } from "@dietdigidose/contracts";
import { isDeepStrictEqual } from "node:util";
import { SqliteDietRecordsRepository } from "../dietRecords/sqliteRepository.js";
import { prepareProduction } from "../dietRecords/preparedMeals.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { formatMealPlan, formatMealPlanItem, ingredient, normalizedName, parseJson, queueMealType, type Row } from "./formatters.js";
import type { MealPlansRepository } from "./repository.js";
import type { MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput, MealPlanUpdateInput } from "./types.js";

const itemSelect = `SELECT i.*, p.constraints_json AS plan_constraints_json, r.title AS recipe_title, r.image_url AS recipe_image_url,
  r.cook_time AS recipe_cook_time, r.difficulty AS recipe_difficulty,
  r.status AS recipe_status, r.deleted_at AS recipe_deleted_at
  FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id LEFT JOIN recipes r ON r.id = i.recipe_id`;

export class SqliteMealPlansRepository implements MealPlansRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }

  async activateDraft(userId: number, id: string, version: number) {
    return this.database.transaction(() => {
      const current = this.getPlan(id, userId, false);
      if (!current) return { kind: "not_found" as const };
      const activation = prepareDraftActivation(current, version);
      if (!activation) return { kind: "version_conflict" as const };
      if (activation.repeated) return { kind: "updated" as const, value: { plan: this.formatPlan(current, userId), repeated: true } };
      if (activation.weekly) {
        const occupied = this.database.prepare("SELECT i.planned_date,i.meal_type FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=? AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('active','completed') AND i.status<>'skipped'").all(userId) as Row[];
        const activePlans = this.database.prepare("SELECT constraints_json FROM meal_plans WHERE user_id=? AND deleted_at IS NULL AND status='active'").all(userId) as Row[];
        for (const plan of activePlans) {
          const saved = parseJson<Row>(plan.constraints_json,{});
          const draft = (saved.currentCookingDraft ?? (saved.savedCookingDraft as { draft?: unknown } | undefined)?.draft) as { meals?: Array<{ date: string; mealType: string; cookServings: number }> } | undefined;
          for (const meal of draft?.meals ?? []) if (meal.cookServings === 0) occupied.push({ planned_date: meal.date,meal_type: meal.mealType });
        }
        if (activation.targets.some(target => occupied.some(item => String(item.planned_date) === target.date && queueMealType(item.meal_type) === target.mealType))) return { kind: "version_conflict" as const };
      }
      if (this.getItems(id, userId).length) return { kind: "version_conflict" as const };
      const recipes = activation.items.map(item => this.database.prepare("SELECT steps_json FROM recipes WHERE id=? AND status='approved' AND deleted_at IS NULL").get(item.recipeId) as Row | undefined);
      if (recipes.some(recipe => !recipe)) return { kind: "recipe_not_available" as const };
      activation.items.forEach((item, index) => this.database.prepare(`INSERT INTO meal_plan_items
        (id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json,confirmed_at)
        VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(item.id,id,userId,item.date,item.mealType,item.title,item.recipeId,JSON.stringify(item.ingredients),recipes[index]!.steps_json));
      this.database.prepare("UPDATE meal_plans SET status='active',constraints_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
        .run(JSON.stringify(activation.constraints),id,userId);
      return { kind: "updated" as const, value: { plan: this.formatPlan(this.getPlan(id,userId,false)!,userId), repeated: false } };
    })();
  }

  async updateDraft(userId: number, id: string, input: UpdateCookingPlanDraftInput) {
    return this.database.transaction(() => {
      const current = this.getPlan(id, userId, false);
      if (!current) return { kind: "not_found" as const };
      const constraints = parseJson<Row>(current.constraints_json, {});
      const last = constraints.lastDraftUpdate as UpdateCookingPlanDraftInput | undefined;
      if (last?.idempotencyKey === input.idempotencyKey) {
        if (!isDeepStrictEqual(last, input)) return { kind: "version_conflict" as const };
        return { kind: "updated" as const, value: { plan: this.formatPlan(current, userId), repeated: true } };
      }
      if (Number(current.version) !== input.version || current.status !== "draft" || !constraints.savedCookingDraft || this.getItems(id, userId).length) {
        return { kind: "version_conflict" as const };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      this.database.prepare(`UPDATE meal_plans SET constraints_json=?,start_date=?,end_date=?,version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=?`).run(
        JSON.stringify({ ...constraints, currentCookingDraft: input.draft, lastDraftUpdate: input }), dates[0], dates.at(-1), id, userId, input.version);
      return { kind: "updated" as const, value: { plan: this.formatPlan(this.getPlan(id, userId, false)!, userId), repeated: false } };
    })();
  }

  async saveDraft(userId: number, input: SaveCookingPlanDraftInput) {
    return this.database.transaction(() => {
      const existing = this.database.prepare("SELECT * FROM meal_plans WHERE id = ?").get(input.id) as Row | undefined;
      const snapshot = { title: input.title, draft: input.draft };
      if (existing) {
        if (Number(existing.user_id) !== userId || !isDeepStrictEqual(parseJson<Row>(existing.constraints_json, {}).savedCookingDraft, snapshot)) return null;
        return { plan: this.formatPlan(existing, userId), repeated: true };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      this.database.prepare(`INSERT INTO meal_plans (id,user_id,title,start_date,end_date,status,source,constraints_json)
        VALUES (?,?,?,?,?,'draft','manual',?)`).run(input.id, userId, input.title, dates[0], dates.at(-1),
        JSON.stringify({ savedCookingDraft: snapshot }));
      return { plan: this.formatPlan(this.getPlan(input.id, userId, false)!, userId), repeated: false };
    })();
  }

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
    return this.database.transaction(() => {
    const current = this.getPlan(id, userId, false);
    if (!current) return { kind: "not_found" as const };
    const startDate = input.startDate ?? String(current.start_date);
    const endDate = input.endDate ?? String(current.end_date);
    if (startDate > endDate) return { kind: "invalid_date_range" as const };
    this.assertPlanEditInTransaction(userId,id,input);
    const changed = this.database.prepare(`UPDATE meal_plans SET title = ?, start_date = ?, end_date = ?, status = ?,
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
      .run(input.title ?? current.title, startDate, endDate, input.status ?? current.status, id, userId, input.version);
    if (changed.changes !== 1) return { kind: "version_conflict" as const };
    return { kind: "updated" as const, value: this.formatPlan(this.getPlan(id, userId, false)!, userId) };
  })();
  }

  async removePlan(userId: number, id: string, version: number) {
    return this.database.transaction(() => {
    this.assertPlanEditInTransaction(userId,id,{ archive: true });
    const changed = this.database.prepare(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled',
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
      .run(id, userId, version);
    if (changed.changes === 1) return "removed" as const;
    return this.getPlan(id, userId, false) ? "version_conflict" as const : "not_found" as const;
  })();
  }

  assertPlanEditInTransaction(userId: number, planId: string, edit: PlanMetadataEdit) {
    const items = this.database.prepare("SELECT * FROM meal_plan_items WHERE plan_id=? AND user_id=? AND deleted_at IS NULL ORDER BY id").all(planId,userId) as Row[];
    for (const item of items) {
      const facts = this.changeFacts(item,userId);
      if (!planMetadataPreservesItem(item,facts.decision,edit)) throw new InventoryQuantityError("MEAL_PLAN_PROTECTED", "餐单包含已确认、已采购或已进入制作的安排，或日期将排除已有餐次；请先逐餐审阅调整，原安排已保留");
    }
  }

  private changeFacts(item: Row, userId: number) {
    const queue = item.queue_item_id ? this.database.prepare("SELECT id,version,status FROM cooking_queue_items WHERE id=? AND user_id=? AND deleted_at IS NULL").get(item.queue_item_id, userId) as Row | undefined : undefined;
    const purchases = this.database.prepare("SELECT id,version,checked FROM shopping_list_items WHERE user_id=? AND client_id LIKE ? ORDER BY id").all(userId, `meal-plan:${item.id}:%`) as Row[];
    return { decision: mealChangeDecision(item, queue, purchases), snapshot: mealChangeSnapshot(item, queue, purchases) };
  }

  async confirmItem(userId: number, planId: string, itemId: string, version: number) {
    return this.database.transaction(() => {
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      if (Number(item.version) !== version) return { kind: "version_conflict" as const };
      if (!item.confirmed_at) this.database.prepare("UPDATE meal_plan_items SET confirmed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(itemId, userId);
      return { kind: "updated" as const, value: formatMealPlanItem(this.getItem(planId, itemId, userId)!) };
    })();
  }

  async listChanges(userId: number, planId: string) {
    return (this.database.prepare("SELECT * FROM meal_plan_changes WHERE user_id=? AND plan_id=? ORDER BY created_at DESC,id DESC").all(userId, planId) as Row[]).map(formatMealChange);
  }

  async updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source = "manual", reason = "调整餐次安排") {
    return this.updateItemInTransaction(userId,planId,itemId,input,source,reason);
  }

  /** Synchronous so maintenance can atomically commit a whole batch and its acknowledgement. */
  updateItemInTransaction(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source = "manual", reason = "调整餐次安排") {
    return this.database.transaction(() => {
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      const facts = this.changeFacts(item, userId);
      if (Number(item.version) === input.version && isMealChangeNoop(item,input)) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      const fingerprint = mealChangeFingerprint(itemId, facts.snapshot, input);
      const existing = this.database.prepare("SELECT * FROM meal_plan_changes WHERE user_id=? AND fingerprint=?").get(userId, fingerprint) as Row | undefined;
      if (existing) return { kind: "updated" as const, value: { ...formatMealPlanItem(item), change: formatMealChange(existing) } };
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      const replacement = input.recipeId ? this.database.prepare("SELECT title FROM recipes WHERE id=? AND status='approved' AND deleted_at IS NULL").get(input.recipeId) as Row | undefined : undefined;
      if (input.recipeId && !replacement) return { kind: "recipe_not_available" as const };
      const proposal = { ...input, title: String(replacement?.title || item.recipe_title || item.title) };
      const id = randomUUID();
      let next = formatMealPlanItem(item);
      if (facts.decision === "apply") {
        const applied = this.applyItemChange(userId, planId, itemId, input);
        if (applied.kind !== "updated") return applied;
        next = applied.value;
      }
      this.database.prepare(`INSERT INTO meal_plan_changes(id,user_id,plan_id,item_id,fingerprint,source,reason,status,before_version,after_version,before_json,after_json,applied_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)`).run(id,userId,planId,itemId,fingerprint,source,reason,
        facts.decision === "apply" ? "applied" : facts.decision === "suggest" ? "pending" : "blocked", input.version,
        facts.decision === "apply" ? next.version : null,JSON.stringify(facts.snapshot),JSON.stringify(proposal),facts.decision === "apply" ? 1 : 0);
      return { kind: "updated" as const, value: { ...next, change: formatMealChange(this.database.prepare("SELECT * FROM meal_plan_changes WHERE id=?").get(id) as Row) } };
    })();
  }

  async reviewChange(userId: number, planId: string, changeId: string, action: "accept" | "reject" | "restore") {
    return this.database.transaction(() => {
      const change = this.database.prepare("SELECT * FROM meal_plan_changes WHERE id=? AND user_id=? AND plan_id=?").get(changeId,userId,planId) as Row | undefined;
      if (!change) return { kind: "not_found" as const };
      const item = this.getItem(planId,String(change.item_id),userId);
      if (!item) return { kind: "not_found" as const };
      if ((action === "accept" && change.status === "applied") || (action === "reject" && change.status === "rejected") || (action === "restore" && change.status === "reverted")) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      if (action === "reject" && change.status === "pending") {
        this.database.prepare("UPDATE meal_plan_changes SET status='rejected' WHERE id=?").run(changeId);
        return { kind: "updated" as const, value: formatMealPlanItem(item) };
      }
      if ((action === "accept" && change.status !== "pending") || (action === "restore" && change.status !== "applied") || action === "reject") return { kind: "version_conflict" as const };
      const facts = this.changeFacts(item,userId);
      const before = parseJson<ReturnType<typeof mealChangeSnapshot>>(change.before_json, {} as ReturnType<typeof mealChangeSnapshot>);
      const expectedVersion = action === "restore" ? Number(change.after_version) : Number(change.before_version);
      const unchangedFacts = { ...facts.snapshot, version: before.version, input: before.input,title: before.title };
      if (facts.decision === "keep" || Number(item.version) !== expectedVersion || !isDeepStrictEqual(unchangedFacts,before)) return { kind: "protected" as const };
      const patch = action === "restore" ? before.input : parseJson<MealPlanItemUpdateInput>(change.after_json, { version: expectedVersion });
      const result = this.applyItemChange(userId,planId,String(item.id),{ ...patch, version: expectedVersion });
      if (result.kind !== "updated") return result;
      if (action === "restore") this.database.prepare("UPDATE meal_plan_changes SET status='reverted',after_json=json_set(after_json,'$.restoredVersion',?,'$.restoredAt',CURRENT_TIMESTAMP) WHERE id=?").run(result.value.version,changeId);
      else this.database.prepare("UPDATE meal_plan_changes SET status='applied',after_version=?,applied_at=CURRENT_TIMESTAMP WHERE id=?").run(result.value.version,changeId);
      return result;
    })();
  }

  private applyItemChange(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput) {
    const current = this.getItem(planId, itemId, userId);
    if (!current) return { kind: "not_found" as const };
    let replacement: Row | undefined;
    if (input.recipeId !== undefined && input.recipeId !== null) {
      replacement = this.database.prepare(`SELECT id, title, ingredients_json, steps_json, calories, protein, carbs, fat, serving_size
        FROM recipes WHERE id = ? AND status = 'approved' AND deleted_at IS NULL`).get(input.recipeId) as Row | undefined;
      if (!replacement) return { kind: "recipe_not_available" as const };
    }
    const allocation = replacement ? replacementAllocation(current,replacement) : undefined;
    if (allocation === null) return { kind: "protected" as const };
    const changed = this.database.prepare(`UPDATE meal_plan_items SET planned_date = ?, meal_type = ?, recipe_id = ?, title = ?,
      ingredients_json = ?, steps_json = ?, calories = ?, protein = ?, carbs = ?, fat = ?, status = ?,
      queue_item_id = CASE WHEN ? THEN NULL ELSE queue_item_id END,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND plan_id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`).run(
      input.plannedDate ?? current.planned_date, input.mealType ?? current.meal_type,
      input.recipeId === undefined ? current.recipe_id : input.recipeId,
      replacement?.title ?? current.title, allocation ? JSON.stringify(allocation.ingredients) : current.ingredients_json,
      replacement?.steps_json ?? current.steps_json, replacement?.calories ?? current.calories,
      replacement?.protein ?? current.protein, replacement?.carbs ?? current.carbs, replacement?.fat ?? current.fat,
      input.status ?? current.status, input.recipeId !== undefined ? 1 : 0,
      itemId, planId, userId, input.version,
    );
    if (changed.changes !== 1) return { kind: "version_conflict" as const };
    if (allocation?.constraints) this.database.prepare("UPDATE meal_plans SET constraints_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
      .run(JSON.stringify(allocation.constraints),planId,userId);
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
        const existing = this.database.prepare(`SELECT id FROM cooking_queue_items WHERE user_id = ? AND source_plan_item_id = ?
          AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(userId, itemId) as { id: string } | undefined;
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
            (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key, source_plan_item_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(queueItemId, userId, item.recipe_id, position, queueMealType(item.meal_type), null, JSON.stringify({
            title: item.recipe_title || item.title, imageUrl: item.recipe_image_url || null,
            cookTime: item.recipe_cook_time || 0, difficulty: item.recipe_difficulty || "难度未知",
            ingredients: parseJson(item.ingredients_json, []),
            plannedServings: formatMealPlanItem(item).plannedServings, planItemId: itemId, plannedDate: String(item.planned_date),
          }), `meal-plan:${itemId}:${input.version}`, itemId);
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
    if (input.production) {
      if (input.dietRecordId) throw new Error("制作分配不能同时关联旧饮食记录");
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      const value = await new SqliteDietRecordsRepository(this.database).completeCooking(userId, {
        idempotency_key: input.idempotencyKey, recipe_id: item.recipe_id == null ? null : Number(item.recipe_id),
        inventory_item_ids: [], inventory_consumptions: input.inventory_consumptions ?? [],
        production: prepareProduction({ ...input.production, plan_item_id: itemId, plan_version: input.version }),
      });
      return { kind: "completed" as const, value };
    }
    try {
      return this.database.transaction(() => {
        const repeated = this.repeated(userId, input.idempotencyKey);
        if (repeated) return { kind: "completed" as const, value: repeated };
        const item = this.getItem(planId, itemId, userId);
        if (!item) return { kind: "not_found" as const };
        const produced = this.database.prepare("SELECT result_json FROM prepared_meals WHERE user_id=? AND plan_item_id=?")
          .get(userId, itemId) as { result_json: string } | undefined;
        if (produced) return { kind: "completed" as const, value: { ...JSON.parse(produced.result_json), repeated: true } };
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
    return this.database.prepare(`${itemSelect} WHERE i.id = ? AND i.plan_id = ? AND i.user_id = ? AND i.deleted_at IS NULL AND p.deleted_at IS NULL`)
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
