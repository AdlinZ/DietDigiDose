import assert from "node:assert/strict";
import type { MealPlansRepository } from "../src/modules/mealPlans/repository.js";

export async function verifyPortionReplacement(repository: MealPlansRepository, userId: number, originalId: number, replacementId: number,
  allocation: () => Promise<{ recipeId: number; demands: { amount_value: number }[] }>) {
  const changed = await repository.updateItem(userId,"portion-plan","portion-meal",{ version: 1,recipeId: replacementId });
  assert.equal(changed.kind,"updated"); if (changed.kind !== "updated") assert.fail("replacement failed");
  assert.deepEqual(changed.value.ingredients,[{ name: "大米",amount: "75g" }]);
  assert.equal(changed.value.plannedServings,1.5);
  assert.equal((await allocation()).recipeId,replacementId);
  assert.equal((await allocation()).demands[0].amount_value,75);
  const changeId = String((changed.value.change as { id: string }).id);
  const restored = await repository.reviewChange(userId,"portion-plan",changeId,"restore");
  assert.equal(restored.kind,"updated"); if (restored.kind !== "updated") assert.fail("restore failed");
  assert.deepEqual(restored.value.ingredients,[{ name: "大米",amount: "150g" }]);
  assert.equal((await allocation()).recipeId,originalId);
  assert.equal((await allocation()).demands[0].amount_value,150);
}
