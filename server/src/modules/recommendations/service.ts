import { createHash, randomUUID } from "node:crypto";
import type { KitchenwareService } from "../kitchenware/service.js";
import { currentDateKey } from "../../utils/date.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { RecommendationsError } from "./errors.js";
import type { RecommendationsRepository } from "./repository.js";
import { formatRecommendationProfile, parseArray, RECIPE_CANDIDATE_VERSION, RECIPE_SCORING_VERSION, scoreRecipeRecommendations } from "./scoring.js";
import type { RecommendationDataset, RecommendationEventInput, RecommendationInput, Row } from "./types.js";

export class RecommendationsService {
  private readonly repository: RecommendationsRepository;
  private readonly kitchenware: Pick<KitchenwareService, "requirements" | "evaluateRequirements">;
  constructor(repository: RecommendationsRepository, kitchenware: Pick<KitchenwareService, "requirements" | "evaluateRequirements">) {
    this.repository = repository;
    this.kitchenware = kitchenware;
  }

  versions() { return { scoringVersion: RECIPE_SCORING_VERSION, candidateVersion: RECIPE_CANDIDATE_VERSION }; }

  async compute(userId: number, input: Omit<RecommendationInput, "cursor" | "pageSize">) {
    const profile = formatRecommendationProfile(await this.repository.profile(userId));
    const configuredTime = Number(profile.kitchen.meal_time_minutes);
    const timeBudget = input.maxCookTime || (Number.isFinite(configuredTime) && configuredTime > 0 ? configuredTime : null);
    const [inventory, kitchenware, recipes, favoriteIds, recentIds, skippedIds, diet, dailyCaloriesTarget] = await Promise.all([
      this.repository.inventory(userId), this.repository.kitchenware(userId), this.repository.recipes({
        category: input.category, search: input.search, timeBudget,
      }), this.repository.favoriteRecipeIds(userId), this.repository.recentRecipeIds(userId),
      this.repository.skippedRecipeIds(userId), this.repository.dietTotals(userId, currentDateKey()),
      this.repository.dailyCaloriesTarget(userId),
    ]);
    const requirementEntries = await Promise.all(recipes.map(async (recipe) => [Number(recipe.id), await this.kitchenware.requirements(Number(recipe.id))] as const));
    const compatibilityEntries = await Promise.all(recipes.map(async (recipe) => [Number(recipe.id), await this.kitchenware.evaluateRequirements(userId, Number(recipe.id))] as const));
    const dataset: RecommendationDataset = {
      profile, inventory, kitchenware, recipes, favoriteIds, recentIds, skippedIds, diet, dailyCaloriesTarget,
      requirements: new Map(requirementEntries) as RecommendationDataset["requirements"],
      compatibility: new Map(compatibilityEntries) as RecommendationDataset["compatibility"],
    };
    return scoreRecipeRecommendations(dataset, input, timeBudget, currentDateKey());
  }

  async page(userId: number, input: RecommendationInput) {
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor); const requestId = cursor?.requestId; const offset = Number(cursor?.offset);
      if (cursor?.v !== 1 || typeof requestId !== "string" || !Number.isInteger(offset) || offset < 0) {
        throw new RecommendationsError(400, "推荐游标格式不正确", "INVALID_RECOMMENDATION_CURSOR");
      }
      const snapshot = await this.repository.findRequest(userId, requestId);
      if (!snapshot || snapshot.scoring_version !== RECIPE_SCORING_VERSION) {
        throw new RecommendationsError(410, "本轮推荐已过期，请重新获取", "RECOMMENDATION_CURSOR_EXPIRED");
      }
      const results = parseArray(snapshot.results_json) as Row[]; const items = results.slice(offset, offset + input.pageSize);
      const dataUpdatedAt = snapshot.data_updated_at instanceof Date
        ? snapshot.data_updated_at.toISOString()
        : snapshot.data_updated_at ? String(snapshot.data_updated_at) : null;
      return { requestId, scoringVersion: String(snapshot.scoring_version), candidateVersion: String(snapshot.candidate_version),
        dataUpdatedAt, items, total: results.length,
        nextCursor: offset + items.length < results.length ? encodeCursor({ v: 1, requestId, offset: offset + items.length }) : null };
    }
    const computed = await this.compute(userId, input); const requestId = randomUUID();
    const inputSnapshot = { ...input, timeBudgetMinutes: computed.timeBudget, inventoryUpdatedAt: computed.dataUpdatedAt };
    const inputJson = JSON.stringify(inputSnapshot);
    await this.repository.createRequest({ id: requestId, userId, surface: input.surface, scoringVersion: RECIPE_SCORING_VERSION,
      candidateVersion: RECIPE_CANDIDATE_VERSION, inputHash: createHash("sha256").update(inputJson).digest("hex"),
      inputSnapshot, results: computed.results, dataUpdatedAt: computed.dataUpdatedAt });
    const items = computed.results.slice(0, input.pageSize);
    return { requestId, scoringVersion: RECIPE_SCORING_VERSION, candidateVersion: RECIPE_CANDIDATE_VERSION,
      dataUpdatedAt: computed.dataUpdatedAt, items, total: computed.results.length,
      nextCursor: items.length < computed.results.length ? encodeCursor({ v: 1, requestId, offset: items.length }) : null };
  }

  async event(userId: number, input: RecommendationEventInput) {
    const existing = await this.repository.findEvent(userId, input.idempotencyKey);
    if (existing) return { eventId: String(existing.id), repeated: true };
    if (!await this.repository.recipeAvailable(input.recipeId)) {
      throw new RecommendationsError(404, "菜谱不存在或当前不可推荐", "RECIPE_NOT_AVAILABLE");
    }
    if (input.requestId) {
      const version = await this.repository.requestScoringVersion(userId, input.requestId);
      if (!version) throw new RecommendationsError(404, "推荐请求不存在", "RECOMMENDATION_REQUEST_NOT_FOUND");
      if (version !== input.scoringVersion) throw new RecommendationsError(409, "评分版本与推荐请求不一致", "RECOMMENDATION_VERSION_MISMATCH");
    }
    const result = await this.repository.createEvent(randomUUID(), userId, input);
    return { eventId: result.id, repeated: result.repeated };
  }
}
