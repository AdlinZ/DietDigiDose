import { selectMaintenanceReplacements } from "./replacements.js";
import { snapshotKitchenware } from "./snapshotKitchenware.js";
import { maintenanceScope } from "./scope.js";
import { recalculateMaintenanceQuantities } from "./recalculate.js";
import type { MaintenanceJob, MaintenanceQueueRepository } from "./queue.js";

/** The dependency graph and calculation must use the same captured facts. */
export async function evaluateMaintenanceJob(repository: MaintenanceQueueRepository, job: MaintenanceJob, fromDate: string) {
  const snapshot = await repository.inputs(job,await repository.candidateRecipeIds());
  if (!snapshot) return null;
  const scope = maintenanceScope({ userId: job.userId,fromDate,events: snapshot.data.maintenance_events,
    inventory: snapshot.data.inventory_items,prepared: snapshot.data.prepared_meals,
    plans: snapshot.data.meal_plans,items: snapshot.data.meal_plan_items });
  const kitchenware = snapshotKitchenware(snapshot);
  const compatibility = new Map(await Promise.all(snapshot.recipeIds.map(async id => [id,await kitchenware.evaluateRequirements(job.userId,id)] as const)));
  return { snapshot,scope,compatibility,replacements: selectMaintenanceReplacements(snapshot,scope,compatibility,fromDate),result: recalculateMaintenanceQuantities(snapshot,scope,fromDate) };
}
