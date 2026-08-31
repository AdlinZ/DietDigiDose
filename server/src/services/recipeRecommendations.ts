import { createHash, randomUUID } from "node:crypto";
import { db } from "../storage/db.js";
import { currentDateKey } from "../utils/date.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";
import {
  formatRecommendationProfile, normalizeRecommendationName, parseArray,
  RECIPE_CANDIDATE_VERSION, RECIPE_SCORING_VERSION, RECOMMENDATION_WEIGHTS, scoreRecipeRecommendations,
} from "../modules/recommendations/scoring.js";
import type { RecommendationDataset, RecommendationInput, Row } from "../modules/recommendations/types.js";
import { evaluateKitchenwareRequirements, kitchenwareRequirementsForRecipe } from "./kitchenwareCapabilities.js";

export { normalizeRecommendationName, RECIPE_CANDIDATE_VERSION, RECIPE_SCORING_VERSION, RECOMMENDATION_WEIGHTS };

export function computeRecipeRecommendations(userId: number, input: Omit<RecommendationInput, "cursor" | "pageSize">) {
  const profileRow = db.prepare(`SELECT allergies_json, dietary_restrictions_json, disliked_foods,
    kitchen_constraints_json, nutrition_targets_json, updated_at FROM user_health_profiles WHERE user_id = ?`).get(userId) as Row | undefined;
  const profile = formatRecommendationProfile(profileRow || null);
  const configuredTime = Number(profile.kitchen.meal_time_minutes);
  const timeBudget = input.maxCookTime || (Number.isFinite(configuredTime) && configuredTime > 0 ? configuredTime : null);
  const inventory = db.prepare(`SELECT id, food_name, expiration_date, updated_at FROM inventory_items
    WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL ORDER BY expiration_date, id`).all(userId) as Row[];
  const kitchenware = db.prepare(`SELECT name, updated_at FROM kitchenware_items WHERE user_id = ? AND deleted_at IS NULL
    AND status <> '维修中' ORDER BY id`).all(userId) as Row[];
  const filters = ["deleted_at IS NULL", "status = 'approved'", "COALESCE(quality_status, 'trusted') <> 'needs_review'"];
  const params: Array<string | number> = [];
  if (input.category && input.category !== "全部" && input.category !== "冰箱可做") { filters.push("category = ?"); params.push(input.category); }
  if (input.search) { filters.push("(title LIKE ? OR description LIKE ? OR tags LIKE ? OR ingredients_json LIKE ?)");
    const term = `%${input.search}%`; params.push(term, term, term, term); }
  if (timeBudget) { filters.push("cook_time <= ?"); params.push(timeBudget); }
  const recipes = db.prepare(`SELECT * FROM recipes WHERE ${filters.join(" AND ")} ORDER BY id`).all(...params) as Row[];
  const favoriteIds = (db.prepare("SELECT recipe_id FROM recipe_favorites WHERE user_id = ?").all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id);
  const recentIds = (db.prepare(`SELECT DISTINCT recipe_id FROM cooking_queue_items WHERE user_id = ? AND status = 'completed'
    AND updated_at >= datetime('now', '-30 day')`).all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id);
  const skippedIds = (db.prepare(`SELECT DISTINCT recipe_id FROM recipe_recommendation_events WHERE user_id = ? AND event_type = 'skip'
    AND created_at >= datetime('now', '-30 day')`).all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id);
  const dietRow = db.prepare(`SELECT COALESCE(SUM(calories), 0) AS calories, COALESCE(SUM(protein), 0) AS protein
    FROM diet_records WHERE user_id = ? AND recorded_at = ?`).get(userId, currentDateKey()) as { calories: number; protein: number };
  const user = db.prepare("SELECT daily_calories_target FROM users WHERE id = ?").get(userId) as { daily_calories_target: number };
  const requirements = new Map(recipes.map((recipe) => [Number(recipe.id), kitchenwareRequirementsForRecipe(Number(recipe.id))]));
  const compatibility = new Map(recipes.map((recipe) => [Number(recipe.id), evaluateKitchenwareRequirements(userId, Number(recipe.id))]));
  const dataset = { profile, inventory, kitchenware, recipes, favoriteIds, recentIds, skippedIds,
    diet: { calories: Number(dietRow.calories || 0), protein: Number(dietRow.protein || 0) },
    dailyCaloriesTarget: Number(user.daily_calories_target || 2000), requirements, compatibility } as RecommendationDataset;
  return scoreRecipeRecommendations(dataset, input, timeBudget, currentDateKey());
}

export function getRecipeRecommendationPage(userId: number, input: RecommendationInput) {
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor); const requestId = cursor?.requestId; const offset = Number(cursor?.offset);
    if (cursor?.v !== 1 || typeof requestId !== "string" || !Number.isInteger(offset) || offset < 0) throw new Error("INVALID_CURSOR");
    const snapshot = db.prepare(`SELECT * FROM recipe_recommendation_requests WHERE id = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP`)
      .get(requestId, userId) as Row | undefined;
    if (!snapshot || snapshot.scoring_version !== RECIPE_SCORING_VERSION) throw new Error("EXPIRED_CURSOR");
    const results = parseArray(snapshot.results_json) as Row[]; const items = results.slice(offset, offset + input.pageSize);
    return { requestId, scoringVersion: String(snapshot.scoring_version), candidateVersion: String(snapshot.candidate_version),
      dataUpdatedAt: snapshot.data_updated_at ? String(snapshot.data_updated_at) : null, items, total: results.length,
      nextCursor: offset + items.length < results.length ? encodeCursor({ v: 1, requestId, offset: offset + items.length }) : null };
  }
  const computed = computeRecipeRecommendations(userId, input); const requestId = randomUUID();
  const snapshot = { ...input, timeBudgetMinutes: computed.timeBudget, inventoryUpdatedAt: computed.dataUpdatedAt };
  const inputJson = JSON.stringify(snapshot);
  db.prepare(`INSERT INTO recipe_recommendation_requests
    (id, user_id, surface, scoring_version, candidate_version, input_hash, input_snapshot_json, results_json, data_updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hour'))`).run(requestId, userId, input.surface, RECIPE_SCORING_VERSION,
    RECIPE_CANDIDATE_VERSION, createHash("sha256").update(inputJson).digest("hex"), inputJson, JSON.stringify(computed.results), computed.dataUpdatedAt);
  const items = computed.results.slice(0, input.pageSize);
  return { requestId, scoringVersion: RECIPE_SCORING_VERSION, candidateVersion: RECIPE_CANDIDATE_VERSION,
    dataUpdatedAt: computed.dataUpdatedAt, items, total: computed.results.length,
    nextCursor: items.length < computed.results.length ? encodeCursor({ v: 1, requestId, offset: items.length }) : null };
}
