import { randomUUID } from "node:crypto";
import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uuidParam } from "../middleware/validateParam.js";
import { db } from "../storage/db.js";
import { sendError } from "../utils/http.js";
import {
  cookingQueueCreateSchema,
  cookingQueueReorderSchema,
  cookingQueueUpdateSchema,
  cookingQueueVersionSchema,
} from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);
router.param("id", uuidParam);

const activeStatuses = "'waiting', 'preparing', 'ready', 'cooking'";

type QueueRow = Record<string, unknown>;

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function formatQueueItem(row: QueueRow) {
  const snapshot = parseJson<Record<string, unknown>>(row.recipe_snapshot_json, {});
  const currentIngredients = parseJson<unknown[]>(row.current_ingredients_json, []);
  const ingredients = currentIngredients.length
    ? currentIngredients
    : Array.isArray(snapshot.ingredients) ? snapshot.ingredients : [];
  return {
    id: String(row.id),
    recipeId: Number(row.recipe_id),
    position: Number(row.position),
    status: String(row.status),
    mealType: row.meal_type ? String(row.meal_type) : null,
    plannedAt: row.planned_at ? String(row.planned_at) : null,
    version: Number(row.version),
    title: String(row.current_title || snapshot.title || "已失效菜谱"),
    imageUrl: row.current_image_url === null || row.current_image_url === undefined
      ? (typeof snapshot.imageUrl === "string" ? snapshot.imageUrl : null)
      : String(row.current_image_url),
    cookTime: Number(row.current_cook_time ?? snapshot.cookTime ?? 0),
    calories: Number(row.current_calories ?? snapshot.calories ?? 0),
    difficulty: String(row.current_difficulty || snapshot.difficulty || "难度未知"),
    ingredients,
    preparedIngredientNames: parseJson<string[]>(row.prepared_ingredients_json, []),
    shoppingListSyncedAt: row.shopping_list_synced_at ? String(row.shopping_list_synced_at) : null,
    recipeAvailable: Boolean(row.current_title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

const selectQueue = `
  SELECT q.*,
    r.title AS current_title,
    r.image_url AS current_image_url,
    r.cook_time AS current_cook_time,
    r.calories AS current_calories,
    r.difficulty AS current_difficulty,
    r.ingredients_json AS current_ingredients_json
  FROM cooking_queue_items q
  LEFT JOIN recipes r
    ON r.id = q.recipe_id AND r.deleted_at IS NULL AND r.status = 'approved'
`;

function getOwnedItem(id: string, userId: number) {
  return db.prepare(`${selectQueue} WHERE q.id = ? AND q.user_id = ?`).get(id, userId) as QueueRow | undefined;
}

function versionConflict(res: Parameters<typeof sendError>[0]) {
  return sendError(res, 409, "烹饪队列已在其他设备更新，请刷新后重试", "COOKING_QUEUE_VERSION_CONFLICT");
}

router.get("/", (req: AuthRequest, res) => {
  const includeHistory = req.query.includeHistory === "true";
  const where = includeHistory
    ? "q.user_id = ?"
    : `q.user_id = ? AND q.deleted_at IS NULL AND q.status IN (${activeStatuses})`;
  const order = includeHistory
    ? "CASE WHEN q.status IN ('waiting', 'preparing', 'ready', 'cooking') THEN 0 ELSE 1 END, q.position, q.updated_at DESC"
    : "q.position, q.created_at";
  const rows = db.prepare(`${selectQueue} WHERE ${where} ORDER BY ${order}`).all(req.userId!) as QueueRow[];
  return res.json(rows.map(formatQueueItem));
});

router.post("/", validateBody(cookingQueueCreateSchema), (req: AuthRequest, res) => {
  const recipe = db.prepare(`
    SELECT id, title, image_url, cook_time, calories, difficulty, ingredients_json
    FROM recipes
    WHERE id = ? AND deleted_at IS NULL AND status = 'approved'
  `).get(req.body.recipeId) as QueueRow | undefined;
  if (!recipe) return sendError(res, 404, "菜谱不存在或尚未通过审核", "RECIPE_NOT_AVAILABLE");

  const idempotent = req.body.idempotencyKey
    ? db.prepare("SELECT id FROM cooking_queue_items WHERE user_id = ? AND idempotency_key = ?")
      .get(req.userId!, req.body.idempotencyKey) as { id: string } | undefined
    : undefined;
  if (idempotent) return res.json({ item: formatQueueItem(getOwnedItem(idempotent.id, req.userId!)!), added: false });

  const existing = db.prepare(`
    SELECT id FROM cooking_queue_items
    WHERE user_id = ? AND recipe_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
  `).get(req.userId!, req.body.recipeId) as { id: string } | undefined;
  if (existing) return res.json({ item: formatQueueItem(getOwnedItem(existing.id, req.userId!)!), added: false });

  const count = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM cooking_queue_items
    WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
  `).get(req.userId!) as { count: number }).count);
  if (count >= 30) return sendError(res, 409, "烹饪队列最多保留 30 道菜", "COOKING_QUEUE_FULL");

  const position = Number((db.prepare(`
    SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items
    WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
  `).get(req.userId!) as { position: number }).position);
  const id = randomUUID();
  const snapshot = {
    title: recipe.title,
    imageUrl: recipe.image_url,
    cookTime: recipe.cook_time,
    calories: recipe.calories,
    difficulty: recipe.difficulty,
    ingredients: parseJson<unknown[]>(recipe.ingredients_json, []),
  };
  db.prepare(`
    INSERT INTO cooking_queue_items
      (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.userId!, req.body.recipeId, position, req.body.mealType ?? null,
    req.body.plannedAt ?? null, JSON.stringify(snapshot), req.body.idempotencyKey ?? null,
  );
  return res.status(201).json({ item: formatQueueItem(getOwnedItem(id, req.userId!)!), added: true });
});

router.patch("/:id", validateBody(cookingQueueUpdateSchema), (req: AuthRequest, res) => {
  const current = getOwnedItem(String(req.params.id), req.userId!);
  if (!current) return sendError(res, 404, "烹饪队列项不存在", "COOKING_QUEUE_ITEM_NOT_FOUND");
  if (Number(current.version) !== req.body.version) return versionConflict(res);

  const transitions: Record<string, Set<string>> = {
    waiting: new Set(["waiting", "preparing", "ready", "cooking", "cancelled"]),
    preparing: new Set(["waiting", "preparing", "ready", "cooking", "cancelled"]),
    ready: new Set(["preparing", "ready", "cooking", "cancelled"]),
    cooking: new Set(["cooking", "completed", "cancelled"]),
    completed: new Set(["completed"]),
    cancelled: new Set(["cancelled"]),
  };
  if (req.body.status && !transitions[String(current.status)]?.has(req.body.status)) {
    return sendError(res, 409, "当前烹饪状态不能执行该操作", "COOKING_QUEUE_INVALID_TRANSITION");
  }

  const nextStatus = req.body.status ?? current.status;
  const completedAt = nextStatus === "completed" ? new Date().toISOString() : current.completed_at;
  const result = db.prepare(`
    UPDATE cooking_queue_items SET
      status = ?, meal_type = ?, planned_at = ?, prepared_ingredients_json = ?,
      shopping_list_synced_at = ?, completed_at = ?, version = version + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ?
  `).run(
    nextStatus,
    req.body.mealType === undefined ? current.meal_type : req.body.mealType,
    req.body.plannedAt === undefined ? current.planned_at : req.body.plannedAt,
    req.body.preparedIngredientNames === undefined
      ? current.prepared_ingredients_json
      : JSON.stringify([...new Set(req.body.preparedIngredientNames)]),
    req.body.shoppingListSyncedAt === undefined ? current.shopping_list_synced_at : req.body.shoppingListSyncedAt,
    completedAt,
    req.params.id, req.userId!, req.body.version,
  );
  if (result.changes !== 1) return versionConflict(res);
  return res.json(formatQueueItem(getOwnedItem(String(req.params.id), req.userId!)!));
});

router.post("/reorder", validateBody(cookingQueueReorderSchema), (req: AuthRequest, res) => {
  try {
    db.transaction(() => {
      const active = db.prepare(`
        SELECT id, version FROM cooking_queue_items
        WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
      `).all(req.userId!) as Array<{ id: string; version: number }>;
      if (active.length !== req.body.items.length) throw new Error("VERSION_CONFLICT");
      const activeVersions = new Map(active.map((item) => [item.id, item.version]));
      const update = db.prepare(`
        UPDATE cooking_queue_items SET position = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
      `);
      req.body.items.forEach((item: { id: string; version: number }, index: number) => {
        if (activeVersions.get(item.id) !== item.version || update.run(index, item.id, req.userId!, item.version).changes !== 1) {
          throw new Error("VERSION_CONFLICT");
        }
      });
    })();
  } catch (error) {
    if (error instanceof Error && error.message === "VERSION_CONFLICT") return versionConflict(res);
    throw error;
  }
  const rows = db.prepare(`${selectQueue}
    WHERE q.user_id = ? AND q.deleted_at IS NULL AND q.status IN (${activeStatuses})
    ORDER BY q.position, q.created_at`).all(req.userId!) as QueueRow[];
  return res.json(rows.map(formatQueueItem));
});

router.post("/:id/start", validateBody(cookingQueueVersionSchema), (req: AuthRequest, res) => {
  const current = getOwnedItem(String(req.params.id), req.userId!);
  if (!current) return sendError(res, 404, "烹饪队列项不存在", "COOKING_QUEUE_ITEM_NOT_FOUND");
  if (current.status === "cooking") return res.json(formatQueueItem(current));
  if (!["waiting", "preparing", "ready"].includes(String(current.status))) {
    return sendError(res, 409, "这道菜当前不能开始烹饪", "COOKING_QUEUE_INVALID_TRANSITION");
  }
  const result = db.prepare(`
    UPDATE cooking_queue_items SET status = 'cooking', planned_at = NULL,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ?
  `).run(req.params.id, req.userId!, req.body.version);
  if (result.changes !== 1) return versionConflict(res);
  return res.json(formatQueueItem(getOwnedItem(String(req.params.id), req.userId!)!));
});

router.post("/:id/complete", validateBody(cookingQueueVersionSchema), (req: AuthRequest, res) => {
  const current = getOwnedItem(String(req.params.id), req.userId!);
  if (!current) return sendError(res, 404, "烹饪队列项不存在", "COOKING_QUEUE_ITEM_NOT_FOUND");
  if (current.status === "completed") return res.json(formatQueueItem(current));
  if (current.status !== "cooking") return sendError(res, 409, "请先开始烹饪再完成", "COOKING_QUEUE_INVALID_TRANSITION");
  const result = db.prepare(`
    UPDATE cooking_queue_items SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ?
  `).run(req.params.id, req.userId!, req.body.version);
  if (result.changes !== 1) return versionConflict(res);
  return res.json(formatQueueItem(getOwnedItem(String(req.params.id), req.userId!)!));
});

router.delete("/:id", (req: AuthRequest, res) => {
  const result = db.prepare(`
    UPDATE cooking_queue_items SET status = 'cancelled', version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
  `).run(req.params.id, req.userId!);
  if (result.changes !== 1) return sendError(res, 404, "烹饪队列项不存在", "COOKING_QUEUE_ITEM_NOT_FOUND");
  return res.json({ success: true });
});

router.delete("/", (_req: AuthRequest, res) => {
  const req = _req;
  const result = db.prepare(`
    UPDATE cooking_queue_items SET status = 'cancelled', version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
  `).run(req.userId!);
  return res.json({ success: true, count: result.changes });
});

export default router;
