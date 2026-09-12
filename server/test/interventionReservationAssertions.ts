import assert from "node:assert/strict";
import { defaultInterventionPreferences } from "@dietdigidose/contracts";
import type { NotificationsRepository } from "../src/modules/notifications/repository.js";
import type { InterventionReservation } from "../src/modules/interventions/reservation.js";

export async function verifyInterventionReservation(repository: NotificationsRepository,userId: number) {
  await repository.saveDevice(userId,`ExpoPushToken[reservation-${userId}]`,"android");
  const prefs = { ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,daily_push_limit: 1,version: 0 };
  assert(await repository.saveInterventionPreferences(userId,prefs));
  const now = Date.parse('2026-09-12T09:00:00Z');
  const input: InterventionReservation = { now,featureEnabled: true,pushAuthorized: true,dinnerAlreadyPlanned: false,cookingInProgress: false,notCookingToday: false,
    candidate: { userId,sourceKey: `expiry:${userId}:a`,kind: 'expiry_rescue',startsAt: now-60_000,expiresAt: now+12*60*60_000,dataObservedAt: now,
      localDate: '2026-09-12',inventoryIds: [1],recipeIds: [1],recommendationQuality: 0.8,title: '临期测试',body: '测试建议',whyNow: '测试',expiresLabel: '测试',actions: ['plan_recipe'] } };
  const [first,replay] = await Promise.all([repository.reserveIntervention(input),repository.reserveIntervention(input)]);
  assert.equal(first.id,replay.id);assert.equal(first.notification_id,replay.notification_id);assert.equal(first.channel,'push');
  assert.equal(first.delivery_state,'pending');
  const another = await repository.reserveIntervention({ ...input,candidate: { ...input.candidate,sourceKey: `expiry:${userId}:b` } });
  assert.equal(another.channel,'suppressed');assert.equal(another.decision_reason,'cooldown');assert.equal(another.notification_id,null);
  const later = await repository.reserveIntervention({ ...input,now: now+2*60*60_000,candidate: { ...input.candidate,sourceKey: `expiry:${userId}:c` } });
  assert.equal(later.channel,'inbox_only');assert.equal(later.decision_reason,'daily_push_limit');assert.equal(later.push_reserved_at,null);
  assert(later.notification_id);
  const persisted = await repository.reserveIntervention({ ...input,featureEnabled: false });
  assert.equal(persisted.id,first.id);assert.equal(persisted.channel,'push','replay does not rewrite historical policy');
  assert(await repository.saveInterventionPreferences(userId,{ ...prefs,enabled: false,version: 1 }));
  const afterDisable = await repository.reserveIntervention({ ...input,candidate: { ...input.candidate,sourceKey: `expiry:${userId}:disabled` } });
  assert.equal(afterDisable.channel,'suppressed');assert.equal(afterDisable.decision_reason,'not_authorized');
  assert.equal((await repository.reserveIntervention(input)).delivery_state,'cancelled');
}
