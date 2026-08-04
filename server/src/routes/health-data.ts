import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { healthLogSchema, healthProfileSchema } from "../validation/schemas.js";
import { currentDateKey } from "../utils/date.js";

const router = Router();
router.use(authMiddleware);

// GET /api/v1/health-data/latest
router.get("/latest", (req: AuthRequest, res) => {
  const latest = db.prepare(`
    SELECT * FROM health_logs
    WHERE user_id = ?
    ORDER BY recorded_date DESC
    LIMIT 1
  `).get(req.userId);

  res.json(latest || null);
});

// GET /api/v1/health-data
router.get("/", (req: AuthRequest, res) => {
  const logs = db.prepare(`
    SELECT * FROM health_logs
    WHERE user_id = ?
    ORDER BY recorded_date DESC
    LIMIT 30
  `).all(req.userId);

  res.json(logs);
});

// POST /api/v1/health-data/log
router.post("/log", validateBody(healthLogSchema), (req: AuthRequest, res) => {
  const {
    weight, body_fat, water_ml, height_cm, waist_cm, hip_cm,
    resting_heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
    sleep_hours, recorded_date,
  } = req.body;
  const date = recorded_date || currentDateKey();

  const existing: any = db.prepare("SELECT * FROM health_logs WHERE user_id = ? AND recorded_date = ?").get(req.userId, date);

  if (existing) {
    db.prepare(`
      UPDATE health_logs
      SET weight = COALESCE(?, weight),
          body_fat = COALESCE(?, body_fat),
          water_ml = COALESCE(?, water_ml),
          height_cm = COALESCE(?, height_cm),
          waist_cm = COALESCE(?, waist_cm),
          hip_cm = COALESCE(?, hip_cm),
          resting_heart_rate = COALESCE(?, resting_heart_rate),
          blood_pressure_systolic = COALESCE(?, blood_pressure_systolic),
          blood_pressure_diastolic = COALESCE(?, blood_pressure_diastolic),
          sleep_hours = COALESCE(?, sleep_hours)
      WHERE id = ?
    `).run(
      weight, body_fat, water_ml, height_cm, waist_cm, hip_cm,
      resting_heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
      sleep_hours, existing.id,
    );

    const updated = db.prepare("SELECT * FROM health_logs WHERE id = ?").get(existing.id);
    return res.json(updated);
  }

  const result = db.prepare(`
    INSERT INTO health_logs (
      user_id, weight, body_fat, water_ml, height_cm, waist_cm, hip_cm,
      resting_heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
      sleep_hours, recorded_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId, weight ?? null, body_fat ?? null, water_ml ?? null,
    height_cm ?? null, waist_cm ?? null, hip_cm ?? null,
    resting_heart_rate ?? null, blood_pressure_systolic ?? null,
    blood_pressure_diastolic ?? null, sleep_hours ?? null, date,
  );

  const newLog = db.prepare("SELECT * FROM health_logs WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(newLog);
});
// GET /api/v1/health-data/profile
router.get("/profile", (req: AuthRequest, res) => {
  const profile = db.prepare(`
    SELECT * FROM user_health_profiles
    WHERE user_id = ?
  `).get(req.userId);

  res.json(profile || null);
});

// PUT /api/v1/health-data/profile
router.put("/profile", validateBody(healthProfileSchema), (req: AuthRequest, res) => {
  const { gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference } = req.body;
  const existing: any = db.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(req.userId);

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
    `).run(gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference, req.userId);
  } else {
    db.prepare(`
      INSERT INTO user_health_profiles (user_id, gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.userId, gender, age, height, weight, target_weight, health_goal || 'healthy', activity_level || 'moderate', dietary_preference || '无特别偏好');
  }

  const updated = db.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(req.userId);
  res.json(updated);
});
export default router;
