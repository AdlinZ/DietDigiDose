import assert from "node:assert/strict";
import test from "node:test";
import { hasPermanentPreferenceIntent, permanentPreferencePayloadSchema } from "../src/services/agent/preferencePayload.js";
import { validateAgentActions } from "../src/services/agent/policy.js";

test("persistent preferences require explicit durable intent and remain high risk", () => {
  for (const text of ["今天两个人，做今晚和明天午饭", "这次不要冷藏", "今天两个人，以后再说", "不要保存默认偏好"]) {
    assert.equal(hasPermanentPreferenceIntent(text), false, text);
  }
  assert.equal(hasPermanentPreferenceIntent("以后都按两个人"), true);
  assert.equal(hasPermanentPreferenceIntent("记住我在单位不能加热"), true);
  assert.equal(permanentPreferencePayloadSchema.safeParse({ scope: "persistent", preferences: { allergies: [] } }).success, false);
  assert.equal(permanentPreferencePayloadSchema.safeParse({ scope: "request", preferences: { servings: 2 } }).success, false);
  const actions = validateAgentActions([{ actionType: "update_kitchen_preferences", summary: "长期人数改为两人",
    payload: { scope: "persistent", preferences: { servings: 2 } } }], {
    userId: 1, dailyCaloriesTarget: 2000, inventory: [], kitchenware: [], todayDiet: [], recommendedRecipes: [],
  });
  assert.equal(actions[0].riskLevel, "high");
});
