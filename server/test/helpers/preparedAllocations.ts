import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cookingPlanDraftSchema } from "@dietdigidose/contracts";
import type { MealPlansRepository } from "../../src/modules/mealPlans/repository.js";

export async function verifyPreparedAllocations(repository: MealPlansRepository, userId: number, batchId: string, mutate: () => Promise<void>) {
  const draft = cookingPlanDraftSchema.parse({ status: "requires_validation", meals: [{ id: "dinner", date: "2099-09-10", mealType: "dinner", servings: 1,
    preparedServings: 1, cookServings: 0, allocations: [{ preparedMealId: batchId, version: 1, foodName: "份量安排", servings: 1, validationRequired: true }] }], totalCookServings: 0,
    cooking: [], unresolved: [], ingredientBudget: [], time: { budgetMinutes: 30, knownSequentialMinutes: 0, exceedsBudget: false, isEstimate: true, incomplete: true, missing: ["storage"] },
    checksPending: ["storage"], excludedPreparedMealIds: [], effectivePreferences: {} });
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) assert(await repository.saveDraft(userId, { id, title: "待吃安排", draft }));
  const results = await Promise.all(ids.map(id => repository.activateDraft(userId, id, 1)));
  assert.deepEqual(results.map(result => result.kind).sort(), ["updated", "version_conflict"]);
  const winner = ids[results.findIndex(result => result.kind === "updated")];
  const loser = ids[results.findIndex(result => result.kind === "version_conflict")];
  const replay = await repository.activateDraft(userId, winner, 1);
  assert.equal(replay.kind, "updated");
  if (replay.kind === "updated") assert.equal(replay.value.repeated, true);
  assert.equal((await repository.find(userId, loser, false))?.status, "draft");
  assert.equal(await repository.removePlan(userId, winner, 2), "removed");
  assert.equal((await repository.activateDraft(userId, loser, 1)).kind, "updated", "cancellation releases the reservation");
  assert.equal(await repository.removePlan(userId, loser, 2), "removed");
  await mutate();
  const staleId = randomUUID();
  await repository.saveDraft(userId, { id: staleId, title: "已变化批次", draft });
  assert.equal((await repository.activateDraft(userId, staleId, 1)).kind, "version_conflict");
  assert.equal((await repository.activateDraft(userId + 1, staleId, 1)).kind, "not_found");
}
