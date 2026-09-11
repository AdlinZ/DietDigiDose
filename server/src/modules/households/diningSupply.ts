import { householdDiningPlanSchema } from "@dietdigidose/contracts";
import { recipeDemands } from "../recommendations/quantities.js";
import { checkDiningRecipe } from "./recipeConstraints.js";
import type { Row } from "./types.js";

type Demand = { food_name: string; amount_value: number; unit: string };
const scale = (unit: string) => unit === 'kg' || unit === 'l' ? 1000 : 1;
const family = (unit: string) => unit === 'kg' ? 'g' : unit === 'l' ? 'ml' : unit;
const nameKey = (name: string) => name.trim().toLocaleLowerCase().replace(/\s+/g,'');
const round = (value: number) => Math.round(value*1_000_000)/1_000_000;
function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
function measured(value: number,unit: string) {
  const amount = Math.round(value*scale(unit)*1_000_000);
  return Number.isSafeInteger(amount) && amount>0 ? amount : null;
}
export function diningSupply(input: { plans: Row[]; inventory: Row[]; targetId: string; totalServings: number; recipeFingerprint: string; today: string }) {
  const checks = new Set<string>();
  const target = input.plans.find(row => String(row.id)===input.targetId);
  const targetRecipe = target ? { id: target.recipe_id,title: target.recipe_title,description: target.recipe_description,ingredients_json: target.recipe_ingredients,serving_size: target.recipe_yield } : null;
  const targetCheck = targetRecipe ? checkDiningRecipe(targetRecipe,[],input.totalServings) : null;
  if (!targetCheck || targetCheck.fingerprint!==input.recipeFingerprint || targetCheck.materials.status!=='known')
    return { status: 'needs_review' as const,otherMealCount: 0,demands: [],checks: ['来源餐次或菜谱已变化，请刷新后核对'] };
  const stocks = input.inventory.filter(row => row.is_available).map(row => {
    const parsed = recipeDemands([{ name: String(row.food_name),amount: String(row.quantity).trim() }],1,1)?.[0];
    const value = parsed ? measured(parsed.amount_value,parsed.unit) : null;
    const expires = String(row.expiration_date ?? '');
    return { id: Number(row.id),name: nameKey(String(row.food_name)),unit: parsed ? family(parsed.unit) : null,remaining: value,expires };
  }).sort((a,b) => a.expires.localeCompare(b.expires) || a.id-b.id);
  const plans = [...input.plans].sort((a,b) => Number(Boolean(b.protected))-Number(Boolean(a.protected)) || String(a.planned_date).localeCompare(String(b.planned_date)) || String(a.id).localeCompare(String(b.id)));
  const requests = new Map<string,Demand[]>();
  for (const plan of plans) {
    if (!validDate(String(plan.planned_date))) checks.add('存在日期不完整的共餐安排，库存分配需核对');
    let servings = input.totalServings;
    if (String(plan.id)!==input.targetId) {
      try {
        const dining = householdDiningPlanSchema.parse(typeof plan.dining_json==='string' ? JSON.parse(plan.dining_json) : plan.dining_json);
        servings = dining.participants.reduce((sum,person) => sum+Math.round(person.servings*1_000_000),0)/1_000_000;
      } catch { checks.add('另有共餐安排的参与份量不完整，库存分配需核对'); continue; }
    }
    const checked = checkDiningRecipe({ id: plan.recipe_id,title: plan.recipe_title,description: plan.recipe_description,ingredients_json: plan.recipe_ingredients,serving_size: plan.recipe_yield },[],servings);
    if (checked.materials.status!=='known') { checks.add('另有共餐安排的原料用量不完整，不能确定可分配库存'); continue; }
    if (checked.materials.demands.some(demand => measured(demand.amount_value,demand.unit)===null)) checks.add("原料数量超出可可靠换算范围");
    requests.set(String(plan.id),checked.materials.demands);
  }
  if (checks.size) return { status: 'needs_review' as const,otherMealCount: Math.max(0,plans.length-1),demands: targetCheck.materials.demands.map(demand => ({ ...demand,covered: null,missing: null })),checks: [...checks] };
  const result: Array<Demand & { covered: number | null; missing: number | null }> = [];
  for (const plan of plans) {
    const date = String(plan.planned_date)>input.today ? String(plan.planned_date) : input.today;
    for (const demand of requests.get(String(plan.id)) ?? []) {
      let remaining = measured(demand.amount_value,demand.unit);
      if (remaining===null) { checks.add('原料数量超出可可靠换算范围'); continue; }
      for (const stock of stocks) {
        if (stock.name!==nameKey(demand.food_name)) continue;
        if (!validDate(stock.expires)) { checks.add('部分同名库存缺少保质日期，尚未计入覆盖量'); continue; }
        if (stock.expires<date) continue;
        if (stock.remaining===null || stock.unit!==family(demand.unit)) { checks.add('部分同名库存数量或单位无法换算，尚未计入覆盖量'); continue; }
        const used = Math.min(remaining,stock.remaining);
        remaining-=used; stock.remaining-=used;
        if (!remaining) break;
      }
      if (String(plan.id)===input.targetId) {
        const missing = round(remaining/(scale(demand.unit)*1_000_000));
        result.push({ ...demand,covered: round(demand.amount_value-missing),missing });
      }
    }
  }
  return { status: checks.size ? 'needs_review' as const : 'known' as const,otherMealCount: Math.max(0,plans.length-1),demands: checks.size ? result.map(demand => ({ ...demand,missing: null })) : result,checks: [...checks] };
}
