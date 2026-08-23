import { randomUUID } from "node:crypto";
import { db } from "../../storage/db.js";
import { currentDateKey, currentTimeKey, dateKeyAfterDays } from "../../utils/date.js";
import { getRunActions, updateActionStatus } from "./repository.js";
import type { AgentActionProposal } from "./types.js";

function str(value: unknown, fallback = "") { return String(value ?? fallback).trim(); }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function json(value: unknown, fallback: unknown[] = []) { return Array.isArray(value) ? value : fallback; }
function sqliteTimestampMs(value: string | undefined) {
  if (!value) return Number.NaN;
  const normalized = value.replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
}

function executeAction(userId: number, runId: string, action: AgentActionProposal & { id?: string }) {
  if (!action.id) throw new Error("缺少 Agent Action ID");
  const existing = db.prepare("SELECT status, result_json FROM agent_actions WHERE id = ? AND user_id = ?").get(action.id, userId) as { status: string; result_json: string | null } | undefined;
  if (!existing) throw new Error("Agent 操作不存在或无权执行");
  if (existing.status === "executed") return existing.result_json ? JSON.parse(existing.result_json) : {};
  const payload = action.payload;
  let before: unknown;
  let result: unknown;

  switch (action.actionType) {
    case "create_meal_plan": {
      const planId = randomUUID();
      const title = str(payload.title, "AI 饮食计划").slice(0, 120);
      const startDate = str(payload.startDate, currentDateKey());
      const endDate = str(payload.endDate, startDate);
      db.prepare(`INSERT INTO meal_plans (id, user_id, title, start_date, end_date, status, constraints_json, created_by_run_id)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(planId, userId, title, startDate, endDate, JSON.stringify(payload.constraints || {}), runId);
      const insertItem = db.prepare(`INSERT INTO meal_plan_items
        (id, plan_id, user_id, planned_date, meal_type, title, recipe_id, ingredients_json, steps_json, calories, protein, carbs, fat)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const items = json(payload.items).slice(0, 70) as Array<Record<string, unknown>>;
      for (const item of items) {
        insertItem.run(randomUUID(), planId, userId, str(item.date, startDate), str(item.mealType, "晚餐"), str(item.title, "健康餐"),
          Number.isInteger(Number(item.recipeId)) ? Number(item.recipeId) : null, JSON.stringify(json(item.ingredients)), JSON.stringify(json(item.steps)),
          num(item.calories), num(item.protein), num(item.carbs), num(item.fat));
      }
      result = { planId, title, itemCount: items.length };
      break;
    }
    case "update_meal_plan": {
      const planId = str(payload.planId);
      before = db.prepare("SELECT * FROM meal_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(planId, userId);
      if (!before) throw new Error("餐单不存在或无权修改");
      db.prepare(`UPDATE meal_plans SET title = COALESCE(?, title), start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date), constraints_json = COALESCE(?, constraints_json),
        version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`).run(
          payload.title ? str(payload.title).slice(0, 120) : null,
          payload.startDate ? str(payload.startDate) : null,
          payload.endDate ? str(payload.endDate) : null,
          payload.constraints ? JSON.stringify(payload.constraints) : null,
          planId, userId,
        );
      result = { planId };
      break;
    }
    case "add_shopping_items": {
      const ids: string[] = [];
      const insert = db.prepare(`INSERT INTO shopping_list_items
        (id, user_id, client_id, name, amount, category, purchase_date, storage_location, source_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const item of (json(payload.items).slice(0, 100) as Array<Record<string, unknown>>)) {
        const name = str(item.name);
        if (!name) continue;
        const id = randomUUID();
        insert.run(id, userId, item.clientId ? str(item.clientId) : null, name.slice(0, 120), str(item.amount, "适量").slice(0, 80),
          str(item.category, "其他").slice(0, 40), item.purchaseDate ? str(item.purchaseDate) : null,
          item.storageLocation ? str(item.storageLocation) : null, runId);
        ids.push(id);
      }
      result = { itemIds: ids, count: ids.length };
      break;
    }
    case "update_shopping_item": {
      const itemId = str(payload.itemId);
      before = db.prepare("SELECT * FROM shopping_list_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(itemId, userId);
      if (!before) throw new Error("采购项不存在或无权修改");
      db.prepare(`UPDATE shopping_list_items SET name = COALESCE(?, name), amount = COALESCE(?, amount), category = COALESCE(?, category),
        checked = COALESCE(?, checked), purchase_date = COALESCE(?, purchase_date), storage_location = COALESCE(?, storage_location),
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`).run(
          payload.name ? str(payload.name).slice(0, 120) : null, payload.amount ? str(payload.amount).slice(0, 80) : null,
          payload.category ? str(payload.category).slice(0, 40) : null, typeof payload.checked === "boolean" ? (payload.checked ? 1 : 0) : null,
          payload.purchaseDate ? str(payload.purchaseDate) : null, payload.storageLocation ? str(payload.storageLocation) : null, itemId, userId,
        );
      result = { itemId };
      break;
    }
    case "delete_meal_plan": {
      const planId = str(payload.planId);
      before = db.prepare("SELECT * FROM meal_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(planId, userId);
      if (!before) throw new Error("餐单不存在或无权删除");
      db.prepare("UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(planId, userId);
      result = { planId };
      break;
    }
    case "delete_shopping_item": {
      const itemId = str(payload.itemId);
      before = db.prepare("SELECT * FROM shopping_list_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(itemId, userId);
      if (!before) throw new Error("采购项不存在或无权删除");
      db.prepare("UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(itemId, userId);
      result = { itemId };
      break;
    }
    case "record_diet_meal": {
      const foodName = str(payload.foodName);
      if (!foodName) throw new Error("缺少食物名称");
      const recordedAt = str(payload.recordedAt, currentDateKey());
      const inserted = db.prepare(`INSERT INTO diet_records
        (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, str(payload.mealType, "午餐"), foodName, str(payload.amount, "1份"), num(payload.calories), num(payload.protein),
          num(payload.carbs), num(payload.fat), recordedAt, payload.recordedTime ? str(payload.recordedTime) : recordedAt === currentDateKey() ? currentTimeKey() : null);
      result = { dietRecordId: Number(inserted.lastInsertRowid) };
      break;
    }
    case "add_inventory_item": {
      const name = str(payload.name);
      if (!name) throw new Error("缺少库存食材名称");
      const days = Math.max(1, Math.min(Number(payload.expireDays) || 7, 365));
      const inserted = db.prepare(`INSERT INTO inventory_items
        (user_id, food_name, category, quantity, expiration_date, storage_location, is_available)
        VALUES (?, ?, ?, ?, ?, ?, 1)`).run(userId, name, str(payload.category, "其他"), str(payload.quantity, "1份"), dateKeyAfterDays(days), str(payload.location, "冷藏"));
      result = { inventoryItemId: Number(inserted.lastInsertRowid) };
      break;
    }
    case "update_inventory_item": {
      const itemId = Number(payload.itemId);
      before = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(itemId, userId);
      if (!before) throw new Error("库存食材不存在或无权修改");
      db.prepare(`UPDATE inventory_items SET food_name = COALESCE(?, food_name), category = COALESCE(?, category), quantity = COALESCE(?, quantity),
        expiration_date = COALESCE(?, expiration_date), storage_location = COALESCE(?, storage_location), is_available = COALESCE(?, is_available)
        WHERE id = ? AND user_id = ?`).run(payload.name ? str(payload.name) : null, payload.category ? str(payload.category) : null,
          payload.quantity ? str(payload.quantity) : null, payload.expirationDate ? str(payload.expirationDate) : null,
          payload.location ? str(payload.location) : null, typeof payload.isAvailable === "boolean" ? (payload.isAvailable ? 1 : 0) : null, itemId, userId);
      result = { inventoryItemId: itemId };
      break;
    }
    case "consume_inventory_items": {
      const ids = json(payload.itemIds).map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 100);
      if (!ids.length) throw new Error("缺少需要消耗的库存项");
      const placeholders = ids.map(() => "?").join(",");
      before = db.prepare(`SELECT * FROM inventory_items WHERE user_id = ? AND id IN (${placeholders})`).all(userId, ...ids);
      db.prepare(`UPDATE inventory_items SET is_available = 0 WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...ids);
      result = { inventoryItemIds: ids };
      break;
    }
    case "add_kitchenware_item": {
      const name = str(payload.name);
      if (!name) throw new Error("缺少厨具名称");
      const inserted = db.prepare("INSERT INTO kitchenware_items (user_id, name, category, status, note) VALUES (?, ?, ?, ?, ?)")
        .run(userId, name, str(payload.category, "其他"), str(payload.status, "良好"), str(payload.note).slice(0, 300) || null);
      result = { kitchenwareItemId: Number(inserted.lastInsertRowid) };
      break;
    }
    case "submit_recipe": {
      const title = str(payload.title);
      if (!title) throw new Error("缺少菜谱标题");
      const inserted = db.prepare(`INSERT INTO recipes
        (title, description, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json, source, status, author_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', 'pending', ?)`)
        .run(title, str(payload.description), num(payload.cookTime) || 0, str(payload.difficulty, "简单"), num(payload.calories) || 0,
          num(payload.protein) || 0, num(payload.carbs) || 0, num(payload.fat) || 0, str(payload.category, "其他"),
          JSON.stringify(json(payload.tags)), JSON.stringify(json(payload.steps)), JSON.stringify(json(payload.ingredients)), userId);
      result = { recipeId: Number(inserted.lastInsertRowid), status: "pending" };
      break;
    }
    case "record_health_log": {
      const values = [num(payload.weightKg), num(payload.bodyFatPercentage), num(payload.waterMl)];
      if (values.every((value) => value === null)) throw new Error("缺少可记录的健康数据");
      const date = str(payload.recordedDate, currentDateKey());
      const inserted = db.prepare("INSERT INTO health_logs (user_id, weight, body_fat, water_ml, recorded_date) VALUES (?, ?, ?, ?, ?)")
        .run(userId, values[0], values[1], values[2], date);
      result = { healthLogId: Number(inserted.lastInsertRowid) };
      break;
    }
    default:
      throw new Error(`不支持的 Agent 操作：${action.actionType}`);
  }

  updateActionStatus(action.id, "executed", { before, result });
  return result;
}

export function executeAgentActions(userId: number, runId: string, proposals: Array<AgentActionProposal & { id?: string }>) {
  try {
    return db.transaction(() => {
      const run = db.prepare("SELECT status FROM agent_runs WHERE id = ? AND user_id = ?").get(runId, userId) as { status: string } | undefined;
      if (!run || run.status !== "running") throw new Error("Agent Run 已取消或不再允许执行操作");
      return proposals.map((proposal) => ({ actionId: proposal.id, result: executeAction(userId, runId, proposal) }));
    })();
  } catch (error) {
    // The transaction rolls back both domain writes and interim action statuses.
    // Persist a terminal action state afterwards so an execution failure cannot
    // leave an already-approved proposal looking like it still awaits approval.
    for (const proposal of proposals) {
      if (proposal.id) updateActionStatus(proposal.id, "failed", { result: { error: error instanceof Error ? error.message : "执行失败" } });
    }
    throw error;
  }
}

export function undoAgentRunActions(userId: number, runId: string) {
  const reversible = new Set(["create_meal_plan", "update_meal_plan", "add_shopping_items", "update_shopping_item"]);
  const actions = getRunActions(runId, userId).filter((action) => action.status === "executed" && reversible.has(action.actionType));
  if (!actions.length) throw new Error("没有可撤销的 Agent 操作");
  const latest = Math.max(...actions.map((action) => sqliteTimestampMs(action.executedAt || action.createdAt)));
  if (!Number.isFinite(latest) || Date.now() - latest > 10 * 60_000) throw new Error("撤销窗口已过期");
  return db.transaction(() => {
    for (const action of [...actions].reverse()) {
      const result = action.result as Record<string, unknown> | undefined;
      const before = action.before as Record<string, unknown> | undefined;
      if (action.actionType === "create_meal_plan" && result?.planId) {
        const changed = db.prepare(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled', version = version + 1
          WHERE id = ? AND user_id = ? AND created_by_run_id = ? AND version = 1 AND deleted_at IS NULL`).run(result.planId, userId, runId).changes;
        if (changed !== 1) throw new Error("餐单已在 Agent 执行后发生变化，无法安全撤销");
      } else if (action.actionType === "add_shopping_items" && Array.isArray(result?.itemIds)) {
        for (const id of result.itemIds) {
          const changed = db.prepare(`UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP, version = version + 1
            WHERE id = ? AND user_id = ? AND source_run_id = ? AND version = 1 AND deleted_at IS NULL`).run(id, userId, runId).changes;
          if (changed !== 1) throw new Error("采购项已在 Agent 执行后发生变化，无法安全撤销");
        }
      } else if (action.actionType === "update_shopping_item" && before?.id) {
        const expectedVersion = Number(before.version) + 1;
        const changed = db.prepare(`UPDATE shopping_list_items SET name = ?, amount = ?, category = ?, checked = ?, purchase_date = ?, storage_location = ?,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
          .run(before.name, before.amount, before.category, before.checked, before.purchase_date, before.storage_location, before.id, userId, expectedVersion).changes;
        if (changed !== 1) throw new Error("采购项已在 Agent 执行后发生变化，无法安全撤销");
      } else if (action.actionType === "update_meal_plan" && before?.id) {
        const expectedVersion = Number(before.version) + 1;
        const changed = db.prepare(`UPDATE meal_plans SET title = ?, start_date = ?, end_date = ?, status = ?, constraints_json = ?,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
          .run(before.title, before.start_date, before.end_date, before.status, before.constraints_json, before.id, userId, expectedVersion).changes;
        if (changed !== 1) throw new Error("餐单已在 Agent 执行后发生变化，无法安全撤销");
      } else {
        throw new Error(`操作 ${action.actionType} 不支持自动撤销`);
      }
      updateActionStatus(action.id, "undone");
    }
    return { undone: actions.length };
  })();
}
