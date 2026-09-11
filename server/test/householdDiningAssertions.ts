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
