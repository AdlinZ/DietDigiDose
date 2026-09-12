import type { NotificationsRepository } from "../notifications/repository.js";
import type { RecommendationsService } from "../recommendations/service.js";
import type { WorkerTaskContext } from "../worker/types.js";
import { interventionDinnerState } from "./snapshot.js";
import { interventionOpportunities } from "./opportunities.js";
import { formatInterventionPreferences } from "./preferences.js";

export async function scanInterventions(repository: NotificationsRepository,recommendations: Pick<RecommendationsService,"interventionSnapshot">,context: WorkerTaskContext) {
  const result = { scanned: 0,candidates: 0,failed: 0 };
  let afterId = 0;
  while (process.env.PROACTIVE_INTERVENTIONS_ENABLED === "1") {
    await context.assertActive();context.signal.throwIfAborted();
    const users = await repository.interventionScanUsers(afterId,25);
    if (!users.length) break;
    for (const userId of users) {
      await context.assertActive();context.signal.throwIfAborted();
      if (process.env.PROACTIVE_INTERVENTIONS_ENABLED !== "1") return result;
      afterId = userId;
      try {
        const row = await repository.interventionPreferences(userId);
        const { version: _version,...preferences } = formatInterventionPreferences(row);
        if (!preferences.enabled) continue;
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
    }
  }
  return result;
}
