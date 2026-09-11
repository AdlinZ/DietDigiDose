import { mealChangeDecision, mealChangeSnapshot, mealChangeFingerprint, formatMealChange, isMealChangeNoop } from "./changePolicy.js";
import { prepareDraftActivation } from "./draftActivation.js";
import type { SaveCookingPlanDraftInput, UpdateCookingPlanDraftInput } from "@dietdigidose/contracts";
import { isDeepStrictEqual } from "node:util";
import { PostgresDietRecordsRepository } from "../dietRecords/postgresRepository.js";
import { consumeInventoryWithPostgresClient } from "../inventory/postgresRepository.js";
import { prepareProduction } from "../dietRecords/preparedMeals.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { formatMealPlan, formatMealPlanItem, ingredient, normalizedName, parseJson, queueMealType, type Row } from "./formatters.js";
import type { MealPlansRepository } from "./repository.js";
import type { MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput, MealPlanUpdateInput } from "./types.js";

const activeQueueStatuses = "'waiting', 'preparing', 'ready', 'cooking'";
const itemSelect = `SELECT i.*, p.constraints_json AS plan_constraints_json, r.title AS recipe_title, r.image_url AS recipe_image_url,
  r.cook_time AS recipe_cook_time, r.difficulty AS recipe_difficulty,
  r.status AS recipe_status, r.deleted_at AS recipe_deleted_at
  FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id LEFT JOIN recipes r ON r.id = i.recipe_id`;

export class PostgresMealPlansRepository implements MealPlansRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  async activateDraft(userId: number, id: string, version: number) {
    return this.transaction(async client => {
      const selected = await client.query("SELECT * FROM meal_plans WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [id,userId]);
      const current = selected.rows[0] as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      const activation = prepareDraftActivation(current, version);
      if (!activation) return { kind: "version_conflict" as const };
      if (activation.repeated) return { kind: "updated" as const, value: { plan: await this.formatPlan(client,current,userId), repeated: true } };
      if ((await client.query("SELECT id FROM meal_plan_items WHERE plan_id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1", [id,userId])).rowCount) return { kind: "version_conflict" as const };
      const recipes: Row[] = [];
      for (const item of activation.items) {
        const found = await client.query("SELECT steps_json FROM recipes WHERE id=$1 AND status='approved' AND deleted_at IS NULL FOR SHARE", [item.recipeId]);
        if (!found.rows[0]) return { kind: "recipe_not_available" as const };
        recipes.push(found.rows[0]);
      }
      for (const [index,item] of activation.items.entries()) await client.query(`INSERT INTO meal_plan_items
        (id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json,confirmed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,CURRENT_TIMESTAMP)`, [item.id,id,userId,item.date,item.mealType,item.title,item.recipeId,JSON.stringify(item.ingredients),JSON.stringify(recipes[index].steps_json)]);
      const updated = await client.query("UPDATE meal_plans SET status='active',constraints_json=$1::jsonb,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND user_id=$3 RETURNING *", [JSON.stringify(activation.constraints),id,userId]);
      return { kind: "updated" as const, value: { plan: await this.formatPlan(client,updated.rows[0],userId), repeated: false } };
    });
  }

  async updateDraft(userId: number, id: string, input: UpdateCookingPlanDraftInput) {
    return this.transaction(async client => {
      const selected = await client.query("SELECT * FROM meal_plans WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [id, userId]);
      const current = selected.rows[0] as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      const constraints = parseJson<Row>(current.constraints_json, {});
      const last = constraints.lastDraftUpdate as UpdateCookingPlanDraftInput | undefined;
      if (last?.idempotencyKey === input.idempotencyKey) {
        if (!isDeepStrictEqual(last, input)) return { kind: "version_conflict" as const };
        return { kind: "updated" as const, value: { plan: await this.formatPlan(client, current, userId), repeated: true } };
      }
      const items = await client.query("SELECT id FROM meal_plan_items WHERE plan_id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1", [id, userId]);
      if (Number(current.version) !== input.version || current.status !== "draft" || !constraints.savedCookingDraft || items.rowCount) {
        return { kind: "version_conflict" as const };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      const updated = await client.query(`UPDATE meal_plans SET constraints_json=$1::jsonb,start_date=$2,end_date=$3,version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND user_id=$5 AND version=$6 RETURNING *`,
        [JSON.stringify({ ...constraints, currentCookingDraft: input.draft, lastDraftUpdate: input }), dates[0], dates.at(-1), id, userId, input.version]);
      return { kind: "updated" as const, value: { plan: await this.formatPlan(client, updated.rows[0] as Row, userId), repeated: false } };
    });
  }

  async saveDraft(userId: number, input: SaveCookingPlanDraftInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`meal-plan-draft:${input.id}`]);
      const selected = await client.query("SELECT * FROM meal_plans WHERE id = $1", [input.id]);
      const existing = selected.rows[0] as Row | undefined;
      const snapshot = { title: input.title, draft: input.draft };
      if (existing) {
        if (Number(existing.user_id) !== userId || !isDeepStrictEqual(parseJson<Row>(existing.constraints_json, {}).savedCookingDraft, snapshot)) {
          await client.query("ROLLBACK"); return null;
        }
        const plan = await this.formatPlan(client, existing, userId);
        await client.query("COMMIT"); return { plan, repeated: true };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      const inserted = await client.query(`INSERT INTO meal_plans (id,user_id,title,start_date,end_date,status,source,constraints_json)
        VALUES ($1,$2,$3,$4,$5,'draft','manual',$6::jsonb) RETURNING *`,
        [input.id, userId, input.title, dates[0], dates.at(-1), JSON.stringify({ savedCookingDraft: snapshot })]);
      const plan = await this.formatPlan(client, inserted.rows[0] as Row, userId);
      await client.query("COMMIT"); return { plan, repeated: false };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

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

  private async changeFacts(client: PoolClient, item: Row, userId: number) {
    const queue = item.queue_item_id ? (await client.query("SELECT id,version,status FROM cooking_queue_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [item.queue_item_id,userId])).rows[0] as Row | undefined : undefined;
    const purchases = (await client.query("SELECT id,version,checked FROM shopping_list_items WHERE user_id=$1 AND client_id LIKE $2 ORDER BY id FOR UPDATE", [userId,`meal-plan:${item.id}:%`])).rows as Row[];
    return { decision: mealChangeDecision(item,queue,purchases), snapshot: mealChangeSnapshot(item,queue,purchases) };
  }

  async confirmItem(userId: number, planId: string, itemId: string, version: number) {
    return this.transaction(async client => {
      const item = await this.getItem(client,planId,itemId,userId,true);
      if (!item) return { kind: "not_found" as const };
      if (Number(item.version) !== version) return { kind: "version_conflict" as const };
      if (!item.confirmed_at) await client.query("UPDATE meal_plan_items SET confirmed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2", [itemId,userId]);
      return { kind: "updated" as const, value: formatMealPlanItem((await this.getItem(client,planId,itemId,userId))!) };
    });
  }

  async listChanges(userId: number, planId: string) {
    return (await this.pool.query("SELECT * FROM meal_plan_changes WHERE user_id=$1 AND plan_id=$2 ORDER BY created_at DESC,id DESC", [userId,planId])).rows.map(formatMealChange);
  }

  async updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source = "manual", reason = "调整餐次安排") {
    return this.transaction(async client => {
      const item = await this.getItem(client,planId,itemId,userId,true);
      if (!item) return { kind: "not_found" as const };
      const facts = await this.changeFacts(client,item,userId);
      if (Number(item.version) === input.version && isMealChangeNoop(item,input)) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      const fingerprint = mealChangeFingerprint(itemId,facts.snapshot,input);
      const existing = (await client.query("SELECT * FROM meal_plan_changes WHERE user_id=$1 AND fingerprint=$2", [userId,fingerprint])).rows[0] as Row | undefined;
      if (existing) return { kind: "updated" as const, value: { ...formatMealPlanItem(item), change: formatMealChange(existing) } };
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      const replacement = input.recipeId ? (await client.query("SELECT title FROM recipes WHERE id=$1 AND status='approved' AND deleted_at IS NULL FOR SHARE",[input.recipeId])).rows[0] as Row | undefined : undefined;
      if (input.recipeId && !replacement) return { kind: "recipe_not_available" as const };
      const proposal = { ...input, title: String(replacement?.title || item.recipe_title || item.title) };
      const id = randomUUID();
      let next = formatMealPlanItem(item);
      if (facts.decision === "apply") {
        const applied = await this.applyItemChange(client,userId,planId,itemId,input);
        if (applied.kind !== "updated") return applied;
        next = applied.value;
      }
      const changed = await client.query(`INSERT INTO meal_plan_changes(id,user_id,plan_id,item_id,fingerprint,source,reason,status,before_version,after_version,before_json,after_json,applied_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,CASE WHEN $13::boolean THEN CURRENT_TIMESTAMP ELSE NULL END) RETURNING *`,
        [id,userId,planId,itemId,fingerprint,source,reason,facts.decision === "apply" ? "applied" : facts.decision === "suggest" ? "pending" : "blocked",input.version,
          facts.decision === "apply" ? next.version : null,JSON.stringify(facts.snapshot),JSON.stringify(proposal),facts.decision === "apply"]);
      return { kind: "updated" as const, value: { ...next, change: formatMealChange(changed.rows[0]) } };
    });
  }

  async reviewChange(userId: number, planId: string, changeId: string, action: "accept" | "reject" | "restore") {
    return this.transaction(async client => {
      const change = (await client.query("SELECT * FROM meal_plan_changes WHERE id=$1 AND user_id=$2 AND plan_id=$3 FOR UPDATE", [changeId,userId,planId])).rows[0] as Row | undefined;
      if (!change) return { kind: "not_found" as const };
      const item = await this.getItem(client,planId,String(change.item_id),userId,true);
      if (!item) return { kind: "not_found" as const };
      if ((action === "accept" && change.status === "applied") || (action === "reject" && change.status === "rejected") || (action === "restore" && change.status === "reverted")) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      if (action === "reject" && change.status === "pending") {
        await client.query("UPDATE meal_plan_changes SET status='rejected' WHERE id=$1", [changeId]);
        return { kind: "updated" as const, value: formatMealPlanItem(item) };
      }
      if ((action === "accept" && change.status !== "pending") || (action === "restore" && change.status !== "applied") || action === "reject") return { kind: "version_conflict" as const };
      const facts = await this.changeFacts(client,item,userId);
      const before = parseJson<ReturnType<typeof mealChangeSnapshot>>(change.before_json, {} as ReturnType<typeof mealChangeSnapshot>);
      const expectedVersion = action === "restore" ? Number(change.after_version) : Number(change.before_version);
      const unchangedFacts = { ...facts.snapshot,version:before.version,input:before.input,title:before.title };
      if (facts.decision === "keep" || Number(item.version) !== expectedVersion || !isDeepStrictEqual(unchangedFacts,before)) return { kind: "protected" as const };
      const patch = action === "restore" ? before.input : parseJson<MealPlanItemUpdateInput>(change.after_json, { version: expectedVersion });
      const result = await this.applyItemChange(client,userId,planId,String(item.id),{ ...patch,version:expectedVersion });
      if (result.kind !== "updated") return result;
      if (action === "restore") await client.query("UPDATE meal_plan_changes SET status='reverted',after_json=after_json || jsonb_build_object('restoredVersion',$1::integer,'restoredAt',CURRENT_TIMESTAMP) WHERE id=$2",[result.value.version,changeId]);
      else await client.query("UPDATE meal_plan_changes SET status='applied',after_version=$1,applied_at=CURRENT_TIMESTAMP WHERE id=$2",[result.value.version,changeId]);
      return result;
    });
  }

  private async applyItemChange(client: PoolClient, userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput) {
    const current = await this.getItem(client, planId, itemId, userId);
    if (!current) return { kind: "not_found" as const };
    let replacement: Row | undefined;
    if (input.recipeId !== undefined && input.recipeId !== null) {
      const selected = await client.query(`SELECT id, title, ingredients_json, steps_json, calories, protein, carbs, fat
        FROM recipes WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL`, [input.recipeId]);
      replacement = selected.rows[0] as Row | undefined;
      if (!replacement) return { kind: "recipe_not_available" as const };
    }
    const changed = await client.query(`UPDATE meal_plan_items SET planned_date = $1, meal_type = $2, recipe_id = $3, title = $4,
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
    return { kind: "updated" as const, value: formatMealPlanItem((await this.getItem(client, planId, itemId, userId))!) };
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
      const existing = await client.query(`SELECT id FROM cooking_queue_items WHERE user_id = $1 AND source_plan_item_id = $2
        AND deleted_at IS NULL AND status IN (${activeQueueStatuses})`, [userId, itemId]);
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
          (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key, source_plan_item_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`, [queueItemId, userId, item.recipe_id, position,
          queueMealType(item.meal_type), null, JSON.stringify({
            title: item.recipe_title || item.title, imageUrl: item.recipe_image_url || null,
            cookTime: item.recipe_cook_time || 0, difficulty: item.recipe_difficulty || "难度未知",
            ingredients: parseJson(item.ingredients_json, []),
            plannedServings: formatMealPlanItem(item).plannedServings, planItemId: itemId, plannedDate: String(item.planned_date),
          }), `meal-plan:${itemId}:${input.version}`, itemId]);
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

  async complete(userId: number, planId: string, itemId: string, input: MealPlanCompleteInput) {
    if (input.production) {
      if (input.dietRecordId) throw new Error("制作分配不能同时关联旧饮食记录");
      const item = (await this.pool.query(`${itemSelect} WHERE i.plan_id=$1 AND i.id=$2 AND i.user_id=$3`, [planId, itemId, userId])).rows[0];
      if (!item) return { kind: "not_found" as const };
      const value = await new PostgresDietRecordsRepository(this.pool, consumeInventoryWithPostgresClient).completeCooking(userId, {
        idempotency_key: input.idempotencyKey, recipe_id: item.recipe_id == null ? null : Number(item.recipe_id),
        inventory_item_ids: [], inventory_consumptions: input.inventory_consumptions ?? [],
        production: prepareProduction({ ...input.production, plan_item_id: itemId, plan_version: input.version }),
      });
      return { kind: "completed" as const, value };
    }
    return this.transaction(async (client) => {
      await this.lockExecution(client, userId, input.idempotencyKey);
      const repeated = await this.repeated(client, userId, input.idempotencyKey);
      if (repeated) return { kind: "completed" as const, value: repeated };
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prepared-meals:${userId}`]);
      const item = await this.getItem(client, planId, itemId, userId, true);
      if (!item) return { kind: "not_found" as const };
      const produced = (await client.query("SELECT result_json FROM prepared_meals WHERE user_id=$1 AND plan_item_id=$2", [userId, itemId])).rows[0];
      if (produced) return { kind: "completed" as const, value: { ...produced.result_json, repeated: true } };
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
    const result = await client.query(`${itemSelect} WHERE i.id = $1 AND i.plan_id = $2 AND i.user_id = $3 AND i.deleted_at IS NULL AND p.deleted_at IS NULL${lock ? " FOR UPDATE OF i" : ""}`,
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
