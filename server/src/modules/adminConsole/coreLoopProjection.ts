import type { CoreLoopFact } from "./coreLoopMetric.js";
import type { Row } from "./types.js";
export type CoreLoopDataset = { productions: Row[]; intakes: Row[]; logs: Row[]; legacy: Row[]; shared: Row[]; settings: Row };
export function object(value: unknown): Row {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function array(value: unknown): Row[] { return Array.isArray(value) ? value.filter(item => item && typeof item === "object") : []; }
export function utc(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return "";
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value) ? value.replace(" ","T") + "Z" : value;
}
const actor = (value: unknown) => `user:${Number(value)}`;
function actorClass(value: unknown): CoreLoopFact["actorClass"] { return ["real","test","automation","demo"].includes(String(value)) ? value as CoreLoopFact["actorClass"] : "unknown"; }
const amount = (value: unknown) => value == null ? null : Number(value);
export function projectCoreLoops(data: CoreLoopDataset): CoreLoopFact[] {
  const facts: CoreLoopFact[] = data.productions.map(row => {
    const result = object(row.result_json), selection = object(result.selection_evidence), inventory = object(selection.inventory);
    const allocations = array(inventory.allocations), changes = array(result.inventory_consumption_changes);
    const logs = data.logs.filter(log => Number(log.user_id) === Number(row.user_id));
    const intakes = data.intakes.filter(item => item.prepared_meal_id === row.id);
    return {
      productionId: String(row.id), actorKey: actor(row.user_id), producerKey: actor(row.user_id), actorClass: actorClass(row.kind),
      environment: typeof result.metric_environment === "string" ? result.metric_environment : "unknown", scope: "personal" as const,
      producedAt: utc(row.produced_at), recipeId: row.recipe_id == null ? null : Number(row.recipe_id),
      selection: selection.version === 1 ? { requestId: String(selection.requestId || ""), recipeId: Number(selection.recipeId),
        selectedAt: utc(selection.selectedAt ?? row.selection_created_at), matchedItemIds: inventory.version === 1 ? allocations.map(item => Number(item.itemId)) : null } : null,
      stock: logs.filter(log => log.action === "created").map(log => ({ itemId: Number(log.inventory_item_id), confirmedAt: utc(log.created_at),
        confirmed: log.acceptance === "manual" || (log.source === "manual" && log.acceptance == null), scope: "personal" as const, ownerKey: actor(log.user_id) })),
      deductions: changes.map((change,index) => {
        const log = logs.find(log => log.idempotency_key === `cooking:${row.idempotency_key}:${change.item_id}:${index}` && Number(log.inventory_item_id) === Number(change.item_id)
          && log.source === "cooking" && ["consume_all","consume_partial"].includes(String(log.action)));
        return { itemId: Number(change.item_id), before: amount(change.quantity_before), after: amount(change.quantity_after), amount: amount(change.consumed_value),
          verified: Boolean(log && amount(log.quantity_before) === amount(change.quantity_before) && amount(log.quantity_after) === amount(change.quantity_after)
            && amount(log.delta_value) !== null && Math.abs(-Number(log.delta_value) - Number(change.consumed_value)) < 0.000001) };
      }),
      intake: intakes.map(item => ({ recordId: String(item.diet_record_id || ""), actorKey: actor(item.user_id), servings: Number(item.servings),
        committedAt: utc(item.created_at), survivesCorrection: Boolean(item.record_exists) && !item.corrected })),
    };
  });
  // Legacy successful completions have intake evidence but no verified selection chain.
  for (const row of data.legacy) facts.push({ productionId: `legacy:${row.id}`, actorKey: actor(row.user_id), producerKey: actor(row.user_id),
    actorClass: actorClass(row.kind), environment: typeof row.metric_environment === "string" ? row.metric_environment : "unknown", scope: "personal",
    producedAt: utc(row.created_at), recipeId: row.recipe_id == null ? null : Number(row.recipe_id), selection: null, stock: [], deductions: [],
    intake: [{ recordId: String(row.diet_record_id), actorKey: actor(row.user_id), servings: 1, committedAt: utc(row.created_at), survivesCorrection: Boolean(row.record_exists) }] });
  for (const row of data.shared) facts.push({ productionId: `household:${row.id}`, actorKey: actor(row.created_by_user_id), producerKey: actor(row.created_by_user_id),
    actorClass: actorClass(row.kind), environment: "unknown", scope: "household", producedAt: utc(row.produced_at), recipeId: null,
    selection: null, stock: [], deductions: [], intake: [{ recordId: String(row.diet_record_id), actorKey: actor(row.created_by_user_id),
      servings: Number(row.servings), committedAt: utc(row.intake_at), survivesCorrection: true }] });
  return facts;
}

export function coreLoopInventoryIds(productions: Row[]): number[] {
  return [...new Set(productions.flatMap(row => {
    const result = object(row.result_json), selection = object(result.selection_evidence);
    return [...array(object(selection.inventory).allocations).map(item => Number(item.itemId)), ...array(result.inventory_consumption_changes).map(item => Number(item.item_id))];
  }).filter(id => Number.isSafeInteger(id) && id > 0))];
}
