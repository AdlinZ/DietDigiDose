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

export function buildCookingDraft(requirements: ReturnType<typeof allocatePreparedMeals>, candidates: Candidate[], inventory: Row[], timeBudget: number) {
  const stock = unexpiredInventory(inventory, currentDateKey()).map(item => ({ id: item.id, food_name: item.food_name, quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined, quantity_value: item.quantity_value,
    quantity_unit: item.quantity_unit, expiration_date: item.expiration_date, batch_code: item.batch_code, version: item.version }));
  const planned: Array<{ targetMealId: string; recipeId: number; title: string; servings: number; recipeYield: number; demands: Demand[] }> = [];
  const unresolved: Array<{ targetMealId: string; reason: string }> = [];
  let budget: Demand[] = [];
  let knownTime = 0;
  let timeUnknown = false;
  for (const target of requirements.meals) {
    if (target.cookServings <= 0) continue;
    const choices = candidates.flatMap(candidate => {
      const needed = demands(candidate, target.cookServings);
      if (!needed) return [];
      const preview = buildFefoConsumptionPreviewFromCandidates(stock, [...budget, ...needed]);
      // Compare unmet demand items, never add incompatible mass/count quantities.
      const unresolvedCount = preview.filter(item => !item.fully_covered).length;
      const unknownCount = preview.filter(item => item.quantity_status === "unknown").length;
      const addedTime = (candidate.recipe.cook_time + (candidate.recipe.prep_time ?? 0)) * Math.ceil(target.cookServings / candidate.recipe.serving_size!);
      return [{ candidate, needed, unresolvedCount, unknownCount, exceedsTime: knownTime + addedTime > timeBudget }];
    }).sort((a, b) => Number(a.exceedsTime) - Number(b.exceedsTime) || a.unresolvedCount - b.unresolvedCount || a.unknownCount - b.unknownCount || b.candidate.score - a.candidate.score);
    const chosen = choices[0];
    if (!chosen) { unresolved.push({ targetMealId: target.id, reason: "没有通过候选约束且有明确份数与原料用量的菜谱" }); continue; }
    const recipe = chosen.candidate.recipe;
    budget = [...budget, ...chosen.needed];
    planned.push({ targetMealId: target.id, recipeId: chosen.candidate.recipeId, title: recipe.title,
      servings: target.cookServings, recipeYield: recipe.serving_size!, demands: chosen.needed });
    const batches = Math.ceil(target.cookServings / recipe.serving_size!);
    knownTime += (recipe.cook_time + (recipe.prep_time ?? 0)) * batches;
    if (!recipe.cook_time || recipe.prep_time == null) timeUnknown = true;
  }
  const ingredientBudget = buildFefoConsumptionPreviewFromCandidates(stock, budget);
  return { ...requirements, cooking: planned, unresolved, ingredientBudget,
    time: { budgetMinutes: timeBudget, knownSequentialMinutes: knownTime, exceedsBudget: knownTime > timeBudget,
      isEstimate: true, incomplete: true, missing: ["cleanup", "equipment_capacity", ...(timeUnknown ? ["preparation_or_cooking"] : [])] },
    status: "requires_validation" as const,
    checksPending: [...requirements.checksPending, "storage_and_carry_suitability", "substitution_validation", "execution_stock_refresh"] };
}

/** Reprice the entire draft while changing exactly one cooking entry. */
export function replaceCookingDraft(draft: CookingPlanDraft, targetMealId: string, recipeId: number | undefined, candidates: Candidate[], inventory: Row[]) {
  const targets = draft.cooking.filter(item => item.targetMealId === targetMealId);
  if (targets.length !== 1) throw new RecommendationsError(409, "请先指定唯一需要替换的新做菜", "COOKING_PLAN_TARGET_AMBIGUOUS");
  const target = targets[0];
  const choices = candidates.filter(candidate => candidate.recipeId !== target.recipeId && (recipeId === undefined || candidate.recipeId === recipeId)).flatMap(candidate => {
    const needed = demands(candidate, target.servings);
    if (!needed) return [];
    const replacement = { targetMealId, recipeId: candidate.recipeId, title: candidate.recipe.title,
      servings: target.servings, recipeYield: candidate.recipe.serving_size!, demands: needed };
    const cooking = draft.cooking.map(item => item.targetMealId === targetMealId ? replacement : item);
    const ingredientBudget = buildFefoConsumptionPreviewFromCandidates(unexpiredInventory(inventory, currentDateKey()).map(item => ({ id: item.id, food_name: item.food_name,
      quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined, quantity_value: item.quantity_value, quantity_unit: item.quantity_unit, expiration_date: item.expiration_date,
      batch_code: item.batch_code, version: item.version })), cooking.flatMap(item => item.demands));
    const missingTime: string[] = [];
    let knownTime = 0;
    let sessionExceeds = false;
    for (const item of cooking) {
      const current = candidates.find(entry => entry.recipeId === item.recipeId);
      if (!current) { missingTime.push(item.title); continue; }
      const recipe = current.recipe;
      const sessionTime = (recipe.cook_time + (recipe.prep_time ?? 0)) * Math.ceil(item.servings / item.recipeYield);
      knownTime += sessionTime;
      if (draft.planningMode === "weekly" && sessionTime > (draft.time.sessionBudgetMinutes ?? draft.time.budgetMinutes)) sessionExceeds = true;
      if (!recipe.cook_time || recipe.prep_time == null) missingTime.push(item.title);
    }
    return [{ cooking, ingredientBudget, knownTime, missingTime, sessionExceeds, score: candidate.score,
      exceedsBudget: knownTime > draft.time.budgetMinutes,
      shortageCount: ingredientBudget.filter(item => !item.fully_covered).length }];
  }).sort((a, b) => Number(a.exceedsBudget || a.sessionExceeds) - Number(b.exceedsBudget || b.sessionExceeds) || a.shortageCount - b.shortageCount || b.score - a.score);
  const chosen = choices[0];
  if (!chosen) throw new RecommendationsError(409, "没有符合当前条件且用量明确的替代菜，原方案保持不变", "COOKING_PLAN_NO_REPLACEMENT");
  const conflicts: string[] = [];
  for (const item of chosen.ingredientBudget) {
    if (item.quantity_status === "unknown") conflicts.push(`${item.food_name} 的库存数量或单位换算未知`);
    else if (!item.fully_covered) conflicts.push(`${item.food_name} 的整套需求超过已知库存`);
  }
  if (chosen.sessionExceeds) conflicts.push(`替换后的单次制作超过 ${draft.time.sessionBudgetMinutes} 分钟上限`);
  if (chosen.exceedsBudget) conflicts.push(`整套已知顺序耗时 ${chosen.knownTime} 分钟，超过 ${draft.time.budgetMinutes} 分钟上限`);
  if (chosen.missingTime.length) conflicts.push(`无法核实这些保留菜谱的完整时间或当前可用条件：${chosen.missingTime.join("、")}`);
  return { draft: cookingPlanDraftSchema.parse({ ...draft, cooking: chosen.cooking, ingredientBudget: chosen.ingredientBudget,
    time: { ...draft.time, knownSequentialMinutes: chosen.knownTime, exceedsBudget: chosen.exceedsBudget,
      incomplete: true, isEstimate: true, missing: [...new Set([...draft.time.missing, ...chosen.missingTime.map(title => `recipe:${title}`)])] },
    status: "requires_validation" }), conflicts: [...new Set(conflicts)] };
}
