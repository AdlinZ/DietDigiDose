import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { currentDateKey, currentTimeKey, dateKeyAfterDays } from "../../utils/date.js";
import { arrayValue, nonNegativeInteger, nonNegativeNumber, reversibleAgentActions, stringValue, timestampMs } from "./helpers.js";
import type { AgentOperationsRepository, ExecutableAgentAction } from "./repository.js";

type StoredAction = {
  id: string;
  action_type: string;
  status: string;
  before_json: string | null;
  result_json: string | null;
  executed_at: string | null;
  created_at: string;
};

export class SqliteAgentOperationsRepository implements AgentOperationsRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async executeActions(userId: number, runId: string, proposals: ExecutableAgentAction[]) {
    try {
      return this.database.transaction(() => {
        const run = this.database.prepare("SELECT status FROM agent_runs WHERE id = ? AND user_id = ?")
          .get(runId, userId) as { status: string } | undefined;
        if (!run || run.status !== "running") throw new Error("Agent Run 已取消或不再允许执行操作");
        return proposals.map((proposal) => ({
          actionId: proposal.id,
          result: this.executeAction(userId, runId, proposal),
        }));
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : "执行失败";
      for (const proposal of proposals) {
        if (proposal.id) this.failAction(proposal.id, userId, runId, message);
      }
      throw error;
    }
  }

  async undoActions(userId: number, runId: string) {
    const rows = this.database.prepare(`SELECT id,action_type,status,before_json,result_json,executed_at,created_at
      FROM agent_actions WHERE run_id = ? AND user_id = ? ORDER BY created_at,id`).all(runId, userId) as StoredAction[];
    const actions = rows.filter((row) => row.status === "executed" && reversibleAgentActions.has(row.action_type));
    if (!actions.length) throw new Error("没有可撤销的 Agent 操作");
    const latest = Math.max(...actions.map((action) => timestampMs(action.executed_at || action.created_at)));
    if (!Number.isFinite(latest) || Date.now() - latest > 10 * 60_000) throw new Error("撤销窗口已过期");
    return this.database.transaction(() => {
      for (const action of [...actions].reverse()) {
        const result = this.parseObject(action.result_json);
        const before = this.parseObject(action.before_json);
        if (action.action_type === "create_meal_plan" && result?.planId) {
          const changed = this.database.prepare(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP,status = 'cancelled',version = version + 1
            WHERE id = ? AND user_id = ? AND created_by_run_id = ? AND version = 1 AND deleted_at IS NULL`)
            .run(result.planId, userId, runId).changes;
          if (changed !== 1) throw new Error("餐单已在 Agent 执行后发生变化，无法安全撤销");
        } else if (action.action_type === "add_shopping_items" && Array.isArray(result?.itemIds)) {
          for (const id of result.itemIds) {
            const changed = this.database.prepare(`UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP,version = version + 1
              WHERE id = ? AND user_id = ? AND source_run_id = ? AND version = 1 AND deleted_at IS NULL`)
              .run(id, userId, runId).changes;
            if (changed !== 1) throw new Error("采购项已在 Agent 执行后发生变化，无法安全撤销");
          }
        } else if (action.action_type === "update_shopping_item" && before?.id) {
          const changed = this.database.prepare(`UPDATE shopping_list_items SET name = ?,amount = ?,category = ?,checked = ?,
            purchase_date = ?,storage_location = ?,version = version + 1,updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ? AND version = ?`).run(
              before.name, before.amount, before.category, before.checked, before.purchase_date,
              before.storage_location, before.id, userId, Number(before.version) + 1,
            ).changes;
          if (changed !== 1) throw new Error("采购项已在 Agent 执行后发生变化，无法安全撤销");
        } else if (action.action_type === "update_meal_plan" && before?.id) {
          const changed = this.database.prepare(`UPDATE meal_plans SET title = ?,start_date = ?,end_date = ?,status = ?,
            constraints_json = ?,version = version + 1,updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ? AND version = ?`).run(
              before.title, before.start_date, before.end_date, before.status, before.constraints_json,
              before.id, userId, Number(before.version) + 1,
            ).changes;
          if (changed !== 1) throw new Error("餐单已在 Agent 执行后发生变化，无法安全撤销");
        } else {
          throw new Error(`操作 ${action.action_type} 不支持自动撤销`);
        }
        this.updateActionStatus(action.id, userId, runId, "undone");
      }
      return { undone: actions.length };
    })();
  }

  private executeAction(userId: number, runId: string, action: ExecutableAgentAction) {
    if (!action.id) throw new Error("缺少 Agent Action ID");
    const existing = this.database.prepare(`SELECT status,result_json,action_type FROM agent_actions
      WHERE id = ? AND user_id = ? AND run_id = ?`).get(action.id, userId, runId) as
      { status: string; result_json: string | null; action_type: string } | undefined;
    if (!existing) throw new Error("Agent 操作不存在或无权执行");
    if (existing.action_type !== action.actionType) throw new Error("Agent 操作类型与已保存提案不一致");
    if (existing.status === "executed") return existing.result_json ? JSON.parse(existing.result_json) : {};
    if (!new Set(["proposed", "awaiting_approval"]).has(existing.status)) throw new Error("Agent 操作当前状态不允许执行");
    const payload = action.payload;
    let before: unknown;
    let result: unknown;

    switch (action.actionType) {
      case "create_meal_plan": {
        const planId = randomUUID();
        const title = stringValue(payload.title, "AI 饮食计划").slice(0, 120);
        const startDate = stringValue(payload.startDate, currentDateKey());
        const endDate = stringValue(payload.endDate, startDate);
        this.database.prepare(`INSERT INTO meal_plans
          (id,user_id,title,start_date,end_date,status,constraints_json,created_by_run_id)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(
            planId, userId, title, startDate, endDate, JSON.stringify(payload.constraints || {}), runId,
          );
        const insertItem = this.database.prepare(`INSERT INTO meal_plan_items
          (id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json,calories,protein,carbs,fat)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const items = arrayValue(payload.items).slice(0, 70) as Array<Record<string, unknown>>;
        for (const item of items) {
          insertItem.run(
            randomUUID(), planId, userId, stringValue(item.date, startDate), stringValue(item.mealType, "晚餐"),
            stringValue(item.title, "健康餐"), Number.isInteger(Number(item.recipeId)) ? Number(item.recipeId) : null,
            JSON.stringify(arrayValue(item.ingredients)), JSON.stringify(arrayValue(item.steps)), nonNegativeNumber(item.calories),
            nonNegativeNumber(item.protein), nonNegativeNumber(item.carbs), nonNegativeNumber(item.fat),
          );
        }
        result = { planId, title, itemCount: items.length };
        break;
      }
      case "update_meal_plan": {
        const planId = stringValue(payload.planId);
        before = this.database.prepare("SELECT * FROM meal_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(planId, userId);
        if (!before) throw new Error("餐单不存在或无权修改");
        this.database.prepare(`UPDATE meal_plans SET title = COALESCE(?,title),start_date = COALESCE(?,start_date),
          end_date = COALESCE(?,end_date),constraints_json = COALESCE(?,constraints_json),version = version + 1,
          updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`).run(
            payload.title ? stringValue(payload.title).slice(0, 120) : null, payload.startDate ? stringValue(payload.startDate) : null,
            payload.endDate ? stringValue(payload.endDate) : null, payload.constraints ? JSON.stringify(payload.constraints) : null,
            planId, userId,
          );
        result = { planId };
        break;
      }
      case "add_shopping_items": {
        const ids: string[] = [];
        const insert = this.database.prepare(`INSERT INTO shopping_list_items
          (id,user_id,client_id,name,amount,category,purchase_date,storage_location,source_run_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const item of arrayValue(payload.items).slice(0, 100) as Array<Record<string, unknown>>) {
          const name = stringValue(item.name);
          if (!name) continue;
          const id = randomUUID();
          insert.run(id, userId, item.clientId ? stringValue(item.clientId) : null, name.slice(0, 120),
            stringValue(item.amount, "适量").slice(0, 80), stringValue(item.category, "其他").slice(0, 40),
            item.purchaseDate ? stringValue(item.purchaseDate) : null, item.storageLocation ? stringValue(item.storageLocation) : null, runId);
          ids.push(id);
        }
        result = { itemIds: ids, count: ids.length };
        break;
      }
      case "update_shopping_item": {
        const itemId = stringValue(payload.itemId);
        before = this.database.prepare("SELECT * FROM shopping_list_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(itemId, userId);
        if (!before) throw new Error("采购项不存在或无权修改");
        this.database.prepare(`UPDATE shopping_list_items SET name = COALESCE(?,name),amount = COALESCE(?,amount),category = COALESCE(?,category),
          checked = COALESCE(?,checked),purchase_date = COALESCE(?,purchase_date),storage_location = COALESCE(?,storage_location),
          version = version + 1,updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`).run(
            payload.name ? stringValue(payload.name).slice(0, 120) : null, payload.amount ? stringValue(payload.amount).slice(0, 80) : null,
            payload.category ? stringValue(payload.category).slice(0, 40) : null,
            typeof payload.checked === "boolean" ? (payload.checked ? 1 : 0) : null,
            payload.purchaseDate ? stringValue(payload.purchaseDate) : null,
            payload.storageLocation ? stringValue(payload.storageLocation) : null, itemId, userId,
          );
        result = { itemId };
        break;
      }
      case "delete_meal_plan": {
        const planId = stringValue(payload.planId);
        before = this.database.prepare("SELECT * FROM meal_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(planId, userId);
        if (!before) throw new Error("餐单不存在或无权删除");
        this.database.prepare(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP,status = 'cancelled',updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?`).run(planId, userId);
        result = { planId };
        break;
      }
      case "delete_shopping_item": {
        const itemId = stringValue(payload.itemId);
        before = this.database.prepare("SELECT * FROM shopping_list_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(itemId, userId);
        if (!before) throw new Error("采购项不存在或无权删除");
        this.database.prepare(`UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP,version = version + 1,updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ?`).run(itemId, userId);
        result = { itemId };
        break;
      }
      case "record_diet_meal": {
        const foodName = stringValue(payload.foodName);
        if (!foodName) throw new Error("缺少食物名称");
        const recordedAt = stringValue(payload.recordedAt, currentDateKey());
        const inserted = this.database.prepare(`INSERT INTO diet_records
          (user_id,meal_type,food_name,amount,calories,protein,carbs,fat,recorded_at,recorded_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            userId, stringValue(payload.mealType, "午餐"), foodName, stringValue(payload.amount, "1份"),
            nonNegativeInteger(payload.calories), nonNegativeNumber(payload.protein), nonNegativeNumber(payload.carbs),
            nonNegativeNumber(payload.fat), recordedAt,
            payload.recordedTime ? stringValue(payload.recordedTime) : recordedAt === currentDateKey() ? currentTimeKey() : null,
          );
        result = { dietRecordId: Number(inserted.lastInsertRowid) };
        break;
      }
      case "add_inventory_item": {
        const name = stringValue(payload.name);
        if (!name) throw new Error("缺少库存食材名称");
        const days = Math.max(1, Math.min(Number(payload.expireDays) || 7, 365));
        const inserted = this.database.prepare(`INSERT INTO inventory_items
          (user_id,food_name,category,quantity,expiration_date,storage_location,is_available) VALUES (?, ?, ?, ?, ?, ?, 1)`)
          .run(userId, name, stringValue(payload.category, "其他"), stringValue(payload.quantity, "1份"),
            dateKeyAfterDays(days), stringValue(payload.location, "冷藏"));
        result = { inventoryItemId: Number(inserted.lastInsertRowid) };
        break;
      }
      case "update_inventory_item": {
        const itemId = Number(payload.itemId);
        if (!Number.isInteger(itemId) || itemId <= 0) throw new Error("库存食材不存在或无权修改");
        before = this.database.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(itemId, userId);
        if (!before) throw new Error("库存食材不存在或无权修改");
        this.database.prepare(`UPDATE inventory_items SET food_name = COALESCE(?,food_name),category = COALESCE(?,category),
          quantity = COALESCE(?,quantity),expiration_date = COALESCE(?,expiration_date),storage_location = COALESCE(?,storage_location),
          is_available = COALESCE(?,is_available) WHERE id = ? AND user_id = ?`).run(
            payload.name ? stringValue(payload.name) : null, payload.category ? stringValue(payload.category) : null,
            payload.quantity ? stringValue(payload.quantity) : null, payload.expirationDate ? stringValue(payload.expirationDate) : null,
            payload.location ? stringValue(payload.location) : null,
            typeof payload.isAvailable === "boolean" ? (payload.isAvailable ? 1 : 0) : null, itemId, userId,
          );
        result = { inventoryItemId: itemId };
        break;
      }
      case "consume_inventory_items": {
        const ids = arrayValue(payload.itemIds).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 100);
        if (!ids.length) throw new Error("缺少需要消耗的库存项");
        const placeholders = ids.map(() => "?").join(",");
        before = this.database.prepare(`SELECT * FROM inventory_items WHERE user_id = ? AND id IN (${placeholders})`).all(userId, ...ids);
        this.database.prepare(`UPDATE inventory_items SET is_available = 0 WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...ids);
        result = { inventoryItemIds: ids };
        break;
      }
      case "add_kitchenware_item": {
        const name = stringValue(payload.name);
        if (!name) throw new Error("缺少厨具名称");
        const inserted = this.database.prepare(`INSERT INTO kitchenware_items (user_id,name,category,status,note) VALUES (?, ?, ?, ?, ?)`)
          .run(userId, name, stringValue(payload.category, "其他"), stringValue(payload.status, "良好"),
            stringValue(payload.note).slice(0, 300) || null);
        result = { kitchenwareItemId: Number(inserted.lastInsertRowid) };
        break;
      }
      case "submit_recipe": {
        const title = stringValue(payload.title);
        if (!title) throw new Error("缺少菜谱标题");
        const inserted = this.database.prepare(`INSERT INTO recipes
          (title,description,cook_time,difficulty,calories,protein,carbs,fat,category,tags,steps_json,ingredients_json,source,status,author_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', 'pending', ?)`).run(
            title, stringValue(payload.description), nonNegativeInteger(payload.cookTime) || 0, stringValue(payload.difficulty, "简单"),
            nonNegativeInteger(payload.calories) || 0, nonNegativeNumber(payload.protein) || 0, nonNegativeNumber(payload.carbs) || 0,
            nonNegativeNumber(payload.fat) || 0, stringValue(payload.category, "其他"), JSON.stringify(arrayValue(payload.tags)),
            JSON.stringify(arrayValue(payload.steps)), JSON.stringify(arrayValue(payload.ingredients)), userId,
          );
        result = { recipeId: Number(inserted.lastInsertRowid), status: "pending" };
        break;
      }
      case "record_health_log": {
        const values = [nonNegativeNumber(payload.weightKg), nonNegativeNumber(payload.bodyFatPercentage), nonNegativeInteger(payload.waterMl)];
        if (values.every((value) => value === null)) throw new Error("缺少可记录的健康数据");
        const inserted = this.database.prepare(`INSERT INTO health_logs (user_id,weight,body_fat,water_ml,recorded_date)
          VALUES (?, ?, ?, ?, ?)`).run(userId, values[0], values[1], values[2], stringValue(payload.recordedDate, currentDateKey()));
        result = { healthLogId: Number(inserted.lastInsertRowid) };
        break;
      }
      default:
        throw new Error(`不支持的 Agent 操作：${action.actionType}`);
    }

    this.updateActionStatus(action.id, userId, runId, "executed", before, result);
    return result;
  }

  private updateActionStatus(id: string, userId: number, runId: string, status: "executed" | "undone", before?: unknown, result?: unknown) {
    this.database.prepare(`UPDATE agent_actions SET status = ?,before_json = COALESCE(?,before_json),result_json = COALESCE(?,result_json),
      executed_at = CASE WHEN ? = 'executed' THEN CURRENT_TIMESTAMP ELSE executed_at END,
      undone_at = CASE WHEN ? = 'undone' THEN CURRENT_TIMESTAMP ELSE undone_at END,updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND run_id = ?`).run(
        status, before === undefined ? null : JSON.stringify(before), result === undefined ? null : JSON.stringify(result),
        status, status, id, userId, runId,
      );
  }

  private failAction(id: string, userId: number, runId: string, message: string) {
    this.database.prepare(`UPDATE agent_actions SET status = 'failed',result_json = ?,updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND run_id = ? AND status IN ('proposed','awaiting_approval')`)
      .run(JSON.stringify({ error: message }), id, userId, runId);
  }

  private parseObject(value: string | null) {
    if (!value) return undefined;
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  }
}
