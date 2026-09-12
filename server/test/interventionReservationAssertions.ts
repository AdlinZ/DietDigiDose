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

export async function verifyInterventionDelivery(repository: NotificationsRepository,userId: number) {
  const settings = await repository.interventionPreferences(userId);
  assert(await repository.saveInterventionPreferences(userId,{ ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,version: Number(settings?.version ?? 0) }));
  const base = Date.parse('2026-09-15T09:00:00Z');
  const reserve = (day: number) => repository.reserveIntervention({ now: base+day*86_400_000,featureEnabled: true,pushAuthorized: true,dinnerAlreadyPlanned: false,cookingInProgress: false,notCookingToday: false,
    candidate: { userId,sourceKey: `delivery:${userId}:${day}`,kind: 'expiry_rescue',startsAt: base+day*86_400_000,expiresAt: base+day*86_400_000+3*60*60_000,dataObservedAt: base+day*86_400_000,
      localDate: '2026-09-15',inventoryIds: [1],recipeIds: [1],recommendationQuality: 0.8,title: '领取测试',body: '领取正文',whyNow: '测试',expiresLabel: '测试',actions: ['plan_recipe'] } });
  assert((await repository.interventionScanUsers(0,100)).includes(userId));
  assert(!(await repository.interventionScanUsers(userId,100)).includes(userId));
  assert.deepEqual(await repository.interventionQueue(userId),[]);
  const first = await reserve(0);
  assert((await repository.pendingInterventionUsers(base,100)).includes(userId));
  const claims = await Promise.all([repository.claimIntervention(userId,base,'worker-a',true),repository.claimIntervention(userId,base,'worker-b',true)]);
  assert.equal(claims.filter(Boolean).length,1);
  const claim = claims.find(Boolean)!;
  assert.equal(claim.id,first.id);assert.equal(claim.title,'领取测试');assert(claim.tokens.length);
  assert.equal(await repository.finishIntervention(claim.id,'wrong-owner',base+1,'accepted'),false);
  assert.equal(await repository.finishIntervention(claim.id,claim.owner,base+1,'accepted'),true);
  assert.equal(await repository.finishIntervention(claim.id,claim.owner,base+2,'accepted'),false);
  assert(!(await repository.pendingInterventionUsers(base,100)).includes(userId));
  const crashed = await reserve(1);
  assert(await repository.claimIntervention(userId,base+86_400_000,'crashed-worker',true));
  assert(!(await repository.pendingInterventionUsers(base+86_400_000+1,100)).includes(userId));
  assert((await repository.pendingInterventionUsers(base+86_400_000+120_000,100)).includes(userId));
  assert.equal(await repository.claimIntervention(userId,base+86_400_000+120_000,'restarted-worker',true),null);
  assert.equal(await repository.finishIntervention(String(crashed.id),'crashed-worker',base+86_400_000+120_001,'accepted'),false);
  assert.equal((await reserve(1)).delivery_state,'uncertain');
  await reserve(2);
  assert.equal(await repository.claimIntervention(userId,base+2*86_400_000,'disabled-worker',false),null);
  assert.equal((await reserve(2)).delivery_state,'cancelled');
  await reserve(3);
  assert.equal(await repository.claimIntervention(userId,base+3*86_400_000+3*60*60_000,'late-worker',true),null);
  assert.equal((await reserve(3)).status,'expired');
}

export async function verifyInterventionScanCursor(repository: NotificationsRepository,worker: import("../src/modules/worker/repository.js").WorkerRepository) {
  assert.equal(await repository.interventionScanCursor(),0);
  assert.equal(await repository.advanceInterventionScan(0,10,"not-owner"),false);
  assert(await worker.acquireLease("intervention-scan","scan-checkpoint-owner",60_000));
  assert.equal(await repository.advanceInterventionScan(0,10,"scan-checkpoint-owner"),true);
  assert.equal(await repository.interventionScanCursor(),10);
  assert.equal(await repository.advanceInterventionScan(0,20,"scan-checkpoint-owner"),false,"stale cursor cannot move progress");
  assert(await worker.releaseLease("intervention-scan","scan-checkpoint-owner"));
  assert(await worker.acquireLease("intervention-scan","scan-new-owner",60_000));
  assert.equal(await repository.advanceInterventionScan(10,20,"scan-checkpoint-owner"),false);
  assert.equal(await repository.advanceInterventionScan(10,20,"scan-new-owner"),true);
  assert.equal(await repository.interventionScanCursor(),20);
  assert.equal(await repository.advanceInterventionScan(20,0,"scan-new-owner"),true);
  assert(await worker.releaseLease("intervention-scan","scan-new-owner"));
}
