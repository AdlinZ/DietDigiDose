import type { AiToolDataRepository } from "./repository.js";
import type { DietMealInput, RecipeSearchInput, Row } from "./types.js";

function parseJson(value: unknown) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try { return JSON.parse(String(value || "[]")); } catch { return []; }
}

function round(value: unknown) { return Math.round((Number(value) || 0) * 10) / 10; }

export class AiToolDataService {
  private readonly repository: AiToolDataRepository;

  constructor(repository: AiToolDataRepository) { this.repository = repository; }

  async searchRecipes(input: RecipeSearchInput) {
    const rows = await this.repository.searchRecipes(input);
    return { recipes: rows.map((row) => ({
      recipeId: Number(row.id), name: String(row.title), estimatedTimeMinutes: Number(row.cook_time),
      difficulty: row.difficulty, caloriesPerServing: Number(row.calories), proteinG: Number(row.protein),
      carbohydrateG: Number(row.carbs), fatG: Number(row.fat), tags: parseJson(row.tags),
      ingredients: parseJson(row.ingredients_json),
    })) };
  }

  async lookupFoodNutrition(foodName: string, amount: number, unit: string) {
    const rows = await this.repository.lookupFoodNutrition(foodName);
    const multiplier = unit === "g" || unit === "ml" ? amount / 100 : 1;
    return { matches: rows.map((row: Row) => ({
      matchedFoodName: String(row.name), matchType: row.name === foodName ? "exact_brand" : "fuzzy",
      confidence: row.name === foodName ? 0.9 : 0.55, amount, unit,
      nutrition: {
        caloriesKcal: round(Number(row.calories_100g) * multiplier),
        proteinG: round(Number(row.protein_100g) * multiplier),
        carbohydrateG: round(Number(row.carbs_100g) * multiplier),
        fatG: round(Number(row.fat_100g) * multiplier),
      },
      source: row.source,
      warnings: row.name === foodName ? [] : ["基于模糊食材匹配，品牌和烹饪方式会影响结果"],
    })) };
  }

  recordDietMeal(input: DietMealInput) { return this.repository.recordDietMeal(input); }
}
