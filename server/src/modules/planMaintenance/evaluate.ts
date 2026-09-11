import { maintenanceScope } from "./scope.js";
import { recalculateMaintenanceQuantities } from "./recalculate.js";
import type { MaintenanceJob, MaintenanceQueueRepository } from "./queue.js";

/** The dependency graph and calculation must use the same captured facts. */
export async function evaluateMaintenanceJob(repository: MaintenanceQueueRepository, job: MaintenanceJob, fromDate: string) {
  const snapshot = await repository.inputs(job);
  if (!snapshot) return null;
  const scope = maintenanceScope({ userId: job.userId,fromDate,events: snapshot.data.maintenance_events,
    inventory: snapshot.data.inventory_items,prepared: snapshot.data.prepared_meals,
    plans: snapshot.data.meal_plans,items: snapshot.data.meal_plan_items });
  return { snapshot,scope,result: recalculateMaintenanceQuantities(snapshot,scope,fromDate) };
}
