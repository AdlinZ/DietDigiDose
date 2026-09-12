import type { NotificationsRepository } from "../notifications/repository.js";
import type { RecommendationsService } from "../recommendations/service.js";
import type { WorkerTaskContext } from "../worker/types.js";
import { interventionDinnerState } from "./snapshot.js";
import { interventionOpportunities } from "./opportunities.js";
import { formatInterventionPreferences } from "./preferences.js";

export async function scanInterventions(repository: NotificationsRepository,recommendations: Pick<RecommendationsService,"interventionSnapshot">,context: WorkerTaskContext) {
  const result = { scanned: 0,candidates: 0,failed: 0 };
  if (process.env.PROACTIVE_INTERVENTIONS_ENABLED !== "1") return result;
  await context.assertActive();context.signal.throwIfAborted();
  let afterId = await repository.interventionScanCursor();
  const checkpoint = async (next: number) => {
    await context.assertActive();context.signal.throwIfAborted();
    if (!await repository.advanceInterventionScan(afterId,next,context.leaseOwnerId)) throw new Error("Intervention scan checkpoint lease or cursor changed");
    afterId = next;
  };
  const users = await repository.interventionScanUsers(afterId,25);
  if (!users.length) { await checkpoint(0);return result; }
  for (const userId of users) {
    await context.assertActive();context.signal.throwIfAborted();
    if (process.env.PROACTIVE_INTERVENTIONS_ENABLED !== "1") return result;
    try {
      const row = await repository.interventionPreferences(userId);
      const { version: _version,...preferences } = formatInterventionPreferences(row);
      if (!preferences.enabled) { await checkpoint(userId);continue; }
      const observedAt = Date.now();
      const [snapshot,queue] = await Promise.all([recommendations.interventionSnapshot(userId,observedAt,preferences.time_zone),repository.interventionQueue(userId)]);
      const state = interventionDinnerState(snapshot.dates,preferences.time_zone,snapshot.items,snapshot.plans,queue,typeof row?.not_cooking_date === "string" ? row.not_cooking_date : null);
      const candidates = interventionOpportunities({ userId,now: Date.now(),dataObservedAt: observedAt,preferences,
        inventory: snapshot.inventory,recommendations: snapshot.recommendations,...state });
      for (const candidate of candidates) {
        await context.assertActive();context.signal.throwIfAborted();
        const day = state.dinnerDays.find(item => item.localDate===candidate.localDate);
        await repository.reserveIntervention({ candidate,now: Date.now(),featureEnabled: process.env.PROACTIVE_INTERVENTIONS_ENABLED === "1",
          // Explicit intervention consent authorizes pushes only when an active Expo device exists (checked atomically in reserve).
          pushAuthorized: preferences.enabled,dinnerAlreadyPlanned: day?.alreadyPlanned ?? true,cookingInProgress: state.cookingInProgress,notCookingToday: day?.notCooking ?? true });
        result.candidates += 1;
      }
      result.scanned += 1;
    } catch {
      await context.assertActive();context.signal.throwIfAborted();
      result.failed += 1;
    }
    await checkpoint(userId);
  }
  if (users.length<25) await checkpoint(0);
  return result;
}
