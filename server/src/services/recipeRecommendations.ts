import { createHash, randomUUID } from "node:crypto";

import { db } from "../storage/db.js";
import { currentDateKey } from "../utils/date.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";
import { evaluateKitchenwareRequirements, kitchenwareRequirementsForRecipe } from "./kitchenwareCapabilities.js";

export const RECIPE_SCORING_VERSION = "rules-2026-08-26.1";
export const RECIPE_CANDIDATE_VERSION = "sql-public-v1";

export const RECOMMENDATION_WEIGHTS = Object.freeze({
  inventoryCoverage: 35,
  expiringUse: 20,
  missingPenalty: 20,
  timeFit: 15,
  nutritionFit: 10,
  skillFit: 5,
  favorite: 5,
  recentRepeatPenalty: 15,
  skipPenalty: 30,
});

type RecommendationInput = {
  surface: "home" | "inventory" | "ai" | "meal_plan";
  category?: string;
  search?: string;
  maxCookTime?: number;
  matchStatus?: "all" | "full" | "missing_few" | "expiring";
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  pageSize: number;
  cursor?: string;
};

type Row = Record<string, unknown>;

const INGREDIENT_ALIASES: Record<string, string> = {
  西红柿: "番茄", 圣女果: "番茄", 小番茄: "番茄", 青花菜: "西兰花", 马铃薯: "土豆",
  番薯: "红薯", 地瓜: "红薯", 牛油果: "鳄梨", 电饭锅: "电饭煲", 不粘锅: "平底锅",
};

const ALLERGEN_ALIASES: Record<string, string[]> = {
  坚果: ["坚果", "花生", "核桃", "杏仁", "腰果", "榛子", "开心果"],
  花生: ["花生", "花生酱", "花生油"],
  乳糖: ["牛奶", "乳糖", "奶油", "奶酪", "芝士", "酸奶", "炼乳"],
  大豆: ["大豆", "黄豆", "豆浆", "豆腐", "豆皮", "酱油"],
  海鲜: ["海鲜", "虾", "蟹", "贝", "鱼", "鱿鱼", "章鱼"],
  麸质: ["小麦", "面粉", "面包", "面条", "麸质"],
  鸡蛋: ["鸡蛋", "蛋液", "蛋黄", "蛋白"],
};

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function normalizeRecommendationName(value: string) {
  let normalized = value.toLocaleLowerCase()
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/\d+(?:\.\d+)?\s*(?:kg|千克|ml|毫升|[g克升个只颗片份盒包根勺])/gi, "")
    .replace(/新鲜|有机|优质|原切|水培|冷冻|冷藏/g, "")
    .replace(/[\s·、，,。()（）/\\_-]/g, "");
  for (const [alias, canonical] of Object.entries(INGREDIENT_ALIASES)) normalized = normalized.replaceAll(alias.toLocaleLowerCase(), canonical);
  return normalized;
}

function nameMatches(left: string, right: string) {
  const a = normalizeRecommendationName(left);
  const b = normalizeRecommendationName(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function ingredientList(row: Row) {
  return parseArray(row.ingredients_json).flatMap((raw) => {
    if (typeof raw === "string") return raw.trim() ? [{ name: raw.trim(), amount: "" }] : [];
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Row;
    const name = String(item.name || "").trim();
    return name ? [{ name, amount: String(item.amount || "").trim() }] : [];
  });
}

function requiredTools(row: Row) {
  const text = `${row.title || ""} ${row.tags || ""} ${row.steps_json || ""}`;
  const rules: Array<[RegExp, string]> = [
    [/空气炸锅/, "空气炸锅"], [/微波炉/, "微波炉"], [/(?:破壁机|料理机|搅拌机)/, "破壁机"],
    [/(?:烤箱|烘焙)/, "烤箱"], [/(?:电饭煲|电饭锅)/, "电饭煲"], [/(?:蒸锅|蒸笼)/, "蒸锅"],
  ];
  return rules.filter(([pattern]) => pattern.test(text)).map(([, tool]) => tool);
}

function allergyTerms(name: string) {
  const normalized = normalizeRecommendationName(name);
  const alias = Object.entries(ALLERGEN_ALIASES).find(([key]) => normalized.includes(normalizeRecommendationName(key)));
  return [...new Set([name, ...(alias?.[1] || [])])].map(normalizeRecommendationName).filter(Boolean);
}

function daysUntil(dateKey: string) {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${currentDateKey()}T00:00:00Z`)) / 86_400_000);
}

function recipeSummary(row: Row) {
  const governedRequirements = kitchenwareRequirementsForRecipe(Number(row.id));
  return {
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description || ""),
    image_url: row.image_url ? String(row.image_url) : null,
    cook_time: Number(row.cook_time || 0),
    difficulty: String(row.difficulty || "简单"),
    calories: Number(row.calories || 0),
    protein: Number(row.protein || 0),
    carbs: Number(row.carbs || 0),
    fat: Number(row.fat || 0),
    category: String(row.category || "其他"),
    tags: parseArray(row.tags).map(String),
    steps: parseArray(row.steps_json).map(String),
    ingredients: ingredientList(row),
    quality_status: String(row.quality_status || "trusted"),
    nutrition_basis: String(row.nutrition_basis || "source"),
    nutrition_is_estimated: String(row.nutrition_basis || "source") !== "source",
    required_kitchenware: governedRequirements.length
      ? governedRequirements.filter((item) => item.role === "required")
      : requiredTools(row).map((name) => ({ role: "required", catalogName: name, capabilityCode: null })),
  };
}

function getProfile(userId: number) {
  const profile = db.prepare(`SELECT allergies_json, dietary_restrictions_json, disliked_foods,
    kitchen_constraints_json, nutrition_targets_json, updated_at FROM user_health_profiles WHERE user_id = ?`).get(userId) as Row | undefined;
  return {
    allergies: parseArray(profile?.allergies_json).map((item) => item as Row),
    restrictions: parseArray(profile?.dietary_restrictions_json).map(String),
    disliked: String(profile?.disliked_foods || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
    kitchen: parseObject(profile?.kitchen_constraints_json),
    nutrition: parseObject(profile?.nutrition_targets_json),
    updatedAt: profile?.updated_at ? String(profile.updated_at) : null,
  };
}

function hardConflict(recipe: Row, ingredients: Array<{ name: string }>, profile: ReturnType<typeof getProfile>, userId: number, ownedTools: string[], timeBudget: number | null) {
  const recipeText = normalizeRecommendationName(`${recipe.title || ""}${recipe.description || ""}${ingredients.map((item) => item.name).join("")}`);
  for (const allergy of profile.allergies) {
    const name = String(allergy.name || "").trim();
    if (name && allergyTerms(name).some((term) => recipeText.includes(term))) return { code: "allergy", label: `命中已记录的${name}限制` };
  }
  const restrictionText = profile.restrictions.join("、");
  if (/素食|纯素/.test(restrictionText) && /(猪|牛|羊|鸡|鸭|鱼|虾|蟹|肉|蛋|奶)/.test(recipeText)) return { code: "dietary_restriction", label: "不符合素食限制" };
  if (/清真/.test(restrictionText) && /(猪|料酒|酒精)/.test(recipeText)) return { code: "dietary_restriction", label: "不符合清真限制" };
  if (timeBudget && Number(recipe.cook_time || 0) > timeBudget) return { code: "time", label: `预计时间超过 ${timeBudget} 分钟` };
  const governed = evaluateKitchenwareRequirements(userId, Number(recipe.id));
  const missingTools = governed.requirements.length
    ? governed.blocking.map((required) => required.catalogName || required.capabilityCode || "未映射厨具能力")
    : requiredTools(recipe).filter((required) => !ownedTools.some((owned) => nameMatches(required, owned)));
  if (missingTools.length) return { code: "kitchenware", label: `缺少必要厨具：${missingTools.join("、")}` };
  return null;
}

export function computeRecipeRecommendations(userId: number, input: Omit<RecommendationInput, "cursor" | "pageSize">) {
  const profile = getProfile(userId);
  const inventory = db.prepare(`SELECT id, food_name, expiration_date, updated_at FROM inventory_items
    WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL ORDER BY expiration_date, id`).all(userId) as Row[];
  const kitchenware = db.prepare(`SELECT name, updated_at FROM kitchenware_items WHERE user_id = ? AND deleted_at IS NULL AND status <> '维修中' ORDER BY id`)
    .all(userId) as Row[];
  const ownedTools = kitchenware.map((item) => String(item.name));
  const configuredTime = Number(profile.kitchen.meal_time_minutes);
  const timeBudget = input.maxCookTime || (Number.isFinite(configuredTime) && configuredTime > 0 ? configuredTime : null);
  const filters = ["deleted_at IS NULL", "status = 'approved'", "COALESCE(quality_status, 'trusted') <> 'needs_review'"];
  const params: Array<string | number> = [];
  if (input.category && input.category !== "全部" && input.category !== "冰箱可做") { filters.push("category = ?"); params.push(input.category); }
  if (input.search) {
    filters.push("(title LIKE ? OR description LIKE ? OR tags LIKE ? OR ingredients_json LIKE ?)");
    const term = `%${input.search}%`;
    params.push(term, term, term, term);
  }
  if (timeBudget) { filters.push("cook_time <= ?"); params.push(timeBudget); }
  const recipes = db.prepare(`SELECT * FROM recipes WHERE ${filters.join(" AND ")} ORDER BY id`).all(...params) as Row[];
  const favorites = new Set((db.prepare("SELECT recipe_id FROM recipe_favorites WHERE user_id = ?").all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id));
  const recent = new Set((db.prepare(`SELECT DISTINCT recipe_id FROM cooking_queue_items WHERE user_id = ? AND status = 'completed'
    AND updated_at >= datetime('now', '-30 day')`).all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id));
  const skipped = new Set((db.prepare(`SELECT DISTINCT recipe_id FROM recipe_recommendation_events WHERE user_id = ? AND event_type = 'skip'
    AND created_at >= datetime('now', '-30 day')`).all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id));
  const diet = db.prepare(`SELECT COALESCE(SUM(calories), 0) AS calories, COALESCE(SUM(protein), 0) AS protein
    FROM diet_records WHERE user_id = ? AND recorded_at = ?`).get(userId, currentDateKey()) as { calories: number; protein: number };
  const user = db.prepare("SELECT daily_calories_target FROM users WHERE id = ?").get(userId) as { daily_calories_target: number };
  const targetCalories = Number(profile.nutrition.calories_kcal || user.daily_calories_target || 2000);
  const targetProtein = Number(profile.nutrition.protein_g || 0);
  const remainingCalories = Math.max(0, targetCalories - Number(diet.calories || 0));
  const remainingProtein = Math.max(0, targetProtein - Number(diet.protein || 0));
  const mealShare = input.mealType === "snack" ? 0.12 : 0.3;
  const expectedCalories = Math.max(100, remainingCalories * mealShare);
  const expectedProtein = remainingProtein > 0 ? remainingProtein * mealShare : null;
  const dataTimes = [profile.updatedAt, ...inventory.map((item) => item.updated_at), ...kitchenware.map((item) => item.updated_at), ...recipes.map((item) => item.updated_at)]
    .filter((value): value is string => typeof value === "string").sort();
  const dataUpdatedAt = dataTimes.at(-1) || null;

  const results = recipes.flatMap((recipe) => {
    const ingredients = ingredientList(recipe);
    const conflict = hardConflict(recipe, ingredients, profile, userId, ownedTools, timeBudget);
    if (conflict) return [];
    const matched = ingredients.filter((ingredient) => inventory.some((item) => nameMatches(ingredient.name, String(item.food_name))));
    const missing = ingredients.filter((ingredient) => !matched.some((item) => item.name === ingredient.name));
    const expiring = matched.flatMap((ingredient) => inventory
      .filter((item) => nameMatches(ingredient.name, String(item.food_name)) && daysUntil(String(item.expiration_date)) >= 0 && daysUntil(String(item.expiration_date)) <= 3)
      .map((item) => ({ name: String(item.food_name), daysLeft: daysUntil(String(item.expiration_date)) })));
    const coverage = ingredients.length ? matched.length / ingredients.length : 0;
    if (input.category === "冰箱可做" && matched.length === 0) return [];
    if (input.matchStatus === "full" && missing.length > 0) return [];
    if (input.matchStatus === "missing_few" && (missing.length < 1 || missing.length > 2)) return [];
    if (input.matchStatus === "expiring" && expiring.length === 0) return [];
    const cookTime = Number(recipe.cook_time || 0);
    const timeFit = timeBudget ? Math.max(0, 1 - Math.abs(timeBudget - cookTime) / Math.max(timeBudget, 1)) : Math.max(0, 1 - cookTime / 120);
    const calorieFit = Math.max(0, 1 - Math.abs(Number(recipe.calories || 0) - expectedCalories) / Math.max(expectedCalories, 1));
    const proteinFit = expectedProtein ? Math.max(0, 1 - Math.abs(Number(recipe.protein || 0) - expectedProtein) / Math.max(expectedProtein, 1)) : calorieFit;
    const nutritionFit = (calorieFit + proteinFit) / 2;
    const level = String(profile.kitchen.cooking_level || "");
    const difficulty = String(recipe.difficulty || "简单");
    const skillFit = level === "beginner" && /困难|大师/.test(difficulty) ? 0 : level === "advanced" ? 1 : 0.8;
    const dislikedPenalty = profile.disliked.some((name) => ingredients.some((item) => nameMatches(name, item.name))) ? 8 : 0;
    const score = Math.round((
      coverage * RECOMMENDATION_WEIGHTS.inventoryCoverage
      + Math.min(1, expiring.length / 2) * RECOMMENDATION_WEIGHTS.expiringUse
      - Math.min(1, missing.length / Math.max(ingredients.length, 1)) * RECOMMENDATION_WEIGHTS.missingPenalty
      + timeFit * RECOMMENDATION_WEIGHTS.timeFit
      + nutritionFit * RECOMMENDATION_WEIGHTS.nutritionFit
      + skillFit * RECOMMENDATION_WEIGHTS.skillFit
      + (favorites.has(Number(recipe.id)) ? RECOMMENDATION_WEIGHTS.favorite : 0)
      - (recent.has(Number(recipe.id)) ? RECOMMENDATION_WEIGHTS.recentRepeatPenalty : 0)
      - (skipped.has(Number(recipe.id)) ? RECOMMENDATION_WEIGHTS.skipPenalty : 0)
      - dislikedPenalty
    ) * 100) / 100;
    const reasons: string[] = [];
    if (expiring.length) reasons.push(`可优先使用 ${expiring.slice(0, 2).map((item) => item.name).join("、")} 等临期食材`);
    if (coverage > 0) reasons.push(`库存覆盖 ${Math.round(coverage * 100)}%，已具备 ${matched.length} 项食材`);
    if (timeBudget) reasons.push(`预计 ${cookTime} 分钟，符合 ${timeBudget} 分钟时间上限`);
    if (!reasons.length) reasons.push("通过公开权限、质量与安全硬约束检查");
    const degraded: string[] = [];
    if (!ingredients.length) degraded.push("ingredients_unstructured");
    if (profile.kitchen.budget_per_meal) degraded.push("recipe_price_unavailable");
    if (profile.kitchen.servings) degraded.push("recipe_yield_unavailable");
    return [{
      recipeId: Number(recipe.id),
      recipe: recipeSummary(recipe),
      score,
      scoringVersion: RECIPE_SCORING_VERSION,
      candidateVersion: RECIPE_CANDIDATE_VERSION,
      hardConstraints: { satisfied: ["quality", "permission", "allergy", "time", "kitchenware"], unmet: [] as string[] },
      features: {
        inventoryCoverage: Math.round(coverage * 100),
        matchedIngredients: matched,
        expiringIngredients: expiring,
        missingIngredients: missing,
        timeBudgetMinutes: timeBudget,
        estimatedTimeMinutes: cookTime,
        nutritionFit: Math.round(nutritionFit * 100),
        favorite: favorites.has(Number(recipe.id)),
        recentRepeat: recent.has(Number(recipe.id)),
        skippedRecently: skipped.has(Number(recipe.id)),
      },
      reasons: reasons.slice(0, 3),
      dataUpdatedAt,
      degraded,
    }];
  }).sort((a, b) => b.score - a.score || a.recipeId - b.recipeId);
  return { results, dataUpdatedAt, timeBudget, profile };
}

export function getRecipeRecommendationPage(userId: number, input: RecommendationInput) {
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    const requestId = cursor?.requestId;
    const offset = Number(cursor?.offset);
    if (cursor?.v !== 1 || typeof requestId !== "string" || !Number.isInteger(offset) || offset < 0) throw new Error("INVALID_CURSOR");
    const snapshot = db.prepare(`SELECT * FROM recipe_recommendation_requests WHERE id = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP`)
      .get(requestId, userId) as Row | undefined;
    if (!snapshot || snapshot.scoring_version !== RECIPE_SCORING_VERSION) throw new Error("EXPIRED_CURSOR");
    const results = parseArray(snapshot.results_json) as Row[];
    const items = results.slice(offset, offset + input.pageSize);
    return {
      requestId,
      scoringVersion: String(snapshot.scoring_version),
      candidateVersion: String(snapshot.candidate_version),
      dataUpdatedAt: snapshot.data_updated_at ? String(snapshot.data_updated_at) : null,
      items,
      total: results.length,
      nextCursor: offset + items.length < results.length ? encodeCursor({ v: 1, requestId, offset: offset + items.length }) : null,
    };
  }
  const computed = computeRecipeRecommendations(userId, input);
  const requestId = randomUUID();
  const snapshot = {
    ...input,
    timeBudgetMinutes: computed.timeBudget,
    inventoryUpdatedAt: computed.dataUpdatedAt,
  };
  const inputJson = JSON.stringify(snapshot);
  db.prepare(`INSERT INTO recipe_recommendation_requests
    (id, user_id, surface, scoring_version, candidate_version, input_hash, input_snapshot_json, results_json, data_updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hour'))`)
    .run(requestId, userId, input.surface, RECIPE_SCORING_VERSION, RECIPE_CANDIDATE_VERSION,
      createHash("sha256").update(inputJson).digest("hex"), inputJson, JSON.stringify(computed.results), computed.dataUpdatedAt);
  const items = computed.results.slice(0, input.pageSize);
  return {
    requestId,
    scoringVersion: RECIPE_SCORING_VERSION,
    candidateVersion: RECIPE_CANDIDATE_VERSION,
    dataUpdatedAt: computed.dataUpdatedAt,
    items,
    total: computed.results.length,
    nextCursor: items.length < computed.results.length ? encodeCursor({ v: 1, requestId, offset: items.length }) : null,
  };
}
