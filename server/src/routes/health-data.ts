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

// GET /api/v1/health-data/latest
router.get("/latest", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const latest = db.prepare(`
    SELECT * FROM health_logs
    WHERE user_id = ?
    ORDER BY recorded_date DESC
    LIMIT 1
  `).get(userId);

  res.json(latest || null);
});

// GET /api/v1/health-data
router.get("/", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const logs = db.prepare(`
    SELECT * FROM health_logs
    WHERE user_id = ?
    ORDER BY recorded_date DESC
    LIMIT 30
  `).all(userId);

  res.json(logs);
});

// POST /api/v1/health-data/log
router.post("/log", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { weight, body_fat, water_ml, recorded_date } = req.body;
  const date = recorded_date || new Date().toISOString().split("T")[0];

  const existing: any = db.prepare("SELECT * FROM health_logs WHERE user_id = ? AND recorded_date = ?").get(userId, date);

  if (existing) {
    db.prepare(`
      UPDATE health_logs
      SET weight = COALESCE(?, weight),
          body_fat = COALESCE(?, body_fat),
          water_ml = COALESCE(?, water_ml)
      WHERE id = ?
    `).run(weight, body_fat, water_ml, existing.id);

    const updated = db.prepare("SELECT * FROM health_logs WHERE id = ?").get(existing.id);
    return res.json(updated);
  }

  const result = db.prepare(`
    INSERT INTO health_logs (user_id, weight, body_fat, water_ml, recorded_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, weight || 60, body_fat || 18, water_ml || 0, date);

  const newLog = db.prepare("SELECT * FROM health_logs WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(newLog);
});
// GET /api/v1/health-data/profile
router.get("/profile", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const profile = db.prepare(`
    SELECT * FROM user_health_profiles
    WHERE user_id = ?
  `).get(userId);

  res.json(profile || null);
});

// PUT /api/v1/health-data/profile
router.put("/profile", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference } = req.body;
  const allowedGoals = ["lose_weight", "reduce_fat", "gain_muscle", "maintain", "healthy"];
  if (health_goal !== undefined && !allowedGoals.includes(health_goal)) {
    return res.status(400).json({ error: "无效的健康目标" });
  }

  const existing: any = db.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(userId);

  if (existing) {
    db.prepare(`
      UPDATE user_health_profiles
      SET gender = COALESCE(?, gender),
          age = COALESCE(?, age),
          height = COALESCE(?, height),
          weight = COALESCE(?, weight),
          target_weight = COALESCE(?, target_weight),
          health_goal = COALESCE(?, health_goal),
          activity_level = COALESCE(?, activity_level),
          dietary_preference = COALESCE(?, dietary_preference),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference, userId);
  } else {
    db.prepare(`
      INSERT INTO user_health_profiles (user_id, gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, gender, age, height, weight, target_weight, health_goal || 'healthy', activity_level || 'moderate', dietary_preference || '无特别偏好');
  }

  const updated = db.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(userId);
  res.json(updated);
});
export default router;
