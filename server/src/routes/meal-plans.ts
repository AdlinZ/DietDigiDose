import { randomUUID } from "node:crypto";
import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uuidParam } from "../middleware/validateParam.js";
import { db } from "../storage/db.js";
import { currentDateKey, currentTimeKey } from "../utils/date.js";
import { sendError } from "../utils/http.js";
import {
  mealPlanCompleteSchema,
  mealPlanItemUpdateSchema,
  mealPlanQueueSchema,
  mealPlanShoppingSchema,
  mealPlanUpdateSchema,
  mealPlanVersionSchema,
} from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);
router.param("id", uuidParam);
router.param("itemId", uuidParam);

type Row = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function ingredient(value: unknown) {
  if (typeof value === "string") return { name: value.trim(), amount: "适量" };
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const name = String(item.name || item.food_name || "").trim();
  return name ? { name, amount: String(item.amount || item.quantity || "适量").trim() || "适量" } : null;
}

function normalizedName(value: string) {
  return value.toLocaleLowerCase().replace(/\([^)]*\)|（[^）]*）/g, "").replace(/[\d\s.,，。克千毫升斤个只颗片份盒包袋瓶罐根勺]/g, "");
}

function queueMealType(value: unknown) {
  const aliases: Record<string, "breakfast" | "lunch" | "dinner" | "snack"> = {
    早餐: "breakfast", 午餐: "lunch", 晚餐: "dinner", 加餐: "snack",
    breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "snack",
  };
  return aliases[String(value)] || null;
}

const itemSelect = `
  SELECT i.*, r.title AS recipe_title, r.image_url AS recipe_image_url,
    r.cook_time AS recipe_cook_time, r.difficulty AS recipe_difficulty,
    r.status AS recipe_status, r.deleted_at AS recipe_deleted_at
  FROM meal_plan_items i
  LEFT JOIN recipes r ON r.id = i.recipe_id
`;

function formatItem(row: Row) {
  const ingredients = parseJson<unknown[]>(row.ingredients_json, []).map(ingredient).filter(Boolean);
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    plannedDate: String(row.planned_date),
    mealType: String(row.meal_type),
    title: String(row.recipe_title || row.title),
    recipeId: row.recipe_id === null ? null : Number(row.recipe_id),
    recipeAvailable: row.recipe_id === null || (row.recipe_status === "approved" && !row.recipe_deleted_at),
    recipeImageUrl: row.recipe_image_url ? String(row.recipe_image_url) : null,
    cookTime: Number(row.recipe_cook_time || 0),
    difficulty: row.recipe_difficulty ? String(row.recipe_difficulty) : null,
    ingredients,
    steps: parseJson<unknown[]>(row.steps_json, []),
    nutrition: {
      calories: row.calories === null ? null : Number(row.calories),
      protein: row.protein === null ? null : Number(row.protein),
      carbs: row.carbs === null ? null : Number(row.carbs),
      fat: row.fat === null ? null : Number(row.fat),
    },
    status: String(row.status || "planned"),
    version: Number(row.version || 1),
    dietRecordId: row.diet_record_id === null ? null : Number(row.diet_record_id),
    queueItemId: row.queue_item_id ? String(row.queue_item_id) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
  };
}

function getItems(planId: string, userId: number) {
  return (db.prepare(`${itemSelect}
    WHERE i.plan_id = ? AND i.user_id = ? AND i.deleted_at IS NULL
    ORDER BY i.planned_date, CASE i.meal_type WHEN '早餐' THEN 0 WHEN '午餐' THEN 1 WHEN '晚餐' THEN 2 ELSE 3 END, i.id`)
    .all(planId, userId) as Row[]).map(formatItem);
}

function formatPlan(row: Row, userId: number) {
  const archived = Boolean(row.deleted_at);
  return {
    id: String(row.id),
    title: String(row.title),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    status: String(row.status),
    source: String(row.source || "manual"),
    createdByRunId: row.created_by_run_id ? String(row.created_by_run_id) : null,
    constraints: parseJson<Record<string, unknown>>(row.constraints_json, {}),
    version: Number(row.version || 1),
    undoState: archived && row.source === "agent" ? "undone" : "active",
    archived,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items: getItems(String(row.id), userId),
  };
}

function getPlan(id: string, userId: number, includeArchived = false) {
  return db.prepare(`SELECT * FROM meal_plans WHERE id = ? AND user_id = ?${includeArchived ? "" : " AND deleted_at IS NULL"}`)
    .get(id, userId) as Row | undefined;
}

function getItem(planId: string, itemId: string, userId: number) {
  return db.prepare(`${itemSelect} WHERE i.id = ? AND i.plan_id = ? AND i.user_id = ? AND i.deleted_at IS NULL`)
    .get(itemId, planId, userId) as Row | undefined;
}

function versionConflict(res: Parameters<typeof sendError>[0]) {
  return sendError(res, 409, "餐单已在其他设备更新，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT");
}

function repeatedExecution(userId: number, idempotencyKey: string) {
  const row = db.prepare("SELECT result_json FROM meal_plan_execution_requests WHERE user_id = ? AND idempotency_key = ?")
    .get(userId, idempotencyKey) as { result_json: string } | undefined;
  return row ? { ...JSON.parse(row.result_json), repeated: true } : null;
}

function saveExecution(userId: number, key: string, action: string, itemId: string, result: unknown) {
  db.prepare(`INSERT INTO meal_plan_execution_requests
    (user_id, idempotency_key, action, meal_plan_item_id, result_json) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, key, action, itemId, JSON.stringify(result));
}

router.get("/", (req: AuthRequest, res) => {
  const includeArchived = req.query.includeArchived === "true";
  const rows = db.prepare(`SELECT * FROM meal_plans WHERE user_id = ?${includeArchived ? "" : " AND deleted_at IS NULL"}
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, start_date DESC, created_at DESC`)
    .all(req.userId!) as Row[];
  return res.json(rows.map((plan) => formatPlan(plan, req.userId!)));
});

router.get("/:id", (req: AuthRequest, res) => {
  const plan = getPlan(String(req.params.id), req.userId!, req.query.includeArchived === "true");
  if (!plan) return sendError(res, 404, "餐单不存在", "MEAL_PLAN_NOT_FOUND");
  return res.json(formatPlan(plan, req.userId!));
});

router.patch("/:id", validateBody(mealPlanUpdateSchema), (req: AuthRequest, res) => {
  const current = getPlan(String(req.params.id), req.userId!);
  if (!current) return sendError(res, 404, "餐单不存在", "MEAL_PLAN_NOT_FOUND");
  const startDate = req.body.startDate ?? current.start_date;
  const endDate = req.body.endDate ?? current.end_date;
  if (String(startDate) > String(endDate)) return sendError(res, 400, "结束日期不能早于开始日期", "INVALID_DATE_RANGE");
  const changed = db.prepare(`UPDATE meal_plans SET title = ?, start_date = ?, end_date = ?, status = ?,
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
    .run(req.body.title ?? current.title, startDate, endDate, req.body.status ?? current.status, req.params.id, req.userId!, req.body.version);
  if (changed.changes !== 1) return versionConflict(res);
  return res.json(formatPlan(getPlan(String(req.params.id), req.userId!)!, req.userId!));
});

router.delete("/:id", validateBody(mealPlanVersionSchema), (req: AuthRequest, res) => {
  const changed = db.prepare(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled',
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
    .run(req.params.id, req.userId!, req.body.version);
  if (changed.changes !== 1) {
    return getPlan(String(req.params.id), req.userId!) ? versionConflict(res) : sendError(res, 404, "餐单不存在", "MEAL_PLAN_NOT_FOUND");
  }
  return res.json({ deleted: true });
});

router.patch("/:id/items/:itemId", validateBody(mealPlanItemUpdateSchema), (req: AuthRequest, res) => {
  const current = getItem(String(req.params.id), String(req.params.itemId), req.userId!);
  if (!current) return sendError(res, 404, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND");
  let replacement: Row | undefined;
  if (req.body.recipeId !== undefined && req.body.recipeId !== null) {
    replacement = db.prepare(`SELECT id, title, ingredients_json, steps_json, calories, protein, carbs, fat
      FROM recipes WHERE id = ? AND status = 'approved' AND deleted_at IS NULL`).get(req.body.recipeId) as Row | undefined;
    if (!replacement) return sendError(res, 404, "替换菜谱不存在或不可用", "RECIPE_NOT_AVAILABLE");
  }
  const changed = db.prepare(`UPDATE meal_plan_items SET planned_date = ?, meal_type = ?, recipe_id = ?, title = ?,
    ingredients_json = ?, steps_json = ?, calories = ?, protein = ?, carbs = ?, fat = ?, status = ?,
    queue_item_id = CASE WHEN ? THEN NULL ELSE queue_item_id END,
    version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND plan_id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
    .run(
      req.body.plannedDate ?? current.planned_date, req.body.mealType ?? current.meal_type,
      req.body.recipeId === undefined ? current.recipe_id : req.body.recipeId,
      replacement?.title ?? current.title, replacement?.ingredients_json ?? current.ingredients_json,
      replacement?.steps_json ?? current.steps_json, replacement?.calories ?? current.calories,
      replacement?.protein ?? current.protein, replacement?.carbs ?? current.carbs, replacement?.fat ?? current.fat,
      req.body.status ?? current.status, req.body.recipeId !== undefined ? 1 : 0,
      req.params.itemId, req.params.id, req.userId!, req.body.version,
    );
  if (changed.changes !== 1) return versionConflict(res);
  return res.json(formatItem(getItem(String(req.params.id), String(req.params.itemId), req.userId!)!));
});

router.post("/:id/items/:itemId/shopping", validateBody(mealPlanShoppingSchema), (req: AuthRequest, res) => {
  const repeated = repeatedExecution(req.userId!, req.body.idempotencyKey);
  if (repeated) return res.json(repeated);
  const item = getItem(String(req.params.id), String(req.params.itemId), req.userId!);
  if (!item) return sendError(res, 404, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND");
  if (Number(item.version) !== req.body.version) return versionConflict(res);
  const ingredients = parseJson<unknown[]>(item.ingredients_json, []).map(ingredient).filter((entry): entry is { name: string; amount: string } => Boolean(entry?.name));
  const stock = (db.prepare("SELECT food_name FROM inventory_items WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL").all(req.userId!) as Array<{ food_name: string }>).map((row) => normalizedName(row.food_name));
  const shopping = (db.prepare("SELECT name FROM shopping_list_items WHERE user_id = ? AND checked = 0 AND deleted_at IS NULL").all(req.userId!) as Array<{ name: string }>).map((row) => normalizedName(row.name));
  const missing = ingredients.filter((entry) => {
    const name = normalizedName(entry.name);
    return name && !stock.some((owned) => owned.includes(name) || name.includes(owned)) && !shopping.some((saved) => saved.includes(name) || name.includes(saved));
  });
  const result = db.transaction(() => {
    const insert = db.prepare(`INSERT INTO shopping_list_items (id, user_id, client_id, name, amount, category)
      VALUES (?, ?, ?, ?, ?, '餐单')`);
    const ids = missing.map((entry) => {
      const id = randomUUID();
      insert.run(id, req.userId!, `meal-plan:${req.params.itemId}:${normalizedName(entry.name)}`.slice(0, 120), entry.name.slice(0, 120), entry.amount.slice(0, 80));
      return id;
    });
    const response = { added: ids.length, itemIds: ids, repeated: false };
    saveExecution(req.userId!, req.body.idempotencyKey, "shopping", String(req.params.itemId), response);
    return response;
  })();
  return res.status(201).json(result);
});

router.post("/:id/items/:itemId/queue", validateBody(mealPlanQueueSchema), (req: AuthRequest, res) => {
  const repeated = repeatedExecution(req.userId!, req.body.idempotencyKey);
  if (repeated) return res.json(repeated);
  const item = getItem(String(req.params.id), String(req.params.itemId), req.userId!);
  if (!item) return sendError(res, 404, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND");
  if (Number(item.version) !== req.body.version) return versionConflict(res);
  if (!item.recipe_id || item.recipe_status !== "approved" || item.recipe_deleted_at) {
    return sendError(res, 409, "该餐次没有可执行的公开菜谱", "MEAL_PLAN_RECIPE_UNAVAILABLE");
  }
  const result = db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM cooking_queue_items WHERE user_id = ? AND recipe_id = ?
      AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(req.userId!, item.recipe_id) as { id: string } | undefined;
    let queueItemId = existing?.id;
    let added = false;
    if (!queueItemId) {
      const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM cooking_queue_items WHERE user_id = ?
        AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(req.userId!) as { count: number }).count);
      if (count >= 30) throw new Error("QUEUE_FULL");
      const position = Number((db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items WHERE user_id = ?
        AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(req.userId!) as { position: number }).position);
      queueItemId = randomUUID();
      db.prepare(`INSERT INTO cooking_queue_items
        (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(queueItemId, req.userId!, item.recipe_id, position, queueMealType(item.meal_type), null, JSON.stringify({
          title: item.recipe_title || item.title,
          imageUrl: item.recipe_image_url || null,
          cookTime: item.recipe_cook_time || 0,
          difficulty: item.recipe_difficulty || "难度未知",
          ingredients: parseJson(item.ingredients_json, []),
        }), `meal-plan:${req.params.itemId}`);
      added = true;
    }
    db.prepare(`UPDATE meal_plan_items SET queue_item_id = ?, status = 'queued', version = version + 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
      .run(queueItemId, req.params.itemId, req.userId!, req.body.version);
    const response = { queueItemId, added, repeated: false };
    saveExecution(req.userId!, req.body.idempotencyKey, "queue", String(req.params.itemId), response);
    return response;
  });
  try {
    return res.status(201).json(result());
  } catch (error) {
    if (error instanceof Error && error.message === "QUEUE_FULL") return sendError(res, 409, "烹饪队列最多保留 30 道菜", "COOKING_QUEUE_FULL");
    throw error;
  }
});

router.post("/:id/items/:itemId/complete", validateBody(mealPlanCompleteSchema), (req: AuthRequest, res) => {
  const repeated = repeatedExecution(req.userId!, req.body.idempotencyKey);
  if (repeated) return res.json(repeated);
  const item = getItem(String(req.params.id), String(req.params.itemId), req.userId!);
  if (!item) return sendError(res, 404, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND");
  if (item.status === "completed" && item.diet_record_id) return res.json({ dietRecordId: Number(item.diet_record_id), repeated: true });
  if (Number(item.version) !== req.body.version) return versionConflict(res);
  const result = db.transaction(() => {
    let dietRecordId = req.body.dietRecordId as number | undefined;
    if (dietRecordId) {
      const owned = db.prepare("SELECT id FROM diet_records WHERE id = ? AND user_id = ?").get(dietRecordId, req.userId!);
      if (!owned) throw new Error("DIET_RECORD_NOT_FOUND");
    } else {
      const inserted = db.prepare(`INSERT INTO diet_records
        (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
        VALUES (?, ?, ?, '1份', ?, ?, ?, ?, ?, ?)`)
        .run(req.userId!, item.meal_type, item.recipe_title || item.title, item.calories, item.protein, item.carbs, item.fat,
          item.planned_date, item.planned_date === currentDateKey() ? currentTimeKey() : null);
      dietRecordId = Number(inserted.lastInsertRowid);
    }
    const changed = db.prepare(`UPDATE meal_plan_items SET status = 'completed', diet_record_id = ?, completed_at = CURRENT_TIMESTAMP,
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
      .run(dietRecordId, req.params.itemId, req.userId!, req.body.version);
    if (changed.changes !== 1) throw new Error("VERSION_CONFLICT");
    const response = { dietRecordId, repeated: false };
    saveExecution(req.userId!, req.body.idempotencyKey, "complete", String(req.params.itemId), response);
    return response;
  });
  try {
    return res.status(201).json(result());
  } catch (error) {
    if (error instanceof Error && error.message === "DIET_RECORD_NOT_FOUND") return sendError(res, 404, "饮食记录不存在", "DIET_RECORD_NOT_FOUND");
    if (error instanceof Error && error.message === "VERSION_CONFLICT") return versionConflict(res);
    throw error;
  }
});

export default router;
