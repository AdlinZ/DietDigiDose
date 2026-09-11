import assert from "node:assert/strict";
import { test } from "node:test";
import { replacementAllocation } from "../src/modules/mealPlans/replacementAllocation.js";

test("replacement retains planned portions and updates captured execution demands", () => {
  const current = { id: "meal",plan_constraints_json: { executionItems: { meal: { targetMealId: "target",servings: 1.5,recipeId: 1 } } } };
  const result = replacementAllocation(current,{ id: 2,title: "新菜",serving_size: 4,ingredients_json: [{ name: "大米",amount: "200g" }] });
  assert.deepEqual(result?.ingredients,[{ name: "大米",amount: "75g" }]);
  assert.equal(result?.constraints?.executionItems.meal.servings,1.5);
  assert.equal(result?.constraints?.executionItems.meal.targetMealId,"target");
  assert.equal(result?.constraints?.executionItems.meal.recipeId,2);
  assert.deepEqual(result?.constraints?.executionItems.meal.demands,[{ food_name: "大米",amount_value: 75,unit: "g" }]);
  assert.equal(current.plan_constraints_json.executionItems.meal.recipeId,1);
});

test("unknown yield or quantities cannot overwrite a portioned execution plan", () => {
  const current = { id: "meal",plan_constraints_json: JSON.stringify({ executionItems: { meal: { servings: 2 } } }) };
  assert.equal(replacementAllocation(current,{ serving_size: null,ingredients_json: [{ name: "米",amount: "200g" }] }),null);
  assert.equal(replacementAllocation(current,{ serving_size: 2,ingredients_json: [{ name: "米",amount: "适量" }] }),null);
  assert.deepEqual(replacementAllocation({ id: "legacy" },{ ingredients_json: '[{"name":"米","amount":"适量"}]' }),
    { ingredients: [{ name: "米",amount: "适量" }],constraints: null });
});
