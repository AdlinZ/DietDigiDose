import { weeklyShoppingWindow } from "./shoppingWindow.js";
import { scheduleCooking } from "./schedule.js";
import { createPlanningBudget } from "./planningBudget.js";
import { currentDateKey } from "../../utils/date.js";
import { unexpiredInventory } from "./inventoryAvailability.js";
import { recipeDemands } from "./quantities.js";
import { cookingPlanDraftSchema, type CookingPlanDraft } from "@dietdigidose/contracts";
import { RecommendationsError } from "./errors.js";
import { buildFefoConsumptionPreviewFromCandidates, type InventoryUnit } from "../../services/inventoryQuantity.js";
import type { allocatePreparedMeals } from "./requirements.js";
import type { scoreRecipeRecommendations } from "./scoring.js";
import type { Row } from "./types.js";

type Candidate = ReturnType<typeof scoreRecipeRecommendations>["results"][number];
type Demand = { food_name: string; amount_value: number; unit: InventoryUnit };
const demands = (candidate: Candidate, portions: number) => recipeDemands(candidate.recipe.ingredients, candidate.recipe.serving_size, portions);

export function planTime(cooking: CookingPlanDraft["cooking"], candidates: Candidate[], devices: Row[], budgetMinutes: number, prepared = false, unresolved = false) {
  const unavailable = cooking.filter(item => !candidates.some(candidate => candidate.recipeId === item.recipeId));
  const schedule = scheduleCooking(cooking.flatMap(item => {
    const recipe = candidates.find(candidate => candidate.recipeId === item.recipeId)?.recipe;
    return recipe ? [{ ...item, recipe }] : [];
  }), devices);
  schedule.missing.push(...unavailable.map(item => `recipe_unavailable:${item.recipeId}`));
  if (prepared) schedule.missing.push("prepared_reheating_time");
  if (unresolved) schedule.missing.push("unresolved_cooking");
  if (schedule.missing.length) { schedule.complete = false; schedule.elapsedMinutes = null; }
  const preparationUnknown = cooking.some(item => { const recipe = candidates.find(candidate => candidate.recipeId === item.recipeId)?.recipe;
    return !recipe || (!recipe.execution_profile && (!recipe.cook_time || recipe.prep_time == null)); });
  return { budgetMinutes, knownSequentialMinutes: schedule.sequentialMinutes,
    exceedsBudget: (schedule.elapsedMinutes ?? schedule.sequentialMinutes) > budgetMinutes,
    isEstimate: true, incomplete: !schedule.complete,
    missing: [...(schedule.complete ? [] : ["cleanup", "equipment_capacity"]), ...(preparationUnknown ? ["preparation_or_cooking"] : []), ...schedule.missing].slice(0, 50), schedule };
}

export function buildCookingDraft(requirements: ReturnType<typeof allocatePreparedMeals>, candidates: Candidate[], inventory: Row[], timeBudget: number, devices: Row[] = []) {
  const stock = unexpiredInventory(inventory, currentDateKey()).map(item => ({ id: item.id, food_name: item.food_name, quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined, quantity_value: item.quantity_value,
    quantity_unit: item.quantity_unit, expiration_date: item.expiration_date, batch_code: item.batch_code, version: item.version }));
  const planned: Array<{ targetMealId: string; recipeId: number; title: string; servings: number; recipeYield: number; demands: Demand[] }> = [];
  const unresolved: Array<{ targetMealId: string; reason: string }> = [];
  let budget: Demand[] = [];
  for (const target of requirements.meals) {
    if (target.cookServings <= 0) continue;
    const choices = candidates.flatMap(candidate => {
      const needed = demands(candidate, target.cookServings);
      if (!needed) return [];
      const preview = buildFefoConsumptionPreviewFromCandidates(stock, [...budget, ...needed]);
      // Compare unmet demand items, never add incompatible mass/count quantities.
      const unresolvedCount = preview.filter(item => !item.fully_covered).length;
      const unknownCount = preview.filter(item => item.quantity_status === "unknown").length;
      const time = planTime([...planned, { targetMealId: target.id, recipeId: candidate.recipeId, title: candidate.recipe.title,
        servings: target.cookServings, recipeYield: candidate.recipe.serving_size!, demands: needed }], candidates, devices, timeBudget);
      return [{ candidate, needed, unresolvedCount, unknownCount, exceedsTime: time.exceedsBudget }];
    }).sort((a, b) => Number(a.exceedsTime) - Number(b.exceedsTime) || a.unresolvedCount - b.unresolvedCount || a.unknownCount - b.unknownCount || b.candidate.score - a.candidate.score);
    const chosen = choices[0];
    if (!chosen) { unresolved.push({ targetMealId: target.id, reason: "没有通过候选约束且有明确份数与原料用量的菜谱" }); continue; }
    const recipe = chosen.candidate.recipe;
    budget = [...budget, ...chosen.needed];
    planned.push({ targetMealId: target.id, recipeId: chosen.candidate.recipeId, title: recipe.title,
      servings: target.cookServings, recipeYield: recipe.serving_size!, demands: chosen.needed });
  }
  const ingredientBudget = buildFefoConsumptionPreviewFromCandidates(stock, budget);
  const time = planTime(planned, candidates, devices, timeBudget, requirements.meals.some(meal => meal.preparedServings > 0));
  if (unresolved.length) { time.incomplete = true; time.schedule.complete = false; time.schedule.elapsedMinutes = null;
    time.schedule.missing.push("unresolved_cooking"); time.missing.push("unresolved_cooking"); }
  return { ...requirements, cooking: planned, unresolved, ingredientBudget,
    time,
    status: "requires_validation" as const,
    checksPending: [...requirements.checksPending, "storage_and_carry_suitability", "substitution_validation", "execution_stock_refresh"] };
}

/** Reprice the entire draft while changing exactly one cooking entry. */
export function replaceCookingDraft(draft: CookingPlanDraft, targetMealId: string, recipeId: number | undefined, candidates: Candidate[], inventory: Row[], existing: Row[] = [], devices: Row[] = []) {
  const shoppingWindow = draft.planningMode === "weekly" ? weeklyShoppingWindow(draft,existing) : undefined;
  const targets = draft.cooking.filter(item => item.targetMealId === targetMealId);
  if (targets.length !== 1) throw new RecommendationsError(409, "请先指定唯一需要替换的新做菜", "COOKING_PLAN_TARGET_AMBIGUOUS");
  const target = targets[0];
  const choices = candidates.filter(candidate => candidate.recipeId !== target.recipeId && (recipeId === undefined || candidate.recipeId === recipeId)).flatMap(candidate => {
    const needed = demands(candidate, target.servings);
    if (!needed) return [];
    const replacement = { targetMealId, recipeId: candidate.recipeId, title: candidate.recipe.title,
      servings: target.servings, recipeYield: candidate.recipe.serving_size!, demands: needed };
    const cooking = draft.cooking.map(item => item.targetMealId === targetMealId ? replacement : item);
    const singleBudget = buildFefoConsumptionPreviewFromCandidates(unexpiredInventory(inventory, currentDateKey()).map(item => ({ id: item.id, food_name: item.food_name,
      quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined, quantity_value: item.quantity_value, quantity_unit: item.quantity_unit, expiration_date: item.expiration_date,
      batch_code: item.batch_code, version: item.version })), cooking.flatMap(item => item.demands));
    const weeklyBudget = draft.planningMode === "weekly" ? createPlanningBudget(inventory,existing.filter(item => !shoppingWindow || String(item.planned_date)>=shoppingWindow.startDate),shoppingWindow) : null;
    const ingredientBudget = weeklyBudget ? [...draft.meals].sort((a,b) => a.date.localeCompare(b.date) || ["breakfast","lunch","dinner","snack"].indexOf(a.mealType)-["breakfast","lunch","dinner","snack"].indexOf(b.mealType)).flatMap(meal => weeklyBudget.consume(cooking.filter(item => item.targetMealId === meal.id).flatMap(item => item.demands),meal.date,meal.id)) : singleBudget;
    const sessions = draft.planningMode === "weekly" ? draft.meals.map(meal => ({ targetMealId: meal.id,
      time: planTime(cooking.filter(item => item.targetMealId === meal.id), candidates, devices, draft.time.sessionBudgetMinutes ?? draft.time.budgetMinutes, meal.preparedServings > 0, draft.unresolved.some(item => item.targetMealId === meal.id)) })) : [];
    let time: CookingPlanDraft["time"] = planTime(cooking, candidates, devices, draft.time.budgetMinutes, draft.meals.some(meal => meal.preparedServings > 0), draft.unresolved.length > 0);
    if (sessions.length) {
      const { schedule: _schedule, ...totals } = time;
      const elapsed = sessions.every(session => !session.time.incomplete) ? sessions.reduce((sum, session) => sum + session.time.schedule.elapsedMinutes!, 0) : time.knownSequentialMinutes;
      time = { ...totals, incomplete: sessions.some(session => session.time.incomplete), exceedsBudget: elapsed > draft.time.budgetMinutes,
        sessions: sessions.map(session => ({ targetMealId: session.targetMealId, schedule: session.time.schedule })) };
    }
    return [{ cooking, ingredientBudget, time, sessionExceeds: sessions.some(session => session.time.exceedsBudget), weeklyBudget, score: candidate.score,
      exceedsBudget: time.exceedsBudget,
      shortageCount: ingredientBudget.filter(item => !item.fully_covered).length }];
  }).sort((a, b) => Number(a.exceedsBudget || a.sessionExceeds) - Number(b.exceedsBudget || b.sessionExceeds) || a.shortageCount - b.shortageCount || b.score - a.score);
  const chosen = choices[0];
  if (!chosen) throw new RecommendationsError(409, "没有符合当前条件且用量明确的替代菜，原方案保持不变", "COOKING_PLAN_NO_REPLACEMENT");
  const conflicts: string[] = [...(chosen.weeklyBudget?.checks ?? [])];
  if (chosen.weeklyBudget?.unknownCommitment) conflicts.push("已有安排用量未核实，新增餐次的库存覆盖仅为暂算");
  for (const item of chosen.ingredientBudget) {
    if (item.quantity_status === "unknown") conflicts.push(`${item.food_name} 的库存数量或单位换算未知`);
    else if (!item.fully_covered) conflicts.push(`${item.food_name} 的整套需求超过已知库存`);
  }
  if (chosen.sessionExceeds) conflicts.push(`替换后的单次制作超过 ${draft.time.sessionBudgetMinutes} 分钟上限`);
  if (chosen.exceedsBudget) conflicts.push(`整套${chosen.time.incomplete ? "已知顺序" : "排程"}耗时 ${chosen.time.schedule?.elapsedMinutes ?? chosen.time.knownSequentialMinutes} 分钟，超过 ${draft.time.budgetMinutes} 分钟上限`);
  if (chosen.time.incomplete) conflicts.push("替换后的完整制作时间或设备容量仍需核实");
  return { draft: cookingPlanDraftSchema.parse({ ...draft, ...(shoppingWindow ? { shoppingWindow } : {}), cooking: chosen.cooking, ingredientBudget: chosen.ingredientBudget,
    time: { ...chosen.time, sessionBudgetMinutes: draft.time.sessionBudgetMinutes },
    weeklyShopping: chosen.weeklyBudget ? [...chosen.weeklyBudget.aggregate.values()] : draft.weeklyShopping,
    checksPending: [...new Set([...draft.checksPending,...conflicts])].slice(0,50),
    status: "requires_validation" }), shopping: chosen.weeklyBudget ? [...chosen.weeklyBudget.aggregate.values()] : undefined, conflicts: [...new Set(conflicts)] };
}
