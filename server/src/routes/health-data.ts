import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { healthLogSchema, healthProfileSchema } from "../validation/schemas.js";
import { currentDateKey } from "../utils/date.js";
import { ensureUserInitialState } from "../services/userInitialization.js";

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
    blood_glucose_mmol, cycle_status, sleep_hours, recorded_date,
  } = req.body;
  const date = recorded_date || currentDateKey();
  const hasCycleStatus = Object.prototype.hasOwnProperty.call(req.body, "cycle_status");

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
          blood_glucose_mmol = COALESCE(?, blood_glucose_mmol),
          cycle_status = CASE WHEN ? = 1 THEN ? ELSE cycle_status END,
          sleep_hours = COALESCE(?, sleep_hours)
      WHERE id = ?
    `).run(
      weight, body_fat, water_ml, height_cm, waist_cm, hip_cm,
      resting_heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
      blood_glucose_mmol, Number(hasCycleStatus), cycle_status, sleep_hours, existing.id,
    );

    const updated = db.prepare("SELECT * FROM health_logs WHERE id = ?").get(existing.id);
    return res.json(updated);
  }

  const result = db.prepare(`
    INSERT INTO health_logs (
      user_id, weight, body_fat, water_ml, height_cm, waist_cm, hip_cm,
      resting_heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
      blood_glucose_mmol, cycle_status, sleep_hours, recorded_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId, weight ?? null, body_fat ?? null, water_ml ?? null,
    height_cm ?? null, waist_cm ?? null, hip_cm ?? null,
    resting_heart_rate ?? null, blood_pressure_systolic ?? null,
    blood_pressure_diastolic ?? null, blood_glucose_mmol ?? null,
    cycle_status ?? null, sleep_hours ?? null, date,
  );

  const newLog = db.prepare("SELECT * FROM health_logs WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(newLog);
});

// DELETE /api/v1/health-data/log/:id
router.delete("/log/:id", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "无效的记录编号" });
  const result = db.prepare("DELETE FROM health_logs WHERE id = ? AND user_id = ?").run(id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "记录不存在" });
  return res.status(204).send();
});

function parseJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function serializeProfile(profile: any) {
  if (!profile) return null;
  return {
    ...profile,
    allergies: parseJson(profile.allergies_json, []),
    medical_conditions: parseJson(profile.medical_conditions_json, []),
    dietary_restrictions: parseJson(profile.dietary_restrictions_json, []),
    kitchen_constraints: parseJson(profile.kitchen_constraints_json, {}),
    nutrition_targets: parseJson(profile.nutrition_targets_json, {}),
    tracking_enabled: Boolean(profile.tracking_enabled),
    allergies_json: undefined,
    medical_conditions_json: undefined,
    dietary_restrictions_json: undefined,
    kitchen_constraints_json: undefined,
    nutrition_targets_json: undefined,
  };
}
// GET /api/v1/health-data/profile
router.get("/profile", (req: AuthRequest, res) => {
  ensureUserInitialState(req.userId!);
  const profile = db.prepare(`
    SELECT * FROM user_health_profiles
    WHERE user_id = ?
  `).get(req.userId);

  res.json(serializeProfile(profile));
});

// PUT /api/v1/health-data/profile
router.put("/profile", validateBody(healthProfileSchema), (req: AuthRequest, res) => {
  const {
    gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference,
    allergies, medications, medical_conditions, medical_notes, dietary_restrictions, disliked_foods,
    kitchen_constraints, nutrition_targets, tracking_enabled,
  } = req.body;
  const existing: any = db.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(req.userId);
  const allergiesJson = allergies === undefined ? null : JSON.stringify(allergies);
  const conditionsJson = medical_conditions === undefined ? null : JSON.stringify(medical_conditions);
  const restrictionsJson = dietary_restrictions === undefined ? null : JSON.stringify(dietary_restrictions);
  const kitchenJson = kitchen_constraints === undefined ? null : JSON.stringify(kitchen_constraints);
  const targetsJson = nutrition_targets === undefined ? null : JSON.stringify(nutrition_targets);
  const trackingValue = tracking_enabled === undefined ? null : Number(tracking_enabled);

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
          allergies_json = COALESCE(?, allergies_json),
          medications = COALESCE(?, medications),
          medical_conditions_json = COALESCE(?, medical_conditions_json),
          medical_notes = COALESCE(?, medical_notes),
          dietary_restrictions_json = COALESCE(?, dietary_restrictions_json),
          disliked_foods = COALESCE(?, disliked_foods),
          kitchen_constraints_json = COALESCE(?, kitchen_constraints_json),
          nutrition_targets_json = COALESCE(?, nutrition_targets_json),
          tracking_enabled = COALESCE(?, tracking_enabled),
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference,
      allergiesJson, medications, conditionsJson, medical_notes, restrictionsJson, disliked_foods,
      kitchenJson, targetsJson, trackingValue, req.userId,
    );
  } else {
    db.prepare(`
      INSERT INTO user_health_profiles (
        user_id, gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference,
        allergies_json, medications, medical_conditions_json, medical_notes, dietary_restrictions_json,
        disliked_foods, kitchen_constraints_json, nutrition_targets_json, tracking_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.userId, gender, age, height, weight, target_weight, health_goal || 'healthy', activity_level || 'moderate', dietary_preference || '无特别偏好',
      allergiesJson || '[]', medications || '', conditionsJson || '[]', medical_notes || '', restrictionsJson || '[]',
      disliked_foods || '', kitchenJson || '{}', targetsJson || '{}', trackingValue || 0,
    );
  }

  const updated = db.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(req.userId);
  res.json(serializeProfile(updated));
});
export default router;
