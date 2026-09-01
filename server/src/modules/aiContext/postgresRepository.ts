import type { Pool } from "pg";
import type { AiContextRepository } from "./repository.js";
import type { AiContextRows, Row } from "./types.js";

export class PostgresAiContextRepository implements AiContextRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async load(userId: number, date: string): Promise<AiContextRows> {
    const [user, inventory, kitchenware, todayDiet, latestHealth, healthProfile, setting] = await Promise.all([
      this.pool.query("SELECT username, daily_calories_target FROM users WHERE id = $1", [userId]),
      this.pool.query(`SELECT food_name, quantity, expiration_date, storage_location FROM inventory_items
        WHERE user_id = $1 AND is_available = TRUE ORDER BY expiration_date ASC LIMIT 15`, [userId]),
      this.pool.query(`SELECT name, category, status FROM kitchenware_items
        WHERE user_id = $1 AND deleted_at IS NULL AND status <> '维修中' ORDER BY updated_at DESC LIMIT 20`, [userId]),
      this.pool.query(`SELECT meal_type, food_name, calories, protein, carbs, fat FROM diet_records
        WHERE user_id = $1 AND recorded_at LIKE $2 ORDER BY id DESC`, [userId, `${date}%`]),
      this.pool.query(`SELECT weight, body_fat, water_ml FROM health_logs
        WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [userId]),
      this.pool.query(`SELECT age, dietary_preference, allergies_json, medications, medical_conditions_json,
        medical_notes, dietary_restrictions_json, disliked_foods, kitchen_constraints_json, nutrition_targets_json
        FROM user_health_profiles WHERE user_id = $1`, [userId]),
      this.pool.query("SELECT value FROM system_settings WHERE key = 'AI_SYSTEM_PROMPT'"),
    ]);
    return {
      user: (user.rows[0] as Row | undefined) || null,
      inventory: inventory.rows as Row[], kitchenware: kitchenware.rows as Row[], todayDiet: todayDiet.rows as Row[],
      latestHealth: (latestHealth.rows[0] as Row | undefined) || null,
      healthProfile: (healthProfile.rows[0] as Row | undefined) || null,
      personaPrompt: String(setting.rows[0]?.value || ""),
    };
  }
}
