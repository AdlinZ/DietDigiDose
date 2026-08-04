import { randomUUID } from "node:crypto";
import { db } from "../storage/db.js";
import { currentDateKey, dateKeyAfterDays } from "../utils/date.js";

export type AIWriteAction = "record_diet_meal" | "add_inventory_item" | "add_kitchenware_item" | "record_health_log";

type ConfirmationRow = {
  id: string;
  user_id: number;
  action: AIWriteAction;
  payload_json: string;
  status: "preview" | "committed" | "expired" | "cancelled";
  committed_result_json: string | null;
  expires_at: string;
};

export function createAIWritePreview(params: {
  userId: number;
  action: AIWriteAction;
  payload: Record<string, unknown>;
  conversationId?: string;
  sourceMessageId?: string;
}): { confirmationId: string; action: AIWriteAction; payload: Record<string, unknown>; expiresAt: string } {
  const confirmationId = randomUUID();
  db.prepare(`
    INSERT INTO ai_write_confirmations (id, user_id, conversation_id, source_message_id, action, payload_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+15 minutes'))
  `).run(confirmationId, params.userId, params.conversationId || null, params.sourceMessageId || null, params.action, JSON.stringify(params.payload));
  const row = db.prepare("SELECT expires_at FROM ai_write_confirmations WHERE id = ?").get(confirmationId) as { expires_at: string };
  writeAudit(confirmationId, params.userId, params.action, "preview_created", { payload: params.payload });
  return { confirmationId, action: params.action, payload: params.payload, expiresAt: row.expires_at };
}

export function commitAIWritePreview(params: { userId: number; confirmationId: string; idempotencyKey: string }) {
  const confirmation = db.prepare("SELECT * FROM ai_write_confirmations WHERE id = ? AND user_id = ?").get(params.confirmationId, params.userId) as ConfirmationRow | undefined;
  if (!confirmation) throw new Error("确认记录不存在或无权操作");
  if (confirmation.status === "committed") return JSON.parse(confirmation.committed_result_json || "{}");
  if (confirmation.status !== "preview") throw new Error("该确认记录已失效");
  if (Date.parse(confirmation.expires_at) <= Date.now()) {
    db.prepare("UPDATE ai_write_confirmations SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(confirmation.id);
    writeAudit(confirmation.id, params.userId, confirmation.action, "preview_expired");
    throw new Error("确认已过期，请重新发起操作");
  }

  const existing = db.prepare("SELECT committed_result_json FROM ai_write_confirmations WHERE user_id = ? AND idempotency_key = ? AND status = 'committed'")
    .get(params.userId, params.idempotencyKey) as { committed_result_json: string } | undefined;
  if (existing) return JSON.parse(existing.committed_result_json);

  const payload = JSON.parse(confirmation.payload_json) as Record<string, unknown>;
  const result = db.transaction(() => {
    const committed = executeConfirmedWrite(params.userId, confirmation.action, payload);
    db.prepare(`UPDATE ai_write_confirmations
      SET status = 'committed', idempotency_key = ?, committed_result_json = ?, committed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'preview'`).run(params.idempotencyKey, JSON.stringify(committed), confirmation.id);
    writeAudit(confirmation.id, params.userId, confirmation.action, "committed", { result: committed });
    return committed;
  })();
  return result;
}

function executeConfirmedWrite(userId: number, action: AIWriteAction, payload: Record<string, unknown>) {
  if (action === "record_diet_meal") {
    const mealType = ["早餐", "午餐", "晚餐", "加餐"].includes(String(payload.mealType)) ? String(payload.mealType) : "午餐";
    const foodName = String(payload.foodName || "").trim();
    if (!foodName) throw new Error("缺少食物名称");
    const recordedAt = typeof payload.recordedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.recordedAt) ? payload.recordedAt : currentDateKey();
    const result = db.prepare(`INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, mealType, foodName, String(payload.amount || "1份"), numberOrNull(payload.calories), numberOrNull(payload.protein), numberOrNull(payload.carbs), numberOrNull(payload.fat), recordedAt);
    return { action, id: Number(result.lastInsertRowid), message: `已记录${mealType}：${foodName}` };
  }
  if (action === "add_inventory_item") {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("缺少食材名称");
    const location = ["冷藏", "冷冻", "常温"].includes(String(payload.location)) ? String(payload.location) : "冷藏";
    const days = Math.max(1, Math.min(Number(payload.expireDays) || 7, 365));
    const result = db.prepare(`INSERT INTO inventory_items (user_id, food_name, category, storage_location, quantity, expiration_date)
      VALUES (?, ?, ?, ?, ?, ?)`).run(userId, name, String(payload.category || "其他"), location, String(payload.quantity || "1份"), dateKeyAfterDays(days));
    return { action, id: Number(result.lastInsertRowid), message: `已加入库存：${name}` };
  }
  if (action === "add_kitchenware_item") {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("缺少厨具名称");
    const category = ["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].includes(String(payload.category)) ? String(payload.category) : "其他";
    const status = ["常用", "良好", "需保养", "维修中", "闲置"].includes(String(payload.status)) ? String(payload.status) : "良好";
    const result = db.prepare("INSERT INTO kitchenware_items (user_id, name, category, status, note) VALUES (?, ?, ?, ?, ?)")
      .run(userId, name, category, status, String(payload.note || "").slice(0, 300) || null);
    return { action, id: Number(result.lastInsertRowid), message: `已加入厨具：${name}` };
  }
  if (action === "record_health_log") {
    const existing = db.prepare("SELECT id FROM health_logs WHERE user_id = ? AND recorded_date = ?").get(userId, currentDateKey()) as { id: number } | undefined;
    const values = [numberOrNull(payload.weightKg), numberOrNull(payload.bodyFatPercentage), numberOrNull(payload.waterMl)];
    if (values.every((value) => value === null)) throw new Error("缺少可记录的健康数据");
    if (existing) db.prepare("UPDATE health_logs SET weight = COALESCE(?, weight), body_fat = COALESCE(?, body_fat), water_ml = COALESCE(?, water_ml) WHERE id = ?").run(...values, existing.id);
    else db.prepare("INSERT INTO health_logs (user_id, weight, body_fat, water_ml, recorded_date) VALUES (?, ?, ?, ?, ?)").run(userId, ...values, currentDateKey());
    return { action, message: "健康数据已更新" };
  }
  throw new Error("不支持的写入操作");
}

function numberOrNull(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function writeAudit(confirmationId: string, userId: number, action: AIWriteAction, event: string, details?: unknown) {
  db.prepare("INSERT INTO ai_write_audit_logs (confirmation_id, user_id, action, event, details_json) VALUES (?, ?, ?, ?, ?)")
    .run(confirmationId, userId, action, event, details === undefined ? null : JSON.stringify(details));
}
