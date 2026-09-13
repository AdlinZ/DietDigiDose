import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RecommendationsError } from "../src/modules/recommendations/errors.js";
import type { RecommendationsRepository } from "../src/modules/recommendations/repository.js";
import { configureRecommendationsService, recommendationsService } from "../src/modules/recommendations/runtime.js";
import { RecommendationsService } from "../src/modules/recommendations/service.js";

function repository(overrides: Partial<RecommendationsRepository> = {}) {
  return {
    preferenceOutcomes: async () => ({ production: [],events: [] }),
    learningData: async () => ({ settings: null,events: [],recipes: [] }),
    planningState: async () => ({ items: [],plans: [],shopping: [] }),
    preparedMeals: async () => [], profile: async () => null, inventory: async () => [], kitchenware: async () => [],
    recipes: async () => [{ id: 1, title: "番茄汤", ingredients_json: [{ name: "番茄" }], steps_json: ["煮熟"], status: "approved" }],
    favoriteRecipeIds: async () => [], recentRecipeIds: async () => [], skippedRecipeIds: async () => [],
    dietTotals: async () => ({ calories: 0, protein: 0 }), dailyCaloriesTarget: async () => 2000,
    createRequest: async () => {},
    ...overrides,
  } as RecommendationsRepository;
}
const kitchenware = {
  requirements: async () => [],
  evaluateRequirements: async () => ({ requirements: [], blocking: [] }),
};

describe("recommendations module", () => {
  test("shares the composed service with AI and Agent consumers", () => {
    const service = new RecommendationsService(repository(), kitchenware);
    configureRecommendationsService(service);
    assert.equal(recommendationsService(), service);
  });

  test("scores PostgreSQL-style JSON values and persists a driver-neutral snapshot", async () => {
    let stored: unknown;
    const service = new RecommendationsService(repository({ createRequest: async (input) => { stored = input; } }), kitchenware);
    const page = await service.page(7, { surface: "home", matchStatus: "all", pageSize: 10 });
    assert.equal(page.total, 1);
    assert.equal((page.items[0]?.recipe as Record<string, unknown>).title, "番茄汤");
    assert.equal(typeof page.scoringVersion, "string");
    assert(stored);
  });

  test("maps missing and mismatched request versions to stable errors", async () => {
    const missing = new RecommendationsService(repository({
      findEvent: async () => null, recipeAvailable: async () => true, requestEvidence: async () => null,
    }), kitchenware);
    await assert.rejects(missing.event(7, { requestId: "missing", recipeId: 1, eventType: "view", scoringVersion: "v1",
      surface: "home", idempotencyKey: "event-key-0001" }), (error: unknown) => {
      assert(error instanceof RecommendationsError); assert.equal(error.code, "RECOMMENDATION_REQUEST_NOT_FOUND"); return true;
    });
    const mismatch = new RecommendationsService(repository({
      findEvent: async () => null, recipeAvailable: async () => true, requestEvidence: async () => ({ scoring_version: "v2" }),
    }), kitchenware);
    await assert.rejects(mismatch.event(7, { requestId: "request", recipeId: 1, eventType: "view", scoringVersion: "v1",
      surface: "home", idempotencyKey: "event-key-0002" }), (error: unknown) => {
      assert(error instanceof RecommendationsError); assert.equal(error.code, "RECOMMENDATION_VERSION_MISMATCH"); return true;
    });
  });
});

test("recommendations apply the shared default time and never claim whole-plan feasibility from cook time", async () => {
  const recipe = { id: 1, title: "准备较久的汤", ingredients_json: [{ name: "番茄", amount: "2个" }],
    steps_json: ["煮熟"], status: "approved", cook_time: 20, prep_time: 20, serving_size: 3 };
  const defaults = new RecommendationsService(repository({ recipes: async () => [recipe] }), kitchenware);
  assert.equal((await defaults.compute(7, { surface: "meal_plan" })).timeBudget, 30);
  assert.equal((await defaults.compute(7, { surface: "meal_plan" })).results.length, 0);
  const saved = new RecommendationsService(repository({ recipes: async () => [recipe],
    profile: async () => ({ kitchen_constraints_json: { meal_time_minutes: 45 } }),
  }), kitchenware);
  const result = await saved.compute(7, { surface: "meal_plan" });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].recipe.serving_size, 3);
  assert.equal(result.results[0].recipe.prep_time, 20);
  assert(result.results[0].degraded.includes("whole_plan_time_unverified"));
  assert.doesNotMatch(result.results[0].reasons.join(" "), /符合.*分钟/);
  assert.equal((await saved.compute(7, { surface: "meal_plan", maxCookTime: 30 })).results.length, 0);
});

test("cooking drafts scale portions and share stock across meals without claiming time feasibility", async () => {
  const recipe = { id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }],
    steps_json: ["蒸熟"], status: "approved", cook_time: 15, prep_time: 5, serving_size: 1 };
  const stock = { id: 1, food_name: "鸡蛋", quantity_value: 3, quantity_unit: "piece", expiration_date: "2030-09-20", version: 1, batch_code: "egg" };
  const service = new RecommendationsService(repository({ recipes: async () => [recipe], inventory: async () => [stock] }), kitchenware);
  const result = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [
    { id: "lunch", date: "2030-09-09", mealType: "lunch", servings: 1 },
    { id: "dinner", date: "2030-09-09", mealType: "dinner", servings: 1 },
  ] });
  assert.equal(result.cooking.length, 2);
  assert.deepEqual(result.ingredientBudget.map(item => item.covered_value), [2,1]);
  assert.equal(result.ingredientBudget[1].missing_value, 1);
  assert.equal(result.time.knownSequentialMinutes, 40);
  assert.equal(result.time.exceedsBudget, true);
  assert.equal(result.status, "requires_validation");
  assert.equal(stock.quantity_value, 3);
  const unknownYield = new RecommendationsService(repository({ recipes: async () => [{ ...recipe, serving_size: null }] }), kitchenware);
  const unavailable = await unknownYield.cookingPlan(7, { excludedPreparedMealIds: [], meals: [
    { id: "lunch", date: "2030-09-09", mealType: "lunch", servings: 3 },
  ] });
  assert.equal(unavailable.cooking.length, 0);
  assert.equal(unavailable.unresolved.length, 1);
});

test("one-time plan preferences reach candidate filtering and do not replace long-term defaults", async () => {
  const stored = { kitchen_constraints_json: { meal_time_minutes: 45, servings: 1, refrigeration_available: true } };
  const recipe = { id: 1, title: "慢炖汤", ingredients_json: [{ name: "番茄", amount: "2个" }],
    steps_json: ["煮熟"], status: "approved", cook_time: 30, prep_time: 5, serving_size: 1 };
  const service = new RecommendationsService(repository({ profile: async () => stored, recipes: async () => [recipe] }), kitchenware);
  const request = { excludedPreparedMealIds: [], meals: [{ id: "lunch", date: "2030-09-09", mealType: "lunch" as const, servings: 1 }] };
  const overridden = await service.cookingPlan(7, { ...request, preferences: { meal_time_minutes: 20, refrigeration_available: false } });
  assert.equal(overridden.time.budgetMinutes, 20);
  assert.equal(overridden.cooking.length, 0);
  assert.equal(overridden.effectivePreferences.refrigeration_available, false);
  const next = await service.cookingPlan(7, request);
  assert.equal(next.time.budgetMinutes, 45);
  assert.equal(next.cooking.length, 1);
  assert.equal(next.effectivePreferences.refrigeration_available, true);
  assert.deepEqual(stored.kitchen_constraints_json, { meal_time_minutes: 45, servings: 1, refrigeration_available: true });
});

test("local replacement preserves other cooking entries and allocations while recomputing shared stock and time", async () => {
  const recipes = [
    { id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }], steps_json: ["蒸熟"], status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 },
    { id: 2, title: "厚蛋烧", ingredients_json: [{ name: "鸡蛋", amount: "3枚" }], steps_json: ["煎熟"], status: "approved", cook_time: 15, prep_time: 5, serving_size: 1 },
  ];
  const stock = { id: 1, food_name: "鸡蛋", quantity_value: 4, quantity_unit: "piece", expiration_date: "2030-09-20", version: 1, batch_code: "egg" };
  let offerReplacement = false;
  const service = new RecommendationsService(repository({ recipes: async () => offerReplacement ? recipes : [recipes[0]], inventory: async () => [stock] }), kitchenware);
  const generated = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [
    { id: "lunch", date: "2030-09-09", mealType: "lunch", servings: 1 },
    { id: "dinner", date: "2030-09-09", mealType: "dinner", servings: 1 },
  ] });
  const { cookingPlanDraftSchema } = await import("@dietdigidose/contracts");
  const draft = cookingPlanDraftSchema.parse(generated);
  assert.deepEqual(draft.cooking.map(item => item.recipeId), [1, 1]);
  draft.meals[0].servings = 1.5;
  draft.meals[0].preparedServings = 0.5;
  draft.meals[0].allocations = [{ preparedMealId: "52a6a5f0-4fa8-45a2-812f-8dbb1461d194", version: 3,
    foodName: "昨天的待吃餐", servings: 0.5, validationRequired: true }];
  draft.excludedPreparedMealIds = ["a7ed002b-e9c1-428a-851d-44d27ae68194"];
  const original = structuredClone(draft);
  offerReplacement = true;
  const replaced = await service.replaceCookingItem(7, { draft, targetMealId: "dinner", recipeId: 2 });
  assert.equal(replaced.draft.cooking[1].recipeId, 2);
  assert.deepEqual(replaced.draft.cooking[0], original.cooking[0]);
  assert.deepEqual(replaced.draft.meals, original.meals);
  assert.deepEqual(replaced.draft.excludedPreparedMealIds, original.excludedPreparedMealIds);
  assert.equal(replaced.draft.ingredientBudget[1].missing_value, 1);
  assert.equal(replaced.draft.time.knownSequentialMinutes, 35);
  assert.equal(replaced.draft.time.exceedsBudget, true);
  assert(replaced.conflicts.some(message => message.includes("鸡蛋")));
  assert(replaced.conflicts.some(message => message.includes("35")));
  assert.deepEqual(draft, original);
  assert.equal(stock.quantity_value, 4);
  await assert.rejects(service.replaceCookingItem(7, { draft, targetMealId: "missing" }), (error: unknown) => {
    assert(error instanceof RecommendationsError); assert.equal(error.code, "COOKING_PLAN_TARGET_AMBIGUOUS"); return true;
  });
  await assert.rejects(service.replaceCookingItem(7, { draft, targetMealId: "dinner", recipeId: 999 }), (error: unknown) => {
    assert(error instanceof RecommendationsError); assert.equal(error.code, "COOKING_PLAN_NO_REPLACEMENT"); return true;
  });
  assert.deepEqual(draft, original);
});


test("cooking drafts do not count estimated inventory as a certain supply", async () => {
  const service = new RecommendationsService(repository({
    recipes: async () => [{ id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }],
      steps_json: ["蒸熟"], status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 }],
    inventory: async () => [{ id: 1, food_name: "鸡蛋", quantity_value: 10, quantity_unit: "piece", expiration_date: "2030-09-20",
      version: 1, batch_code: "scan", quantity_evidence_status: "estimated" }],
  }), kitchenware);
  const draft = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [{ id: "dinner", date: "2030-09-09", mealType: "dinner", servings: 1 }] });
  assert.equal(draft.ingredientBudget[0].quantity_status, "unknown");
  assert.equal(draft.ingredientBudget[0].fully_covered, false);
  assert.equal(draft.ingredientBudget[0].covered_value, 0);
});

test("full-stock recommendations require enough known quantities for the requested portions", async () => {
  let stock: Record<string, unknown> = { id: 1, food_name: "鸡蛋", quantity_value: 1, quantity_unit: "piece", expiration_date: "2030-09-20", version: 1 };
  const service = new RecommendationsService(repository({
    recipes: async () => [{ id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }], steps_json: ["蒸熟"],
      status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 }], inventory: async () => [stock],
  }), kitchenware);
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" })).results.length, 0);
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "missing_few" })).results.length, 1);
  stock = { ...stock, quantity_value: 2 };
  const full = await service.compute(7, { surface: "inventory", matchStatus: "full" });
  assert.equal(full.results.length, 1);
  assert.equal(full.results[0].features.inventoryCoverage, 100);
  assert.deepEqual(full.results[0].features.inventoryEvidence, { version: 1, scope: "personal", allocations: [{ itemId: 1, itemVersion: 1, amount: 2, unit: "piece" }] });
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" }, { servings: 2 })).results.length, 0);
  stock = { ...stock, expiration_date: "2000-01-01" };
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" })).results.length, 0);
  const expired = await service.compute(7, { surface: "inventory" });
  assert.equal(expired.results[0].features.inventoryCoverage, 0);
  assert.deepEqual(expired.results[0].features.inventoryEvidence.allocations, []);
  assert.deepEqual(expired.results[0].features.missingIngredients, [{ name: "鸡蛋", amount: "2枚" }]);
  stock = { ...stock, expiration_date: "2030-09-20" };
  stock = { ...stock, quantity_evidence_status: "estimated" };
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" })).results.length, 0);
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "missing_few" })).results.length, 0);
  const unknown = await service.compute(7, { surface: "inventory" });
  assert.equal(unknown.results[0].features.uncertainIngredients.length, 1);
  assert.equal(unknown.results[0].features.missingIngredients.length, 0);
});

test("cooking drafts do not allocate expired raw ingredients", async () => {
  const service = new RecommendationsService(repository({
    recipes: async () => [{ id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }], steps_json: ["蒸熟"], status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 }],
    inventory: async () => [{ id: 1, food_name: "鸡蛋", quantity_value: 100, quantity_unit: "piece", expiration_date: "2000-01-01", version: 1 }],
  }), kitchenware);
  const draft = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [{ id: "dinner", date: "2030-09-10", mealType: "dinner", servings: 1 }] });
  assert.equal(draft.ingredientBudget[0].fully_covered, false);
  assert.deepEqual(draft.ingredientBudget[0].deductions, []);
});

test("weekly replacement reloads current commitments for the owner and week", async () => {
  const recipes = [1,2].map(id => ({ id,title: `蛋羹${id}`,ingredients_json: [{ name: "鸡蛋",amount: "1个" }],steps_json: ["蒸熟"],status: "approved",cook_time: 5,prep_time: 2,serving_size: 1 }));
  const stock = { id: 1,food_name: "鸡蛋",quantity_value: 4,quantity_unit: "piece",expiration_date: "2099-09-30",version: 1,batch_code: null };
  let committed = false;
  const service = new RecommendationsService(repository({ recipes: async () => recipes,inventory: async () => [stock],planningState: async (userId,start,end) => {
    assert.equal(userId,7); assert.equal(start,"2099-09-12"); assert.equal(end,"2099-09-18");
    return { plans: [],shopping: [],items: committed ? [{ id: "other",planned_date: "2099-09-12",meal_type: "晚餐",title: "已确认",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }] : [] };
  } }),kitchenware);
  const preview = await service.weeklyPlan(7,{ startDate: "2099-09-12",mealTypes: ["lunch"] });
  committed = true;
  const target = preview.draft!.cooking[0];
  const updated = await service.replaceCookingItem(7,{ draft: preview.draft!,targetMealId: target.targetMealId,recipeId: target.recipeId === 1 ? 2 : 1 });
  assert.equal(updated.draft.weeklyShopping![0].required,9);
  assert.equal(updated.draft.weeklyShopping![0].missing,5);
});

test("today's no-spicy condition filters known spicy recipes without saving long-term preferences",async () => {
  const stored = { kitchen_constraints_json: { avoid_spicy: false,meal_time_minutes: 30 } };
  const recipes = [
    { id: 1,title: "辣椒炒蛋",ingredients_json: [{ name: "辣椒",amount: "1个" }],tags: [] as string[],steps_json: ["炒熟"],status: "approved",cook_time: 5,prep_time: 2,serving_size: 1 },
    { id: 2,title: "蒸蛋",ingredients_json: [{ name: "鸡蛋",amount: "1个" }],tags: [] as string[],steps_json: ["蒸熟"],status: "approved",cook_time: 5,prep_time: 2,serving_size: 1 },
  ];
  recipes.push({ ...recipes[1],id: 3,title: "辣味标记",tags: ["香辣"] } as typeof recipes[number]);
  recipes.push({ ...recipes[1],id: 4,title: "原料不明",ingredients_json: [] });
  const service = new RecommendationsService(repository({ profile: async () => stored,recipes: async () => recipes }),kitchenware);
  const transient = await service.compute(7,{ surface: "meal_plan" },{ avoid_spicy: true });
  assert.deepEqual(transient.results.map(item => item.recipeId),[2]);
  assert.equal(stored.kitchen_constraints_json.avoid_spicy,false);
  assert.equal((await service.compute(7,{ surface: "meal_plan" })).results.length,4);
  stored.kitchen_constraints_json.avoid_spicy = true;
  assert.deepEqual((await service.compute(7,{ surface: "meal_plan" })).results.map(item => item.recipeId),[2]);
  assert.equal((await service.compute(7,{ surface: "meal_plan" },{ avoid_spicy: false })).results.length,4);
  assert.equal(stored.kitchen_constraints_json.avoid_spicy,true);
});

test("selection evidence is taken from the saved candidate and cannot be forged in client metadata", async () => {
  let stored: Record<string, unknown> | undefined;
  let candidates: unknown = [{ recipeId: 1, features: { inventoryEvidence: { version: 1, scope: "personal", allocations: [{ itemId: 12, itemVersion: 3, amount: 1, unit: "piece" }] } } }];
  const service = new RecommendationsService(repository({
    findEvent: async () => null, recipeAvailable: async () => true,
    requestEvidence: async () => ({ scoring_version: "v1", results_json: candidates }),
    createEvent: async (_id, _userId, input) => { stored = input; return { id: "event", repeated: false }; },
  }), kitchenware);
  const input = { requestId: "request", recipeId: 1, eventType: "view", scoringVersion: "v1", surface: "inventory", idempotencyKey: "evidence-key", metadata: { selectionEvidence: { forged: true } } };
  await service.event(7, input);
  assert.deepEqual(stored?.metadata, { selectionEvidence: { version: 1, requestId: "request", recipeId: 1,
    inventory: { version: 1, scope: "personal", allocations: [{ itemId: 12, itemVersion: 3, amount: 1, unit: "piece" }] } } });
  candidates = JSON.stringify([{ recipeId: 1, features: {} }]);
  await service.event(7, input);
  assert.equal(((stored?.metadata as Record<string, unknown>).selectionEvidence as Record<string, unknown>).inventory, null, "historical missing evidence stays unknown");
  await service.event(7, { ...input, requestId: undefined });
  assert.deepEqual(stored?.metadata, {}, "standalone events cannot invent request provenance");
  await assert.rejects(service.event(7, { ...input, recipeId: 2 }), (error: unknown) => error instanceof RecommendationsError && error.code === "RECOMMENDATION_RECIPE_MISMATCH");
});

test("feedback keys cannot be reused for another recipe or for a different concurrent winner", async () => {
  const input = { recipeId: 1, eventType: "view", scoringVersion: "v1", surface: "inventory", idempotencyKey: "identity-key" };
  const winner = { id: "winner", request_id: null, recipe_id: 2, event_type: "view", scoring_version: "v1", surface: "inventory" };
  for (const race of [false, true]) {
    let reads = 0;
    const service = new RecommendationsService(repository({
      findEvent: async () => race && reads++ === 0 ? null : winner,
      recipeAvailable: async () => true,
      createEvent: async () => ({ id: "winner", repeated: true }),
    }), kitchenware);
    await assert.rejects(service.event(7, input), (error: unknown) => error instanceof RecommendationsError && error.code === "RECOMMENDATION_EVENT_CONFLICT");
  }
});

test("intervention snapshots use local-day stock and preserve engine hard-constraint filtering", async () => {
  const dates: string[] = [];
  const stock = [{ id: 11,food_name: "番茄",expiration_date: "2026-09-12",quantity_value: 5,quantity_unit: "piece",version: 1 }];
  const recipe = { id: 1,title: "番茄汤",ingredients_json: [{ name: "番茄",amount: "1个" }],steps_json: ["煮熟"],status: "approved",cook_time: 10,prep_time: 5,serving_size: 1 };
  const service = new RecommendationsService(repository({ inventory: async () => stock,recipes: async () => [recipe],
    planningState: async (_user,start,end) => { dates.push(start,end);return { items: [],plans: [],shopping: [] }; },
    dietTotals: async (_user,date) => { dates.push(date);return { calories: 0,protein: 0 }; },
  }),kitchenware);
  const snapshot = await service.interventionSnapshot(7,Date.parse("2026-09-13T00:30:00Z"),"America/Los_Angeles");
  assert.deepEqual(snapshot.dates,["2026-09-12","2026-09-13"]);
  assert.deepEqual(dates.sort(),["2026-09-12","2026-09-12","2026-09-13"]);
  assert.equal(snapshot.inventory[0].userId,7);
  assert.deepEqual(snapshot.recommendations[0].inventoryIds,[11]);
  const blocked = new RecommendationsService(repository({ inventory: async () => stock,recipes: async () => [recipe],
    profile: async () => ({ allergies_json: [{ name: "番茄" }] }),planningState: async () => ({ items: [],plans: [],shopping: [] }),
  }),kitchenware);
  assert.deepEqual((await blocked.interventionSnapshot(7,Date.parse("2026-09-13T00:30:00Z"),"America/Los_Angeles")).recommendations,[]);
});

test("single-session recommendations use only unallocated portions across all active plans", async () => {
  const batch = { id: "52a6a5f0-4fa8-45a2-812f-8dbb1461d194", version: 1, food_name: "昨天的饭", remaining_servings: 2,
    produced_servings: 2, produced_at: "2030-09-08T12:00:00Z", nutrition_per_serving_json: {} };
  let plans: Array<Record<string, unknown>> = [];
  const service = new RecommendationsService(repository({ preparedMeals: async () => [batch], planningState: async () => ({ items: [], shopping: [], plans }) }), kitchenware);
  const request = { meals: [{ id: "dinner", date: "2030-09-09", mealType: "dinner" as const, servings: 1 }], excludedPreparedMealIds: [] };
  const initial = await service.cookingPlan(7, request);
  const draft = { ...initial, meals: initial.meals.map(meal => ({ ...meal, date: "2030-09-08" })) };
  plans = [{ constraints_json: JSON.stringify({ savedCookingDraft: { draft } }) }];
  const partial = await service.planRequirements(7, { ...request, meals: [{ ...request.meals[0], servings: 2 }] });
  assert.equal(partial.meals[0].preparedServings, 1);
  assert.equal(partial.meals[0].cookServings, 1);
  plans.push({ constraints_json: { currentCookingDraft: initial } });
  assert.equal((await service.planRequirements(7, request)).meals[0].preparedServings, 0);
  plans = [];
  assert.equal((await service.planRequirements(7, request)).meals[0].preparedServings, 1);
  assert.equal(batch.remaining_servings, 2, "recommendation must not consume the batch");
});
