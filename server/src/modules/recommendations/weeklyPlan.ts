import { cookingPlanDraftSchema, type PreparedMeal, type WeeklyPlanPreview, type WeeklyPlanRequest, type KitchenPreferences } from "@dietdigidose/contracts";
import { buildCookingDraft } from "./plan.js";
import { allocatePreparedMeals } from "./requirements.js";
import { recipeDemands } from "./quantities.js";
import { unexpiredInventory } from "./inventoryAvailability.js";
import { buildFefoConsumptionPreviewFromCandidates } from "../../services/inventoryQuantity.js";
import { ingredient, parseJson } from "../mealPlans/formatters.js";
import type { Row } from "./types.js";

type Candidate = Parameters<typeof buildCookingDraft>[1][number];
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const mealAliases: Record<string,string> = { 早餐: "breakfast", 午餐: "lunch", 晚餐: "dinner", 加餐: "snack" };
const canonicalUnit = (unit: string) => ({ unit: unit === "kg" ? "g" : unit === "l" ? "ml" : unit, factor: unit === "kg" || unit === "l" ? 1000 : 1 });

/** Read-only allocation: existing commitments reserve resources before filling gaps. */
export function buildWeeklyPlan(input: WeeklyPlanRequest, preferences: KitchenPreferences, candidates: Candidate[], inventory: Row[], prepared: PreparedMeal[], existing: Row[], shopping: Row[], reservedPrepared: Array<{ preparedMealId: string; servings: number }> = []): WeeklyPlanPreview {
  const days = Array.from({ length: 7 },(_,index) => { const date = new Date(`${input.startDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate()+index); return date.toISOString().slice(0,10); });
  const mealTypes = input.mealTypes ?? (preferences.usual_meals?.length ? preferences.usual_meals : ["breakfast","lunch","dinner"]);
  const servings = input.servings ?? preferences.servings ?? 1;
  const timeBudget = preferences.meal_time_minutes ?? 30;
  const stock = inventory.map(item => ({ ...item }));
  const batches = prepared.map(meal => ({ ...meal }));
  for (const reservation of reservedPrepared) { const batch = batches.find(meal => meal.id === reservation.preparedMealId); if (batch) batch.remaining_servings = round(Math.max(0,batch.remaining_servings-reservation.servings)); }
  const checks = new Set<string>();
  const aggregate = new Map<string,WeeklyPlanPreview["shopping"][number]>();
  const budgets: ReturnType<typeof buildFefoConsumptionPreviewFromCandidates> = [];
  const consume = (demands: NonNullable<ReturnType<typeof recipeDemands>>, date: string, mealId: string) => {
    const available = unexpiredInventory(stock,date).map(item => ({ id: Number(item.id), food_name: String(item.food_name),quantity_value: item.quantity_value as number | null,quantity_unit: item.quantity_unit as string | null,expiration_date: String(item.expiration_date ?? ""),version: Number(item.version),batch_code: item.batch_code as string | null,quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined }));
    const preview = buildFefoConsumptionPreviewFromCandidates(available,demands);
    for (const [index,part] of preview.entries()) {
      const requested = demands[index].amount_value;
      const normalized = canonicalUnit(part.unit);
      const key = `${part.food_name.trim().toLocaleLowerCase()}:${normalized.unit}`;
      const entry = aggregate.get(key) ?? { foodName: part.food_name,unit: normalized.unit,uncertain: false,required: 0,covered: 0,missing: 0,sources: [] };
      entry.uncertain ||= part.quantity_status === "unknown";
      entry.required = round(entry.required + requested * normalized.factor);
      entry.covered = round(entry.covered + part.covered_value * normalized.factor);
      entry.missing = round(entry.missing + part.missing_value * normalized.factor);
      entry.sources.push({ mealId,required: round(requested*normalized.factor),missing: round(part.missing_value*normalized.factor) });
      aggregate.set(key,entry);
      if (part.quantity_status === "unknown") checks.add(`${part.food_name} 的数量或规格无法换算，请核对采购缺口`);
      for (const deduction of part.deductions) {
        const item = stock.find(value => Number(value.id) === deduction.item_id);
        if (item) item.quantity_value = round(Math.max(0,Number(item.quantity_value)-Number(deduction.amount_value)));
      }
    }
    return preview;
  };
  // An existing item's captured ingredients are its committed quantities. Missing
  // quantities cannot be guessed from a recipe or silently reused by another meal.
  let unknownCommitment = false;
  for (const item of existing) {
    if (item.prepared_only || ["completed","skipped"].includes(String(item.status))) continue;
    const ingredients = parseJson<unknown[]>(item.ingredients_json,[]).map(ingredient).filter((value): value is NonNullable<ReturnType<typeof ingredient>> => Boolean(value));
    const demands = recipeDemands(ingredients,1,1);
    if (!demands) { unknownCommitment = true; checks.add(`已有安排「${item.title}」缺少明确原料用量，需先核对，未重复分配库存`); continue; }
    consume(demands,String(item.planned_date),String(item.id));
  }
  const slots: WeeklyPlanPreview["slots"] = [];
  const parts: ReturnType<typeof buildCookingDraft>[] = [];
  for (const date of days) for (const mealType of mealTypes) {
    const id = `week:${date}:${mealType}`;
    const preserved = existing.filter(item => String(item.planned_date) === date && (mealAliases[String(item.meal_type)] ?? item.meal_type) === mealType && item.status !== "skipped");
    if (preserved.length) {
      slots.push({ id,date,mealType,servings,titles: preserved.map(item => String(item.title)),preservedItemIds: preserved.map(item => String(item.id)),state: "preserved",reasons: ["保留已有安排"] });
      continue;
    }
    const eligiblePrepared = batches.filter(meal => meal.produced_at.slice(0,10) <= date && (!meal.planned_date || meal.planned_date === date));
    const requirements = allocatePreparedMeals({ meals: [{ id,date,mealType,servings }],excludedPreparedMealIds: [] },eligiblePrepared);
    const target = requirements.meals[0];
    const part = buildCookingDraft(requirements,unknownCommitment ? [] : candidates,unexpiredInventory(stock,date),timeBudget);
    if (part.time.exceedsBudget) {
      part.cooking = [];
      part.unresolved = [{ targetMealId: id,reason: "没有在单次制作时间内完成的明确方案，请调整餐次或时间" }];
      part.ingredientBudget = [];
      part.time.knownSequentialMinutes = 0; part.time.exceedsBudget = false;
    }
    for (const allocation of target.allocations) {
      const batch = batches.find(meal => meal.id === allocation.preparedMealId)!;
      batch.remaining_servings = round(batch.remaining_servings-allocation.servings);
      checks.add(`「${batch.food_name}」的存放期限和复热条件尚未核实，食用前需确认`);
    }
    if (part.cooking.length) {
      part.ingredientBudget = consume(part.cooking.flatMap(item => item.demands),date,id);
      budgets.push(...part.ingredientBudget);
    }
    parts.push(part);
    slots.push({ id,date,mealType,servings,titles: [...target.allocations.map(item => item.foodName),...part.cooking.map(item => item.title)],preservedItemIds: [],state: part.unresolved.length ? "unresolved" : "proposed",reasons: part.unresolved.map(item => item.reason) });
  }
  if (inventory.some(item => !item.expiration_date)) checks.add("部分库存缺少可用期限，未来餐次使用前需核对");
  if (preferences.carry_meals) checks.add("携带餐的冷藏与复热适用性需要逐餐核对");
  const draft = parts.length ? cookingPlanDraftSchema.parse({
    planningMode: "weekly",status: "requires_validation",meals: parts.flatMap(part => part.meals),totalCookServings: round(parts.reduce((sum,part) => sum+part.totalCookServings,0)),
    cooking: parts.flatMap(part => part.cooking),unresolved: parts.flatMap(part => part.unresolved),ingredientBudget: budgets,
    time: { sessionBudgetMinutes: timeBudget,budgetMinutes: timeBudget*parts.length,knownSequentialMinutes: parts.reduce((sum,part) => sum+part.time.knownSequentialMinutes,0),exceedsBudget: false,isEstimate: true,incomplete: true,missing: ["每餐分别制作，不能把一周累计时间当作一次制作时间", "收尾时间与设备容量待核对"] },
    checksPending: [...checks].slice(0,50),excludedPreparedMealIds: batches.filter(meal => meal.is_reserved).map(meal => meal.id),effectivePreferences: preferences,
  }) : null;
  return { startDate: days[0],endDate: days[6],status: "requires_validation",slots,shopping: [...aggregate.values()],plannedPurchases: shopping.filter(item => !item.checked).map(item => ({ id: String(item.id),name: String(item.name),amount: String(item.amount) })),checksPending: [...checks],draft };
}
