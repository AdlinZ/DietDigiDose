import type Database from "better-sqlite3";
import type { HealthRepository } from "./repository.js";
import type { HealthLogInput, HealthProfilePatch } from "./types.js";

const optional = (value: unknown) => value === undefined ? null : value;
const json = (value: unknown) => value === undefined ? null : JSON.stringify(value);

export class SqliteHealthRepository implements HealthRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async latestLog(userId: number) {
    return (this.database.prepare(`
      SELECT * FROM health_logs WHERE user_id = ? ORDER BY recorded_date DESC LIMIT 1
    `).get(userId) as Record<string, unknown> | undefined) ?? null;
  }

  async listLogs(userId: number, limit: number) {
    return this.database.prepare(`
      SELECT * FROM health_logs WHERE user_id = ? ORDER BY recorded_date DESC LIMIT ?
    `).all(userId, limit) as Array<Record<string, unknown>>;
  }

  async upsertLog(userId: number, recordedDate: string, input: HealthLogInput) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT id FROM health_logs WHERE user_id = ? AND recorded_date = ? ORDER BY id DESC LIMIT 1
      `).get(userId, recordedDate) as { id: number } | undefined;
      const values = [
        optional(input.weight), optional(input.body_fat), optional(input.water_ml), optional(input.height_cm),
        optional(input.waist_cm), optional(input.hip_cm), optional(input.resting_heart_rate),
        optional(input.blood_pressure_systolic), optional(input.blood_pressure_diastolic),
        optional(input.blood_glucose_mmol), optional(input.sleep_hours),
      ];
      if (existing) {
        this.database.prepare(`
          UPDATE health_logs SET
            weight = COALESCE(?, weight), body_fat = COALESCE(?, body_fat), water_ml = COALESCE(?, water_ml),
            height_cm = COALESCE(?, height_cm), waist_cm = COALESCE(?, waist_cm), hip_cm = COALESCE(?, hip_cm),
            resting_heart_rate = COALESCE(?, resting_heart_rate),
            blood_pressure_systolic = COALESCE(?, blood_pressure_systolic),
            blood_pressure_diastolic = COALESCE(?, blood_pressure_diastolic),
            blood_glucose_mmol = COALESCE(?, blood_glucose_mmol),
            cycle_status = CASE WHEN ? = 1 THEN ? ELSE cycle_status END,
            sleep_hours = COALESCE(?, sleep_hours)
          WHERE id = ?
        `).run(
          ...values.slice(0, 10),
          Number(Object.prototype.hasOwnProperty.call(input, "cycle_status")),
          optional(input.cycle_status),
          values[10],
          existing.id,
        );
        const log = this.database.prepare("SELECT * FROM health_logs WHERE id = ?").get(existing.id) as Record<string, unknown>;
        return { created: false, log };
      }
      const result = this.database.prepare(`
        INSERT INTO health_logs (
          user_id, weight, body_fat, water_ml, height_cm, waist_cm, hip_cm,
          resting_heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
          blood_glucose_mmol, cycle_status, sleep_hours, recorded_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        ...values.slice(0, 10),
        optional(input.cycle_status),
        values[10],
        recordedDate,
      );
      const log = this.database.prepare("SELECT * FROM health_logs WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>;
      return { created: true, log };
    })();
  }

  async removeLog(userId: number, id: number) {
    return this.database.prepare("DELETE FROM health_logs WHERE id = ? AND user_id = ?").run(id, userId).changes === 1;
  }

  async getOrCreateProfile(userId: number) {
    this.database.prepare("INSERT OR IGNORE INTO user_health_profiles (user_id) VALUES (?)").run(userId);
    return this.database.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(userId) as Record<string, unknown>;
  }

  async upsertProfile(userId: number, input: HealthProfilePatch) {
    const existing = this.database.prepare("SELECT id FROM user_health_profiles WHERE user_id = ?").get(userId);
    const values = [
      optional(input.gender), optional(input.age), optional(input.height), optional(input.weight), optional(input.target_weight),
      optional(input.health_goal), optional(input.activity_level), optional(input.dietary_preference), json(input.allergies_json),
      optional(input.medications), json(input.medical_conditions_json), optional(input.medical_notes),
      json(input.dietary_restrictions_json), optional(input.disliked_foods), json(input.kitchen_constraints_json),
      json(input.nutrition_targets_json), input.tracking_enabled === undefined ? null : Number(input.tracking_enabled),
    ];
    if (existing) {
      this.database.prepare(`
        UPDATE user_health_profiles SET
          gender = COALESCE(?, gender), age = COALESCE(?, age), height = COALESCE(?, height),
          weight = COALESCE(?, weight), target_weight = COALESCE(?, target_weight),
          health_goal = COALESCE(?, health_goal), activity_level = COALESCE(?, activity_level),
          dietary_preference = COALESCE(?, dietary_preference), allergies_json = COALESCE(?, allergies_json),
          medications = COALESCE(?, medications), medical_conditions_json = COALESCE(?, medical_conditions_json),
          medical_notes = COALESCE(?, medical_notes), dietary_restrictions_json = COALESCE(?, dietary_restrictions_json),
          disliked_foods = COALESCE(?, disliked_foods), kitchen_constraints_json = COALESCE(?, kitchen_constraints_json),
          nutrition_targets_json = COALESCE(?, nutrition_targets_json), tracking_enabled = COALESCE(?, tracking_enabled),
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).run(...values, userId);
    } else {
      this.database.prepare(`
        INSERT INTO user_health_profiles (
          user_id, gender, age, height, weight, target_weight, health_goal, activity_level, dietary_preference,
          allergies_json, medications, medical_conditions_json, medical_notes, dietary_restrictions_json,
          disliked_foods, kitchen_constraints_json, nutrition_targets_json, tracking_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        input.gender ?? null, input.age ?? null, input.height ?? null, input.weight ?? null, input.target_weight ?? null,
        input.health_goal || "healthy", input.activity_level || "moderate", input.dietary_preference || "无特别偏好",
        json(input.allergies_json) || "[]", input.medications || "", json(input.medical_conditions_json) || "[]",
        input.medical_notes || "", json(input.dietary_restrictions_json) || "[]", input.disliked_foods || "",
        json(input.kitchen_constraints_json) || "{}", json(input.nutrition_targets_json) || "{}",
        Number(input.tracking_enabled ?? false),
      );
    }
    return this.database.prepare("SELECT * FROM user_health_profiles WHERE user_id = ?").get(userId) as Record<string, unknown>;
  }
}
