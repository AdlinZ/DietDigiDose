import type { AiContextRepository } from "./repository.js";
import type { AiContextSnapshot, Row } from "./types.js";

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class AiContextService {
  private readonly repository: AiContextRepository;

  constructor(repository: AiContextRepository) { this.repository = repository; }

  async load(userId: number, date: string): Promise<AiContextSnapshot> {
    const rows = await this.repository.load(userId, date);
    const profile = rows.healthProfile;
    return {
      username: String(rows.user?.username || "用户"),
      dailyCaloriesTarget: Number(rows.user?.daily_calories_target || 2000),
      inventory: rows.inventory.map((row) => ({
        food_name: String(row.food_name || ""), quantity: String(row.quantity || ""),
        expiration_date: String(row.expiration_date || ""), storage_location: String(row.storage_location || ""),
      })),
      kitchenware: rows.kitchenware.map((row) => ({
        name: String(row.name || ""), category: String(row.category || ""), status: String(row.status || ""),
      })),
      todayDiet: rows.todayDiet.map((row) => ({
        meal_type: String(row.meal_type || ""), food_name: String(row.food_name || ""),
        calories: Number(row.calories || 0), protein: Number(row.protein || 0),
        carbs: Number(row.carbs || 0), fat: Number(row.fat || 0),
      })),
      latestHealth: rows.latestHealth ? {
        weight: optionalNumber(rows.latestHealth.weight), body_fat: optionalNumber(rows.latestHealth.body_fat),
        water_ml: optionalNumber(rows.latestHealth.water_ml),
      } : undefined,
      healthProfile: profile ? {
        age: optionalNumber(profile.age) ?? null,
        dietary_preference: String(profile.dietary_preference || ""),
        allergies: jsonValue(profile.allergies_json, []),
        medications: String(profile.medications || ""),
        medical_conditions: jsonValue(profile.medical_conditions_json, []),
        medical_notes: String(profile.medical_notes || ""),
        dietary_restrictions: jsonValue(profile.dietary_restrictions_json, []),
        disliked_foods: String(profile.disliked_foods || ""),
        kitchen_constraints: jsonValue(profile.kitchen_constraints_json, {}),
        nutrition_targets: jsonValue(profile.nutrition_targets_json, {}),
      } : undefined,
      personaPrompt: rows.personaPrompt.trim(),
    };
  }
}

export type { AiContextSnapshot, Row };
