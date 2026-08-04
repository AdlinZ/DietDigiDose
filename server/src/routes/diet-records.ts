import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { dietRecordCreateSchema } from "../validation/schemas.js";
import { sendError } from "../utils/http.js";
import { currentDateKey } from "../utils/date.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";

const router = Router();
router.param("id", positiveIntegerParam);
router.use(authMiddleware);

// GET /api/v1/diet-records
router.get("/", (req: AuthRequest, res) => {

  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  let query = "SELECT * FROM diet_records WHERE user_id = ?";
  const params: Array<number | string> = [req.userId!];

  if (date) {
    query += " AND recorded_at = ?";
    params.push(date);
  }

  query += " ORDER BY created_at DESC";

  const records = db.prepare(query).all(...params);
  res.json(records);
});

// POST /api/v1/diet-records
router.post("/", validateBody(dietRecordCreateSchema), (req: AuthRequest, res) => {
  const todayStr = currentDateKey();
  const { meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, image_url } = req.body;
  const finalRecordedAt = recorded_at || todayStr;

  const result = db.prepare(`
    INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
