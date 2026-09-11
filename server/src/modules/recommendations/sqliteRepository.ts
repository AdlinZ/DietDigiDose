import { quantityEvidenceStatus } from "../inventory/evidence.js";
import type Database from "better-sqlite3";
import type { RecommendationRequestWrite, RecipeQuery, RecommendationsRepository } from "./repository.js";
import type { RecommendationEventInput, Row } from "./types.js";

export class SqliteRecommendationsRepository implements RecommendationsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }
  async planningState(userId: number, startDate: string, endDate: string) {
    return {
      items: this.database.prepare("SELECT i.* FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=? AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('active','completed') AND i.planned_date BETWEEN ? AND ? ORDER BY i.planned_date,i.id").all(userId,startDate,endDate) as Row[],
      plans: this.database.prepare("SELECT id,constraints_json FROM meal_plans WHERE user_id=? AND deleted_at IS NULL AND status='active' AND start_date<=? AND end_date>=?").all(userId,endDate,startDate) as Row[],
      shopping: this.database.prepare("SELECT id,name,amount,checked FROM shopping_list_items WHERE user_id=? AND deleted_at IS NULL ORDER BY id").all(userId) as Row[],
    };
  }
  async preparedMeals(userId: number) { return this.database.prepare("SELECT * FROM prepared_meals WHERE user_id=? AND remaining_servings>0 ORDER BY produced_at,id").all(userId) as Row[]; }
  async profile(userId: number) { return (this.database.prepare(`SELECT allergies_json, dietary_restrictions_json, disliked_foods,
    kitchen_constraints_json, nutrition_targets_json, updated_at FROM user_health_profiles WHERE user_id = ?`).get(userId) as Row | undefined) || null; }
  async inventory(userId: number): Promise<Row[]> { const rows = this.database.prepare(`SELECT id, food_name, expiration_date, updated_at, quantity_value, quantity_unit, batch_code, version, (SELECT metadata_json FROM inventory_change_logs e WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id AND json_extract(e.metadata_json,'$.field_evidence.quantity.status') IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence FROM inventory_items
    WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date, id`).all(userId) as Row[]; return rows.map(row => ({ ...row, quantity_evidence_status: quantityEvidenceStatus(row.quantity_evidence, row.version) })); }
  async kitchenware(userId: number) { return this.database.prepare(`SELECT name, updated_at FROM kitchenware_items
    WHERE user_id = ? AND deleted_at IS NULL AND status <> '维修中' ORDER BY id`).all(userId) as Row[]; }
  async recipes(query: RecipeQuery) {
    const filters = ["deleted_at IS NULL", "status = 'approved'", "COALESCE(quality_status, 'trusted') <> 'needs_review'"];
    const params: Array<string | number> = [];
    if (query.category && query.category !== "全部" && query.category !== "冰箱可做") { filters.push("category = ?"); params.push(query.category); }
    if (query.search) { filters.push("(title LIKE ? OR description LIKE ? OR tags LIKE ? OR ingredients_json LIKE ?)");
      const term = `%${query.search}%`; params.push(term, term, term, term); }
    if (query.timeBudget) { filters.push("cook_time <= ?"); params.push(query.timeBudget); }
    return this.database.prepare(`SELECT * FROM recipes WHERE ${filters.join(" AND ")} ORDER BY id`).all(...params) as Row[];
  }
  async favoriteRecipeIds(userId: number) { return (this.database.prepare("SELECT recipe_id FROM recipe_favorites WHERE user_id = ?")
    .all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id); }
  async recentRecipeIds(userId: number) { return (this.database.prepare(`SELECT DISTINCT recipe_id FROM cooking_queue_items
    WHERE user_id = ? AND status = 'completed' AND updated_at >= datetime('now', '-30 day')`).all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id); }
  async skippedRecipeIds(userId: number) { return (this.database.prepare(`SELECT DISTINCT recipe_id FROM recipe_recommendation_events
    WHERE user_id = ? AND event_type = 'skip' AND created_at >= datetime('now', '-30 day')`).all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id); }
  async dietTotals(userId: number, date: string) { const row = this.database.prepare(`SELECT COALESCE(SUM(calories), 0) AS calories,
    COALESCE(SUM(protein), 0) AS protein FROM diet_records WHERE user_id = ? AND recorded_at = ?`).get(userId, date) as { calories: number; protein: number };
    return { calories: Number(row.calories), protein: Number(row.protein) }; }
  async dailyCaloriesTarget(userId: number) { const row = this.database.prepare("SELECT daily_calories_target FROM users WHERE id = ?").get(userId) as { daily_calories_target: number } | undefined;
    return Number(row?.daily_calories_target || 2000); }
  async findRequest(userId: number, requestId: string) { return (this.database.prepare(`SELECT * FROM recipe_recommendation_requests
    WHERE id = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP`).get(requestId, userId) as Row | undefined) || null; }
  async createRequest(input: RecommendationRequestWrite) { this.database.prepare(`INSERT INTO recipe_recommendation_requests
    (id, user_id, surface, scoring_version, candidate_version, input_hash, input_snapshot_json, results_json, data_updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hour'))`).run(input.id, input.userId, input.surface, input.scoringVersion,
    input.candidateVersion, input.inputHash, JSON.stringify(input.inputSnapshot), JSON.stringify(input.results), input.dataUpdatedAt); }
  async findEvent(userId: number, idempotencyKey: string) { return (this.database.prepare(`SELECT * FROM recipe_recommendation_events
    WHERE user_id = ? AND idempotency_key = ?`).get(userId, idempotencyKey) as Row | undefined) || null; }
  async recipeAvailable(recipeId: number) { return Boolean(this.database.prepare(`SELECT id FROM recipes
    WHERE id = ? AND status = 'approved' AND deleted_at IS NULL`).get(recipeId)); }
  async requestScoringVersion(userId: number, requestId: string) { const row = this.database.prepare(`SELECT scoring_version FROM recipe_recommendation_requests
    WHERE id = ? AND user_id = ?`).get(requestId, userId) as { scoring_version: string } | undefined; return row?.scoring_version || null; }
  async createEvent(id: string, userId: number, input: RecommendationEventInput) {
    try {
      this.database.prepare(`INSERT INTO recipe_recommendation_events
        (id, user_id, request_id, recipe_id, event_type, scoring_version, surface, metadata_json, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, input.requestId ?? null, input.recipeId, input.eventType,
        input.scoringVersion, input.surface, JSON.stringify(input.metadata ?? {}), input.idempotencyKey);
      return { id, repeated: false };
    } catch (error) {
      if (!(typeof error === "object" && error && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT"))) throw error;
      const existing = await this.findEvent(userId, input.idempotencyKey);
      if (!existing) throw error;
      return { id: String(existing.id), repeated: true };
    }
  }
}
