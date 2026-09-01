import type Database from "better-sqlite3";
import type { AiContextRepository } from "./repository.js";
import type { AiContextRows, Row } from "./types.js";

export class SqliteAiContextRepository implements AiContextRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async load(userId: number, date: string): Promise<AiContextRows> {
    const user = this.database.prepare("SELECT username, daily_calories_target FROM users WHERE id = ?").get(userId) as Row | undefined;
    const inventory = this.database.prepare(`SELECT food_name, quantity, expiration_date, storage_location FROM inventory_items
      WHERE user_id = ? AND is_available = 1 ORDER BY expiration_date ASC LIMIT 15`).all(userId) as Row[];
    const kitchenware = this.database.prepare(`SELECT name, category, status FROM kitchenware_items
      WHERE user_id = ? AND deleted_at IS NULL AND status <> '维修中' ORDER BY updated_at DESC LIMIT 20`).all(userId) as Row[];
    const todayDiet = this.database.prepare(`SELECT meal_type, food_name, calories, protein, carbs, fat FROM diet_records
      WHERE user_id = ? AND recorded_at LIKE ? ORDER BY id DESC`).all(userId, `${date}%`) as Row[];
    const latestHealth = this.database.prepare(`SELECT weight, body_fat, water_ml FROM health_logs
      WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(userId) as Row | undefined;
    const healthProfile = this.database.prepare(`SELECT age, dietary_preference, allergies_json, medications, medical_conditions_json,
      medical_notes, dietary_restrictions_json, disliked_foods, kitchen_constraints_json, nutrition_targets_json
      FROM user_health_profiles WHERE user_id = ?`).get(userId) as Row | undefined;
    const setting = this.database.prepare("SELECT value FROM system_settings WHERE key = 'AI_SYSTEM_PROMPT'").get() as { value: string } | undefined;
    return { user: user || null, inventory, kitchenware, todayDiet, latestHealth: latestHealth || null,
      healthProfile: healthProfile || null, personaPrompt: setting?.value || "" };
  }
}
