import { randomUUID } from "node:crypto";
import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uuidParam } from "../middleware/validateParam.js";
import { db } from "../storage/db.js";
import { sendError } from "../utils/http.js";
import { inventoryOutcomeCreateSchema, inventoryOutcomeUpdateSchema } from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);
router.param("eventId", uuidParam);

type Row = Record<string, unknown>;
type Outcome = "cooked" | "used" | "discarded" | "expired" | "gifted" | "transferred" | "unknown";

function isHouseholdMember(householdId: number, userId: number) {
  return Boolean(db.prepare("SELECT id FROM household_members WHERE household_id = ? AND user_id = ?").get(householdId, userId));
}

function dateWindow(dateKey: string, timezoneOffsetMinutes: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const localMidnightUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + timezoneOffsetMinutes * 60_000;
  if (!Number.isFinite(localMidnightUtc)) return null;
  return {
    start: new Date(localMidnightUtc).toISOString(),
    end: new Date(localMidnightUtc + 7 * 86_400_000).toISOString(),
    previousStart: new Date(localMidnightUtc - 7 * 86_400_000).toISOString(),
  };
}

function sqliteTime(value: unknown) {
  const text = String(value || "");
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`;
}

function formatOutcomeEvent(row: Row) {
  return {
    id: String(row.id),
    traceType: "outcome" as const,
    itemId: Number(row.inventory_item_id ?? row.household_inventory_item_id),
    foodName: String(row.food_name || "未知食材"),
    category: String(row.category || "其他"),
    outcome: String(row.outcome) as Outcome,
    source: String(row.source),
    quantityValue: row.quantity_value === null ? null : Number(row.quantity_value),
    quantityUnit: row.quantity_unit ? String(row.quantity_unit) : null,
    quantityText: row.quantity_text ? String(row.quantity_text) : null,
    expirationDate: row.expiration_date ? String(row.expiration_date) : null,
    occurredAt: sqliteTime(row.occurred_at),
    version: Number(row.version),
    corrected: Number(row.version) > 1,
  };
}

function personalEvents(userId: number, from: string, to: string) {
  const explicit = (db.prepare(`SELECT e.*, i.food_name, i.category, i.expiration_date
    FROM inventory_outcome_events e JOIN inventory_items i ON i.id = e.inventory_item_id
    WHERE e.scope = 'personal' AND e.user_id = ? AND datetime(e.occurred_at) >= datetime(?) AND datetime(e.occurred_at) < datetime(?)`)
    .all(userId, from, to) as Row[]).map(formatOutcomeEvent);
  const changes = (db.prepare(`SELECT l.*, i.food_name, i.category, i.expiration_date
    FROM inventory_change_logs l JOIN inventory_items i ON i.id = l.inventory_item_id
    WHERE l.user_id = ? AND l.action IN ('consume_all', 'consume_partial')
      AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)`)
    .all(userId, from, to) as Row[]).map((row) => {
      const metadata = typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) as Row : {};
      return {
        id: `change:${row.id}`,
        traceType: "change_log" as const,
        itemId: Number(row.inventory_item_id),
        foodName: String(row.food_name),
        category: String(row.category || "其他"),
        outcome: (row.source === "cooking" ? "cooked" : "used") as Outcome,
        source: metadata.recipeId ? "recommendation" : String(row.source || "manual"),
        quantityValue: row.delta_value === null ? null : Math.abs(Number(row.delta_value)),
        quantityUnit: row.quantity_unit ? String(row.quantity_unit) : null,
        quantityText: null,
        expirationDate: row.expiration_date ? String(row.expiration_date) : null,
        occurredAt: sqliteTime(row.created_at),
        version: 1,
        corrected: false,
      };
    });
  return [...explicit, ...changes];
}

function householdEvents(householdId: number, from: string, to: string) {
  return (db.prepare(`SELECT e.*, i.food_name, i.category, i.expiration_date
    FROM inventory_outcome_events e JOIN household_inventory_items i ON i.id = e.household_inventory_item_id
    WHERE e.scope = 'household' AND e.household_id = ? AND datetime(e.occurred_at) >= datetime(?) AND datetime(e.occurred_at) < datetime(?)`)
    .all(householdId, from, to) as Row[]).map(formatOutcomeEvent);
}

function localDateAt(iso: string, offsetMinutes: number) {
  return new Date(Date.parse(iso) - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function summarize(events: ReturnType<typeof personalEvents>, timezoneOffsetMinutes: number) {
  const used = events.filter((event) => event.outcome === "cooked" || event.outcome === "used");
  const wasted = events.filter((event) => event.outcome === "discarded" || event.outcome === "expired");
  const timely = used.filter((event) => {
    if (!event.expirationDate) return false;
    const occurred = localDateAt(event.occurredAt, timezoneOffsetMinutes);
    const days = (Date.parse(`${event.expirationDate}T00:00:00Z`) - Date.parse(`${occurred}T00:00:00Z`)) / 86_400_000;
    return days >= 0 && days <= 3;
  });
  const prompted = used.filter((event) => event.source === "reminder" || event.source === "recommendation");
  const quantityTotals = { used: {} as Record<string, number>, wasted: {} as Record<string, number> };
  for (const [group, rows] of [["used", used], ["wasted", wasted]] as const) {
    for (const event of rows) {
      if (event.quantityValue === null || !event.quantityUnit) continue;
      quantityTotals[group][event.quantityUnit] = Math.round(((quantityTotals[group][event.quantityUnit] || 0) + event.quantityValue) * 1000) / 1000;
    }
  }
  return {
    usedCount: used.length,
    wastedCount: wasted.length,
    unknownCount: events.filter((event) => event.outcome === "unknown").length,
    giftedOrTransferredCount: events.filter((event) => event.outcome === "gifted" || event.outcome === "transferred").length,
    timelyUsedCount: timely.length,
    promptedUseCount: prompted.length,
    quantityTotals,
  };
}

router.post("/inventory-outcomes", validateBody(inventoryOutcomeCreateSchema), (req: AuthRequest, res) => {
  const userId = req.userId!;
  const householdId = req.body.householdId as number | undefined;
  if (req.body.scope === "household" && (!householdId || !isHouseholdMember(householdId, userId))) {
    return sendError(res, 404, "家庭库存不存在", "HOUSEHOLD_INVENTORY_NOT_FOUND");
  }
  const existing = req.body.scope === "personal"
    ? db.prepare("SELECT * FROM inventory_outcome_events WHERE user_id = ? AND idempotency_key = ?").get(userId, req.body.idempotencyKey) as Row | undefined
    : db.prepare("SELECT * FROM inventory_outcome_events WHERE household_id = ? AND idempotency_key = ?").get(householdId, req.body.idempotencyKey) as Row | undefined;
  if (existing) return res.json({ event: formatOutcomeEvent({ ...existing, food_name: "", category: "" }), repeated: true });

  const item = req.body.scope === "personal"
    ? db.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(req.body.itemId, userId) as Row | undefined
    : db.prepare("SELECT * FROM household_inventory_items WHERE id = ? AND household_id = ?").get(req.body.itemId, householdId) as Row | undefined;
  if (!item) return sendError(res, 404, "库存食材不存在", "INVENTORY_NOT_FOUND");
  if (req.body.itemVersion && Number(item.version || 1) !== req.body.itemVersion) {
    return sendError(res, 409, "库存已被更新，请刷新后重试", "INVENTORY_VERSION_CONFLICT");
  }
  try {
    const event = db.transaction(() => {
      const id = randomUUID();
      db.prepare(`INSERT INTO inventory_outcome_events
        (id, scope, user_id, household_id, inventory_item_id, household_inventory_item_id,
         outcome, source, quantity_value, quantity_unit, quantity_text, idempotency_key, occurred_at,
         created_by_user_id, updated_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)`)
        .run(
          id, req.body.scope, req.body.scope === "personal" ? userId : null, householdId ?? null,
          req.body.scope === "personal" ? req.body.itemId : null,
          req.body.scope === "household" ? req.body.itemId : null,
          req.body.outcome, req.body.source, item.quantity_value ?? null, item.quantity_unit ?? null,
          item.quantity ?? null, req.body.idempotencyKey, req.body.occurredAt ?? null, userId, userId,
        );
      if (req.body.closeItem) {
        const table = req.body.scope === "personal" ? "inventory_items" : "household_inventory_items";
        const ownerColumn = req.body.scope === "personal" ? "user_id" : "household_id";
        const ownerId = req.body.scope === "personal" ? userId : householdId;
        const deletedClause = req.body.scope === "personal" ? ", deleted_at = CURRENT_TIMESTAMP" : "";
        const closed = db.prepare(`UPDATE ${table} SET is_available = 0, version = version + 1, updated_at = CURRENT_TIMESTAMP${deletedClause}
          WHERE id = ? AND ${ownerColumn} = ? AND version = ?`)
          .run(req.body.itemId, ownerId, Number(item.version || 1));
        if (closed.changes !== 1) throw new Error("VERSION_CONFLICT");
      }
      return formatOutcomeEvent({ ...db.prepare("SELECT * FROM inventory_outcome_events WHERE id = ?").get(id) as Row, food_name: item.food_name, category: item.category, expiration_date: item.expiration_date });
    })();
    return res.status(201).json({ event, repeated: false });
  } catch (error) {
    if (error instanceof Error && error.message === "VERSION_CONFLICT") return sendError(res, 409, "库存已被更新，请刷新后重试", "INVENTORY_VERSION_CONFLICT");
    throw error;
  }
});

router.patch("/inventory-outcomes/:eventId", validateBody(inventoryOutcomeUpdateSchema), (req: AuthRequest, res) => {
  const event = db.prepare("SELECT * FROM inventory_outcome_events WHERE id = ?").get(req.params.eventId) as Row | undefined;
  if (!event) return sendError(res, 404, "结果记录不存在", "OUTCOME_NOT_FOUND");
  const allowed = event.scope === "personal"
    ? Number(event.user_id) === req.userId!
    : isHouseholdMember(Number(event.household_id), req.userId!);
  if (!allowed) return sendError(res, 404, "结果记录不存在", "OUTCOME_NOT_FOUND");
  const changed = db.prepare(`UPDATE inventory_outcome_events SET outcome = ?, updated_by_user_id = ?,
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?`)
    .run(req.body.outcome, req.userId!, req.params.eventId, req.body.version);
  if (changed.changes !== 1) return sendError(res, 409, "结果分类已更新，请刷新后重试", "OUTCOME_VERSION_CONFLICT");
  const itemTable = event.scope === "personal" ? "inventory_items" : "household_inventory_items";
  const itemColumn = event.scope === "personal" ? "inventory_item_id" : "household_inventory_item_id";
  const row = db.prepare(`SELECT e.*, i.food_name, i.category, i.expiration_date FROM inventory_outcome_events e
    JOIN ${itemTable} i ON i.id = e.${itemColumn} WHERE e.id = ?`).get(req.params.eventId) as Row;
  return res.json(formatOutcomeEvent(row));
});

router.get("/inventory-outcomes/weekly", (req: AuthRequest, res) => {
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : "";
  const offset = Math.max(-840, Math.min(840, Number(req.query.timezoneOffsetMinutes) || 0));
  const window = dateWindow(weekStart, offset);
  if (!window) return sendError(res, 400, "周起始日期格式无效", "INVALID_WEEK_START");
  const scope = req.query.scope === "household" ? "household" : "personal";
  const householdId = Number(req.query.householdId);
  if (scope === "household" && (!Number.isInteger(householdId) || !isHouseholdMember(householdId, req.userId!))) {
    return sendError(res, 404, "家庭报告不存在", "HOUSEHOLD_REPORT_NOT_FOUND");
  }
  const loader = (from: string, to: string) => scope === "personal"
    ? personalEvents(req.userId!, from, to)
    : householdEvents(householdId, from, to);
  const events = loader(window.start, window.end);
  const previousEvents = loader(window.previousStart, window.start);
  const summary = summarize(events, offset);
  const previous = summarize(previousEvents, offset);
  const actionable = scope === "personal"
    ? db.prepare(`SELECT category, COUNT(*) AS count FROM inventory_items WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL
        AND expiration_date >= ? AND expiration_date <= date(?, '+3 day') GROUP BY category ORDER BY count DESC LIMIT 1`)
      .get(req.userId!, weekStart, weekStart) as { category: string; count: number } | undefined
    : db.prepare(`SELECT category, COUNT(*) AS count FROM household_inventory_items WHERE household_id = ? AND is_available = 1
        AND expiration_date >= ? AND expiration_date <= date(?, '+3 day') GROUP BY category ORDER BY count DESC LIMIT 1`)
      .get(householdId, weekStart, weekStart) as { category: string; count: number } | undefined;
  const knownQuantityEvents = events.filter((event) => event.quantityValue !== null && event.quantityUnit);
  return res.json({
    scope,
    householdId: scope === "household" ? householdId : null,
    weekStart,
    weekEndExclusive: localDateAt(window.end, offset),
    summary,
    previousSummary: previous,
    trend: {
      usedDelta: summary.usedCount - previous.usedCount,
      wastedDelta: summary.wastedCount - previous.wastedCount,
      timelyUsedDelta: summary.timelyUsedCount - previous.timelyUsedCount,
    },
    events,
    advice: actionable ? `未来 3 天有 ${actionable.count} 项${actionable.category}库存到期，可优先安排相关餐次。` : "暂时没有需要立即处理的临期库存，保持按需采购即可。",
    dataQuality: events.length === 0 ? "empty" : knownQuantityEvents.length === events.length ? "structured" : "partial",
    money: null,
    moneyMessage: "未记录可靠单价，因此不展示节约或浪费金额。",
  });
});

export default router;
