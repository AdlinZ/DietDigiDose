import type { WeeklyPlanPreview } from "@dietdigidose/contracts";
import { recipeDemands } from "./quantities.js";
import { unexpiredInventory } from "./inventoryAvailability.js";
import { buildFefoConsumptionPreviewFromCandidates } from "../../services/inventoryQuantity.js";
import { ingredient, parseJson } from "../mealPlans/formatters.js";
import type { Row } from "./types.js";
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const canonicalUnit = (unit: string) => ({ unit: unit === "kg" ? "g" : unit === "l" ? "ml" : unit, factor: unit === "kg" || unit === "l" ? 1000 : 1 });

/** A disposable stock ledger: prior commitments are reserved before new meals. */
export function createPlanningBudget(inventory: Row[], existing: Row[] = []) {
  const stock = inventory.map(item => ({ ...item }));
  let unknownCommitment = false;
  const checks = new Set<string>();
  const aggregate = new Map<string,WeeklyPlanPreview["shopping"][number]>();
  const consume = (demands: NonNullable<ReturnType<typeof recipeDemands>>, date: string, mealId: string) => {
    const available = unexpiredInventory(unknownCommitment ? [] : stock,date).map(item => ({ id: Number(item.id), food_name: String(item.food_name),quantity_value: item.quantity_value as number | null,quantity_unit: item.quantity_unit as string | null,expiration_date: String(item.expiration_date ?? ""),version: Number(item.version),batch_code: item.batch_code as string | null,quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined }));
    const preview = buildFefoConsumptionPreviewFromCandidates(available,demands);
    for (const [index,part] of preview.entries()) {
      if (unknownCommitment) part.quantity_status = "unknown";
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
  for (const item of existing) {
    if (item.prepared_only || ["completed","skipped"].includes(String(item.status))) continue;
    const ingredients = parseJson<unknown[]>(item.ingredients_json,[]).map(ingredient).filter((value): value is NonNullable<ReturnType<typeof ingredient>> => Boolean(value));
    const demands = recipeDemands(ingredients,1,1);
    if (!demands) { unknownCommitment = true; checks.add(`已有安排「${item.title}」缺少明确原料用量，需先核对，未重复分配库存`); continue; }
    consume(demands,String(item.planned_date),String(item.id));
  }
  return { stock,checks,aggregate,consume,unknownCommitment };
}
