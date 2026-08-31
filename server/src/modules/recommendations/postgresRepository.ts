import type { Pool } from "pg";
import type { RecommendationRequestWrite, RecipeQuery, RecommendationsRepository } from "./repository.js";
import type { RecommendationEventInput, Row } from "./types.js";

export class PostgresRecommendationsRepository implements RecommendationsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async profile(userId: number) { return ((await this.pool.query(`SELECT allergies_json, dietary_restrictions_json, disliked_foods,
    kitchen_constraints_json, nutrition_targets_json, updated_at FROM user_health_profiles WHERE user_id = $1`, [userId])).rows[0] as Row | undefined) || null; }
  async inventory(userId: number) { return (await this.pool.query(`SELECT id, food_name, expiration_date, updated_at FROM inventory_items
    WHERE user_id = $1 AND is_available = TRUE AND deleted_at IS NULL ORDER BY expiration_date, id`, [userId])).rows as Row[]; }
  async kitchenware(userId: number) { return (await this.pool.query(`SELECT name, updated_at FROM kitchenware_items
    WHERE user_id = $1 AND deleted_at IS NULL AND status <> '维修中' ORDER BY id`, [userId])).rows as Row[]; }
  async recipes(query: RecipeQuery) {
    const filters = ["deleted_at IS NULL", "status = 'approved'", "COALESCE(quality_status, 'trusted') <> 'needs_review'"];
    const params: Array<string | number> = [];
    const parameter = (value: string | number) => { params.push(value); return `$${params.length}`; };
    if (query.category && query.category !== "全部" && query.category !== "冰箱可做") filters.push(`category = ${parameter(query.category)}`);
    if (query.search) { const term = parameter(`%${query.search}%`); filters.push(`(title ILIKE ${term} OR description ILIKE ${term}
      OR tags::text ILIKE ${term} OR ingredients_json::text ILIKE ${term})`); }
    if (query.timeBudget) filters.push(`cook_time <= ${parameter(query.timeBudget)}`);
    return (await this.pool.query(`SELECT * FROM recipes WHERE ${filters.join(" AND ")} ORDER BY id`, params)).rows as Row[];
  }
  async favoriteRecipeIds(userId: number) { return (await this.pool.query("SELECT recipe_id FROM recipe_favorites WHERE user_id = $1", [userId])).rows.map((row) => Number(row.recipe_id)); }
  async recentRecipeIds(userId: number) { return (await this.pool.query(`SELECT DISTINCT recipe_id FROM cooking_queue_items
    WHERE user_id = $1 AND status = 'completed' AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`, [userId])).rows.map((row) => Number(row.recipe_id)); }
  async skippedRecipeIds(userId: number) { return (await this.pool.query(`SELECT DISTINCT recipe_id FROM recipe_recommendation_events
    WHERE user_id = $1 AND event_type = 'skip' AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`, [userId])).rows.map((row) => Number(row.recipe_id)); }
  async dietTotals(userId: number, date: string) { const row = (await this.pool.query(`SELECT COALESCE(SUM(calories), 0) AS calories,
    COALESCE(SUM(protein), 0) AS protein FROM diet_records WHERE user_id = $1 AND recorded_at = $2`, [userId, date])).rows[0];
    return { calories: Number(row.calories), protein: Number(row.protein) }; }
  async dailyCaloriesTarget(userId: number) { const row = (await this.pool.query("SELECT daily_calories_target FROM users WHERE id = $1", [userId])).rows[0];
    return Number(row?.daily_calories_target || 2000); }
  async findRequest(userId: number, requestId: string) { return ((await this.pool.query(`SELECT * FROM recipe_recommendation_requests
    WHERE id = $1 AND user_id = $2 AND expires_at > CURRENT_TIMESTAMP`, [requestId, userId])).rows[0] as Row | undefined) || null; }
  async createRequest(input: RecommendationRequestWrite) { await this.pool.query(`INSERT INTO recipe_recommendation_requests
    (id, user_id, surface, scoring_version, candidate_version, input_hash, input_snapshot_json, results_json, data_updated_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, CURRENT_TIMESTAMP + INTERVAL '24 hours')`, [input.id, input.userId,
    input.surface, input.scoringVersion, input.candidateVersion, input.inputHash, JSON.stringify(input.inputSnapshot), JSON.stringify(input.results), input.dataUpdatedAt]); }
  async findEvent(userId: number, idempotencyKey: string) { return ((await this.pool.query(`SELECT * FROM recipe_recommendation_events
    WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey])).rows[0] as Row | undefined) || null; }
  async recipeAvailable(recipeId: number) { return Boolean((await this.pool.query(`SELECT id FROM recipes
    WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL`, [recipeId])).rows[0]); }
  async requestScoringVersion(userId: number, requestId: string) { return (await this.pool.query(`SELECT scoring_version FROM recipe_recommendation_requests
    WHERE id = $1 AND user_id = $2`, [requestId, userId])).rows[0]?.scoring_version || null; }
  async createEvent(id: string, userId: number, input: RecommendationEventInput) {
    const result = await this.pool.query(`INSERT INTO recipe_recommendation_events
      (id, user_id, request_id, recipe_id, event_type, scoring_version, surface, metadata_json, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`,
    [id, userId, input.requestId ?? null, input.recipeId, input.eventType, input.scoringVersion, input.surface,
      JSON.stringify(input.metadata ?? {}), input.idempotencyKey]);
    if (result.rows[0]) return { id, repeated: false };
    const existing = await this.findEvent(userId, input.idempotencyKey);
    if (!existing) throw new Error("RECOMMENDATION_EVENT_CONFLICT");
    return { id: String(existing.id), repeated: true };
  }
}
