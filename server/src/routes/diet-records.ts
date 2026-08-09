import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { cookingCompletionSchema, dietRecordCreateSchema } from "../validation/schemas.js";
import { sendError } from "../utils/http.js";
import { currentDateKey, currentTimeKey } from "../utils/date.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";
import { recordFunnelEvent } from "../services/funnelEvents.js";

const router = Router();
router.param("id", positiveIntegerParam);
router.use(authMiddleware);

router.post("/cooking-completions", validateBody(cookingCompletionSchema), (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { idempotency_key: idempotencyKey, recipe_id: recipeId, inventory_item_ids: rawInventoryIds, diet_record: record } = req.body;
  const inventoryIds = [...new Set(rawInventoryIds as number[])];
  const existing = db.prepare(`
    SELECT result_json FROM cooking_completions WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey) as { result_json: string } | undefined;
  if (existing) return res.json({ ...JSON.parse(existing.result_json), repeated: true });

  if (inventoryIds.length) {
    const placeholders = inventoryIds.map(() => "?").join(",");
    const available = db.prepare(`
      SELECT id FROM inventory_items
      WHERE user_id = ? AND is_available = 1 AND id IN (${placeholders})
    `).all(userId, ...inventoryIds) as Array<{ id: number }>;
    if (available.length !== inventoryIds.length) {
      return sendError(res, 409, "部分库存食材不存在、已用完或不属于当前账号", "INVENTORY_CONFLICT");
    }
  }

  try {
    const result = db.transaction(() => {
      if (inventoryIds.length) {
        const placeholders = inventoryIds.map(() => "?").join(",");
        const updated = db.prepare(`
          UPDATE inventory_items SET is_available = 0
          WHERE user_id = ? AND is_available = 1 AND id IN (${placeholders})
        `).run(userId, ...inventoryIds);
        if (updated.changes !== inventoryIds.length) throw new Error("INVENTORY_CONFLICT");
      }

      const recordedAt = record.recorded_at || currentDateKey();
      const recordedTime = record.recorded_time ?? (recordedAt === currentDateKey() ? currentTimeKey() : null);
      const inserted = db.prepare(`
        INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, record.meal_type, record.food_name, record.amount || "1份",
        record.calories ?? null, record.protein ?? null, record.carbs ?? null, record.fat ?? null,
        recordedAt, recordedTime, record.image_url || null,
      );
      const dietRecord = db.prepare("SELECT * FROM diet_records WHERE id = ?").get(inserted.lastInsertRowid);
      const response = { diet_record: dietRecord, consumed_inventory_item_ids: inventoryIds, repeated: false };
      db.prepare(`
        INSERT INTO cooking_completions (
          user_id, idempotency_key, recipe_id, diet_record_id, consumed_inventory_ids_json, result_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, idempotencyKey, recipeId ?? null, inserted.lastInsertRowid, JSON.stringify(inventoryIds), JSON.stringify(response));
      return response;
    })();
    recordFunnelEvent(userId, "cooking_completed");
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "INVENTORY_CONFLICT") {
      return sendError(res, 409, "库存状态已变化，请刷新后重试", "INVENTORY_CONFLICT");
    }
    throw error;
  }
});

// GET /api/v1/diet-records
router.get("/", (req: AuthRequest, res) => {

  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  let query = "SELECT * FROM diet_records WHERE user_id = ?";
  const params: Array<number | string> = [req.userId!];

  if (date) {
    query += " AND recorded_at = ?";
    params.push(date);
  }

  query += " ORDER BY CASE WHEN recorded_time IS NULL THEN 1 ELSE 0 END, recorded_time DESC, id DESC";

  const records = db.prepare(query).all(...params);
  res.json(records);
});

// POST /api/v1/diet-records
router.post("/", validateBody(dietRecordCreateSchema), (req: AuthRequest, res) => {
  const todayStr = currentDateKey();
  const { meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, image_url } = req.body;
  const finalRecordedAt = recorded_at || todayStr;
  const finalRecordedTime = recorded_time ?? (finalRecordedAt === todayStr ? currentTimeKey() : null);

  const result = db.prepare(`
    INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId,
    meal_type,
    food_name,
    amount || "1份",
    calories ?? null,
    protein ?? null,
    carbs ?? null,
    fat ?? null,
    finalRecordedAt,
    finalRecordedTime,
    image_url || null
  );

  const newRecord = db.prepare("SELECT * FROM diet_records WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(newRecord);
});

// DELETE /api/v1/diet-records/:id
router.delete("/:id", (req: AuthRequest, res) => {
  const result = db.prepare("DELETE FROM diet_records WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
  if (result.changes === 0) {
    return sendError(res, 404, "记录不存在", "DIET_RECORD_NOT_FOUND");
  }

  res.json({ message: "删除成功" });
});

export default router;
