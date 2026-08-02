import { Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/security.js";
import { db } from "../storage/db.js";

const router = Router();

function getUserIdFromReq(req: any): number | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    return decoded.userId;
  } catch {
    return null;
  }
}

// GET /api/v1/diet-records
router.get("/", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { date } = req.query;
  let query = "SELECT * FROM diet_records WHERE user_id = ?";
  const params: any[] = [userId];

  if (date) {
    query += " AND recorded_at = ?";
    params.push(date);
  }

  query += " ORDER BY created_at DESC";

  const records = db.prepare(query).all(...params);
  res.json(records);
});

// POST /api/v1/diet-records
router.post("/", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const { meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, image_url } = req.body;
  if (!meal_type || !food_name) {
    return res.status(400).json({ error: "餐次和食物名称不能为空" });
  }

  const finalRecordedAt = recorded_at || todayStr;

  const result = db.prepare(`
    INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    meal_type,
    food_name,
    amount || "1份",
    calories || 300,
    protein || 15,
    carbs || 35,
    fat || 10,
    finalRecordedAt,
    image_url || null
  );

  const newRecord = db.prepare("SELECT * FROM diet_records WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(newRecord);
});

// DELETE /api/v1/diet-records/:id
router.delete("/:id", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const result = db.prepare("DELETE FROM diet_records WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: "记录不存在" });
  }

  res.json({ message: "删除成功" });
});

export default router;
