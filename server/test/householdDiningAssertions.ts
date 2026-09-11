import assert from "node:assert/strict";
import type { HouseholdsService } from "../src/modules/households/service.js";
export async function verifyHouseholdDining(service: HouseholdsService,householdId: number,owner: number,member: number,recipeId?: number) {
  const initial = await service.diningPreferences(member,householdId);
  assert.equal(initial.shared,false); assert.deepEqual(initial.allergies,[]);
  const saved = await service.saveDiningPreferences(member,householdId,{ ...initial,shared: true,allergies: ["花生"],restrictions: ["不吃猪肉"] });
  assert.equal(saved.version,initial.version+1);
  assert.equal((await service.diningPreferences(owner,householdId)).shared,false);
  assert.equal(JSON.stringify(await service.mine(owner)).includes("花生"),false);
  await assert.rejects(() => service.saveDiningPreferences(member,householdId,{ ...initial,shared: true,allergies: [],restrictions: [] }),/已变化/);
  const shared = (await service.diningMembers(owner,householdId)).members;
  assert.deepEqual(shared.find(value => value.userId === member),{ membershipId: initial.membershipId,userId: member,name: shared.find(value => value.userId === member)?.name,version: saved.version,shared: true,allergies: ["花生"],restrictions: ["不吃猪肉"] });
  assert.equal(shared.find(value => value.userId === owner)?.shared,false);
  assert.equal("allergies" in shared.find(value => value.userId === owner)!,false);
  if (recipeId) {
    const checked = await service.previewDiningAllocation(owner,householdId,{ recipeId,participants: [{ membershipId: initial.membershipId,version: saved.version,servings: 1 }] });
    assert.equal(checked.recipeCheck?.status,"blocked");
    assert.equal(checked.recipeCheck?.materials.status,"known");
    assert.deepEqual(checked.recipeCheck?.materials.demands,[{ food_name: "花生油",amount_value: 5,unit: "ml" }]);
    assert.ok(checked.recipeCheck?.conflicts.some(item => item.constraint === "花生"));
    await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ recipeId: 2147000000,participants: [{ membershipId: initial.membershipId,version: saved.version,servings: 1 }] }),/不可用于/);
  }
  const selection = { participants: [{ membershipId: initial.membershipId,version: saved.version,servings: 1.5 }] };
  assert.equal((await service.previewDiningAllocation(owner,householdId,selection)).totalServings,1.5);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ participants: [{ ...selection.participants[0]!,version: initial.version }] }),/已变化/);
  const hidden = await service.saveDiningPreferences(member,householdId,{ ...saved,shared: false });
  assert.equal(hidden.shared,false);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,selection),/已变化/);
  await assert.rejects(() => service.previewDiningAllocation(owner,householdId,{ participants: [{ ...selection.participants[0]!,version: hidden.version }] }),/尚未授权/);
  const withdrawn = (await service.diningMembers(owner,householdId)).members.find(value => value.userId === member)!;
  assert.equal(withdrawn.shared,false);
  assert.equal("allergies" in withdrawn,false);
  assert.equal("restrictions" in withdrawn,false);
  await service.leave(member,householdId);
  await assert.rejects(() => service.diningMembers(member,householdId),/不是/);
  assert.equal((await service.diningMembers(owner,householdId)).members.some(value => value.userId === member),false);
  await assert.rejects(() => service.diningPreferences(member,householdId),/不是/);
  await assert.rejects(() => service.saveDiningPreferences(member,householdId,hidden),/不是/);
  return initial;
}

export async function verifyHouseholdProduction(service: HouseholdsService, householdId: number,owner: number,member: number) {
  const membership = await service.diningPreferences(owner,householdId);
  const first = await service.createInventory(owner,householdId,{ food_name: "制作鸡蛋",quantity: "6个",expiration_date: "2099-01-01" });
  const second = await service.createInventory(owner,householdId,{ food_name: "制作米",quantity: "100g",expiration_date: "2099-01-01" });
  const input = { idempotencyKey: "78888888-8888-4888-8888-888888888881",membershipId: membership.membershipId,foodName: "家庭蛋饭",producedServings: 3,
    inventory: [{ itemId: Number(first.id),version: Number(first.version),amount: 3,unit: "piece" as const },{ itemId: Number(second.id),version: Number(second.version),amount: 50,unit: "g" as const }] };
  await assert.rejects(() => service.produceMeal(owner,householdId,{ ...input,inventory: [input.inventory[0]!,{ ...input.inventory[1]!,version: 999 }] }),/库存已/);
  assert.equal((await service.inventory(owner,householdId)).find(item => item.id === first.id)?.quantity,"6个");
  const concurrent = await Promise.all([service.produceMeal(owner,householdId,input),service.produceMeal(owner,householdId,input)]);
  assert.deepEqual(concurrent.map(value => value.repeated).sort(),[false,true]);
  assert.equal(concurrent[0]!.id,concurrent[1]!.id);
  const batch = concurrent[0]!;
  assert.equal(batch.producedServings,3); assert.equal(batch.remainingServings,3);
  const replay = await service.produceMeal(owner,householdId,input);
  assert.equal(replay.id,batch.id); assert.equal(replay.repeated,true);
  assert.equal((await service.inventory(owner,householdId)).find(item => item.id === first.id)?.quantity,"3个");
  await assert.rejects(() => service.produceMeal(owner,householdId,{ ...input,producedServings: 4 }),/制作编号/);
  await assert.rejects(() => service.produceMeal(member,householdId,input),/成员身份/);
  return batch;
}

export async function verifyHouseholdEating(service: HouseholdsService,householdId: number,mealId: string,users: number[]) {
  const inventoryBefore = await service.inventory(users[0]!,householdId);
  const selections = await Promise.all(users.map(async (user,index) => ({ user,input: {
    idempotencyKey: `78888888-8888-4888-8888-88888888888${index+2}`,
    membershipId: (await service.diningPreferences(user,householdId)).membershipId,
    version: index === 0 ? 1 : 2,servings: 1,recordedDate: "2026-09-12",recordedTime: "12:00",mealType: "lunch" as const,
  } })));
  const first = await service.eatMeal(users[0]!,householdId,mealId,selections[0]!.input);
  const replay = await service.eatMeal(users[0]!,householdId,mealId,selections[0]!.input);
  assert.equal(replay.repeated,true); assert.equal(replay.dietRecordId,first.dietRecordId);
  const contenders = selections.slice(1);
  const race = await Promise.allSettled(contenders.map(item => service.eatMeal(item.user,householdId,mealId,item.input)));
  assert.equal(race.filter(item => item.status === "fulfilled").length,1);
  const rejectedIndex = race.findIndex(item => item.status === "rejected");
  assert.ok(rejectedIndex >= 0);
  const loser = contenders[rejectedIndex]!;
  const last = await service.eatMeal(loser.user,householdId,mealId,{ ...loser.input,version: 3 });
  assert.equal((last.meal as { remainingServings: number }).remainingServings,0);
  await assert.rejects(() => service.eatMeal(users[0]!,householdId,mealId,{ ...selections[0]!.input,idempotencyKey: "78888888-8888-4888-8888-888888888889",version: 4 }),/不足/);
  const listed = await service.meals(users[0]!,householdId);
  assert.equal(listed.find(item => item.id === mealId)?.remainingServings,0);
  assert.equal(JSON.stringify(listed).includes("dietRecord"),false);
  assert.deepEqual(await service.inventory(users[0]!,householdId),inventoryBefore);
  for (const item of inventoryBefore) await service.removeInventory(users[0]!,householdId,Number(item.id),Number(item.version));
  await service.leave(users[2]!,householdId);
  await assert.rejects(() => service.meals(users[2]!,householdId),/不是/);
  await assert.rejects(() => service.eatMeal(users[2]!,householdId,mealId,selections[2]!.input),/成员身份/);
}
