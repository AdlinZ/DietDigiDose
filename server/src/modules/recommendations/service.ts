import { effectiveDislikeRecipeIds, learningOverrides, formatLearningState } from "./preferenceEvidence.js";
import { preferenceLearningUpdateSchema, type PreferenceLearningUpdate } from "@dietdigidose/contracts";
import { buildWeeklyPlan } from "./weeklyPlan.js";
import { weeklyPlanRequestSchema, type WeeklyPlanRequest } from "@dietdigidose/contracts";
import { parseJson } from "../mealPlans/formatters.js";
import { buildCookingDraft, replaceCookingDraft } from "./plan.js";
import { cookingPlanDraftSchema, replaceCookingPlanItemSchema, mealPlanRequirementsSchema, type ReplaceCookingPlanItemInput, type MealPlanRequirementsInput } from "@dietdigidose/contracts";
import { formatPreparedMeal } from "../dietRecords/preparedMeals.js";
import { allocatePreparedMeals } from "./requirements.js";
import { resolveKitchenPreferences, type KitchenPreferences } from "@dietdigidose/contracts";
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

  async learningState(userId: number) { return formatLearningState(await this.repository.learningData(userId)); }
  async updateLearning(userId: number,input: PreferenceLearningUpdate) {
    const request = preferenceLearningUpdateSchema.parse(input);
    if (request.kind === "recipe" && !await this.repository.recipeAvailable(request.recipeId)) {
      const own = await this.repository.learningData(userId);
      if (request.value !== "neutral" || (!learningOverrides(own.settings)[String(request.recipeId)] && !own.events.some(event => Number(event.recipe_id) === request.recipeId))) throw new RecommendationsError(404,"菜谱不存在或当前不可设置偏好","RECIPE_NOT_AVAILABLE");
    }
    if (!await this.repository.updateLearning(userId,request)) throw new RecommendationsError(409,"偏好已更新，请刷新后重试","PREFERENCE_VERSION_CONFLICT");
    return this.learningState(userId);
  }
  async weeklyPlan(userId: number, input: WeeklyPlanRequest) {
    const request = weeklyPlanRequestSchema.parse(input);
    const end = new Date(`${request.startDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+6);
    const endDate = end.toISOString().slice(0,10);
    const [computed,stock,batches,state] = await Promise.all([this.compute(userId,{ surface: "meal_plan" }),this.repository.inventory(userId),this.repository.preparedMeals(userId),this.repository.planningState(userId,request.startDate,endDate)]);
    const reservations: Array<{ preparedMealId: string; servings: number }> = [];
    const items = [...state.items];
    for (const plan of state.plans) {
      const constraints = parseJson<Row>(plan.constraints_json,{});
      const saved = constraints.savedCookingDraft as { draft?: unknown } | undefined;
      const draft = cookingPlanDraftSchema.safeParse(constraints.currentCookingDraft ?? saved?.draft);
      if (!draft.success) continue;
      for (const meal of draft.data.meals) {
        if (meal.date < request.startDate || meal.date > endDate) continue;
        reservations.push(...meal.allocations);
        if (meal.cookServings === 0) items.push({ id: `prepared-plan:${plan.id}:${meal.id}`,planned_date: meal.date,meal_type: meal.mealType,title: meal.allocations.map(item => item.foodName).join("、"),prepared_only: true,status: "planned" });
      }
    }
    return buildWeeklyPlan(request,computed.profile.kitchen,computed.results,stock,batches.map(formatPreparedMeal),items,state.shopping,reservations);
  }

  async planRequirements(userId: number, input: MealPlanRequirementsInput) {
    const request = mealPlanRequirementsSchema.parse(input);
    return allocatePreparedMeals(request, (await this.repository.preparedMeals(userId)).map(formatPreparedMeal));
  }

  async cookingPlan(userId: number, input: MealPlanRequirementsInput) {
    const requirements = await this.planRequirements(userId, input);
    const candidates = await this.compute(userId, { surface: "meal_plan" }, input.preferences);
    return cookingPlanDraftSchema.parse({ ...buildCookingDraft(requirements, candidates.results, await this.repository.inventory(userId), candidates.timeBudget!),
      effectivePreferences: candidates.profile.kitchen });
  }

  async replaceCookingItem(userId: number, input: ReplaceCookingPlanItemInput) {
    const request = replaceCookingPlanItemSchema.parse(input);
    const candidates = await this.compute(userId, { surface: "meal_plan" }, request.draft.effectivePreferences);
    const dates = request.draft.meals.map(meal => meal.date).sort();
    const existing = request.draft.planningMode === "weekly" ? (await this.repository.planningState(userId,dates[0],dates[dates.length-1])).items : [];
    return replaceCookingDraft(request.draft, request.targetMealId, request.recipeId, candidates.results, await this.repository.inventory(userId),existing);
  }

  versions() { return { scoringVersion: RECIPE_SCORING_VERSION, candidateVersion: RECIPE_CANDIDATE_VERSION }; }

  async compute(userId: number, input: Omit<RecommendationInput, "cursor" | "pageSize">, override: KitchenPreferences = {}) {
    const profile = formatRecommendationProfile(await this.repository.profile(userId));
    profile.kitchen = resolveKitchenPreferences(profile.kitchen, override);
    const timeBudget = input.maxCookTime ?? resolveKitchenPreferences(profile.kitchen).meal_time_minutes;
    const [inventory, kitchenware, recipes, favoriteIds, recentIds, learning, diet, dailyCaloriesTarget] = await Promise.all([
      this.repository.inventory(userId), this.repository.kitchenware(userId), this.repository.recipes({
        category: input.category, search: input.search, timeBudget,
      }), this.repository.favoriteRecipeIds(userId), this.repository.recentRecipeIds(userId),
      this.repository.learningData(userId), this.repository.dietTotals(userId, currentDateKey()),
      this.repository.dailyCaloriesTarget(userId),
    ]);
    const requirementEntries = await Promise.all(recipes.map(async (recipe) => [Number(recipe.id), await this.kitchenware.requirements(Number(recipe.id))] as const));
    const compatibilityEntries = await Promise.all(recipes.map(async (recipe) => [Number(recipe.id), await this.kitchenware.evaluateRequirements(userId, Number(recipe.id))] as const));
    const dataset: RecommendationDataset = {
      profile, inventory, kitchenware, recipes, favoriteIds, recentIds, skippedIds: effectiveDislikeRecipeIds(learning), explicitDislikedIds: Object.entries(learningOverrides(learning.settings)).filter(([,value]) => value.value === "dislike").map(([id]) => Number(id)), diet, dailyCaloriesTarget,
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
