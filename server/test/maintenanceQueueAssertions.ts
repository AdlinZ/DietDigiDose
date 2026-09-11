import assert from "node:assert/strict";
import type { MaintenanceQueueRepository } from "../src/modules/planMaintenance/queue.js";

export async function verifyMaintenanceQueue(harness: {
  repository: () => MaintenanceQueueRepository;
  seed: (id: string,userId: number,at: string) => Promise<void>;
  unprocessed: () => Promise<number>;
  users: [number,number];
  seedMeals: (userId: number) => Promise<void>;
  mealState: (id: string) => Promise<{ version: number; plannedDate: string }>;
  changeCount: () => Promise<number>;
}) {
  const now = new Date(Date.now()+3_600_000);
  const later = (ms: number) => new Date(now.getTime()+ms);
  for (const [id,user] of [["queue-a",harness.users[0]],["queue-b",harness.users[0]],["queue-c",harness.users[1]]] as const) {
    await harness.seed(id,user,later(-31_000).toISOString());
  }
  await harness.seed("queue-fresh",harness.users[0],now.toISOString());
  assert.equal(await harness.repository().enqueueEvents(now,1),1);
  assert.equal(await harness.repository().enqueueEvents(now),2);
  assert.equal(await harness.repository().enqueueEvents(now),0);
  const claimed = await Promise.all([harness.repository().claim(now),harness.repository().claim(now)]);
  assert.ok(claimed[0]); assert.ok(claimed[1]);
  assert.notEqual(claimed[0].userId,claimed[1].userId);
  const first = claimed.find(job => job?.userId === harness.users[0])!;
  const other = claimed.find(job => job?.userId === harness.users[1])!;
  assert.deepEqual(first.eventIds,["queue-a","queue-b"]);
  assert.deepEqual(other.eventIds,["queue-c"]);
  assert.equal(await harness.repository().claim(now),null);
  assert.equal(await harness.repository().fail(first,now,"temporary\nfailure"),true);
  assert.equal(await harness.repository().fail(first,now,"stale failure"),false);
  assert.equal(await harness.repository().claim(later(29_000)),null);
  const retry = await harness.repository().claim(later(31_000),1000);
  assert.ok(retry); assert.equal(retry.id,first.id); assert.equal(retry.attempt,2);
  assert.notEqual(retry.leaseToken,first.leaseToken);
  const recovered = await harness.repository().claim(later(32_001),1000);
  assert.ok(recovered); assert.equal(recovered.id,first.id); assert.equal(recovered.attempt,3);
  assert.equal(await harness.repository().fail(retry,later(32_002),"late"),false);
  assert.equal(await harness.repository().fail(recovered,later(32_002),"final"),true);
  assert.equal(await harness.repository().claim(later(33_000)),null);
  // Recover a crashed job twice, then stop after its third expired attempt.
  const otherRetry = await harness.repository().claim(later(300_001),1000);
  assert.ok(otherRetry); assert.equal(otherRetry.id,other.id); assert.equal(otherRetry.attempt,2);
  const otherFinal = await harness.repository().claim(later(301_002),1000);
  assert.ok(otherFinal); assert.equal(otherFinal.attempt,3);
  assert.equal(await harness.repository().claim(later(302_003)),null);
  assert.equal(await harness.repository().enqueueEvents(later(303_000)),1);
  const fresh = await harness.repository().claim(later(303_000));
  assert.ok(fresh); assert.equal(fresh.attempt,1); assert.deepEqual(fresh.eventIds,["queue-fresh"]);
  assert.equal(await harness.unprocessed(),4);
  assert.equal(await harness.repository().enqueueEvents(later(304_000)),0);
  await harness.seedMeals(harness.users[0]);
  const change = (itemId: string,version = 1) => ({ planVersion: 1,planId: "maintenance-plan",itemId,
    input: { version,plannedDate: "2026-09-13" },reason: "关联库存变化" });
  assert.deepEqual(await harness.repository().applyChanges(first,[change("maintenance-mutable")]),{ kind: "lease_lost" });
  assert.deepEqual(await harness.repository().applyChanges(fresh,[change("maintenance-mutable"),change("maintenance-confirmed",99)]),{ kind: "input_conflict" });
  assert.deepEqual(await harness.repository().applyChanges(fresh,[{ ...change("maintenance-mutable"),planVersion: 99 }]),{ kind: "input_conflict" });
  assert.deepEqual(await harness.repository().applyChanges(fresh,[{ ...change("maintenance-mutable"),input: { version: 1,plannedDate: "2026-10-01" } }]),{ kind: "input_conflict" });
  assert.deepEqual(await harness.mealState("maintenance-mutable"),{ version: 1,plannedDate: "2026-09-12" });
  assert.equal(await harness.changeCount(),0);
  assert.equal(await harness.unprocessed(),4);
  const applied = await harness.repository().applyChanges(fresh,["mutable","confirmed","cooking","purchased"].map(kind => change(`maintenance-${kind}`)));
  assert.equal(applied.kind,"completed");
  if (applied.kind !== "completed") assert.fail("expected completion");
  assert.deepEqual(applied.changes.map(item => (item.change as { status: string }).status),["applied","pending","blocked","pending"]);
  assert.deepEqual(await harness.mealState("maintenance-mutable"),{ version: 2,plannedDate: "2026-09-13" });
  for (const kind of ["confirmed","cooking","purchased","untouched"]) assert.deepEqual(await harness.mealState(`maintenance-${kind}`),{ version: 1,plannedDate: "2026-09-12" });
  assert.equal(await harness.unprocessed(),3);
  assert.equal(await harness.changeCount(),4);
  assert.deepEqual(await harness.repository().applyChanges(fresh,[]),{ kind: "lease_lost" });
  assert.equal(await harness.changeCount(),4);
}
