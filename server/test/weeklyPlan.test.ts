import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWeeklyPlan } from "../src/modules/recommendations/weeklyPlan.js";
import type { PreparedMeal } from "@dietdigidose/contracts";
const startDate = "2099-09-12";
const candidate = { recipeId: 1,score: 100,recipe: { title: "蛋羹",ingredients: [{ name: "鸡蛋",amount: "1个" }],serving_size: 1,cook_time: 10,prep_time: 2 } } as Parameters<typeof buildWeeklyPlan>[2][number];
const stock = (id: number, count: number, expiry = "2099-09-30") => ({ id,food_name: "鸡蛋",quantity_value: count,quantity_unit: "piece",expiration_date: expiry,version: 1,batch_code: null });
const input = { startDate,mealTypes: ["lunch" as const],servings: 1 };

test("weekly reservations merge ten eggs across seven meals into six to buy, with meal provenance", () => {
  const existing = [12,13,14].map(day => ({ id: `existing:${day}`,planned_date: `2099-09-${day}`,meal_type: "午餐",title: "双蛋羹",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }));
  const inventory = [stock(16,4)];
  const plan = buildWeeklyPlan(input,{ meal_time_minutes: 30 },[candidate],inventory,[],existing,[{ id: "shopping",name: "鸡蛋",amount: "10个",checked: false }]);
  assert.equal(plan.slots.length,7);
  assert.equal(plan.slots.filter(slot => slot.state === "preserved").length,3);
  assert.deepEqual(plan.shopping.map(item => [item.required,item.covered,item.missing]),[[10,4,6]]);
  assert.equal(plan.shopping[0].sources.length,7);
  assert.equal(plan.plannedPurchases.length,1);
  assert.equal(inventory[0].quantity_value,4);
  assert.equal(plan.draft?.cooking.length,4);
});

test("future allocation uses expiry on the target date and never reuses the same stock", () => {
  const plan = buildWeeklyPlan(input,{ meal_time_minutes: 30 },[candidate],[stock(1,10,startDate)],[],[],[]);
  assert.equal(plan.shopping[0].covered,1);
  assert.equal(plan.shopping[0].missing,6);
  assert.equal(plan.shopping[0].sources[0].missing,0);
  assert.equal(plan.shopping[0].sources[1].missing,1);
});

test("reserved prepared meals cannot be reused; rolling keeps relevant existing meals", () => {
  const batch = { id: "19600000-0000-4000-8000-000000000001",food_name: "现成蛋羹",remaining_servings: 2,produced_at: "2099-09-12T08:00:00Z",version: 1,is_reserved: false,planned_date: null,meal_type: "午餐" } as PreparedMeal;
  const plan = buildWeeklyPlan(input,{ meal_time_minutes: 30 },[candidate],[],[batch],[],[],[{ preparedMealId: batch.id,servings: 1 }]);
  assert.equal(plan.draft?.meals.reduce((sum,meal) => sum+meal.preparedServings,0),1);
  assert.equal(batch.remaining_servings,2);
  const rolled = buildWeeklyPlan({ ...input,startDate: "2099-09-13" },{},[candidate],[],[],[{ id: "kept",planned_date: "2099-09-14",meal_type: "午餐",title: "保留饭",status: "completed" }],[]);
  assert.equal(rolled.endDate,"2099-09-19");
  assert.equal(rolled.slots.find(slot => slot.date === "2099-09-14")?.state,"preserved");
});

test("unknown committed quantities and excessive cooking time remain unresolved", () => {
  const plan = buildWeeklyPlan(input,{},[candidate],[stock(1,100)],[],[{ id: "unknown",planned_date: startDate,meal_type: "午餐",title: "现有安排",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "适量" }] }],[]);
  assert.equal(plan.draft?.unresolved.length,6);
  assert.equal(plan.shopping.length,0);
  const tooLong = buildWeeklyPlan(input,{ meal_time_minutes: 5 },[candidate],[],[],[],[]);
  assert.equal(tooLong.draft?.unresolved.length,7);
});

test("weekly replacement reserves other plans and applies target-day expiry without changing other meals", async () => {
  const { replaceCookingDraft } = await import("../src/modules/recommendations/plan.js");
  const inventory = [stock(1,4,"2099-09-13")];
  const existing = [{ id: "existing",planned_date: startDate,meal_type: "午餐",title: "原有双蛋",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }];
  const original = buildWeeklyPlan(input,{},[candidate],inventory,[],existing,[]).draft!;
  const replacement = { ...candidate,recipeId: 2,recipe: { ...candidate.recipe,title: "双蛋",ingredients: [{ name: "鸡蛋",amount: "2个" }] } };
  const changed = replaceCookingDraft(original,"week:2099-09-13:lunch",2,[candidate,replacement],inventory,existing);
  const eggs = changed.draft.weeklyShopping![0];
  assert.deepEqual([eggs.required,eggs.covered,eggs.missing],[9,4,5]);
  assert.equal(changed.draft.ingredientBudget[0].covered_value,2);
  assert(changed.draft.ingredientBudget.slice(1).every(item => item.covered_value === 0));
  assert.deepEqual(changed.draft.cooking.slice(1),original.cooking.slice(1));
  assert.equal(inventory[0].quantity_value,4);
});

test("rechecking after cancellation and purchase updates shortages while retaining manual shopping", () => {
  const existing = [{ id: "existing",planned_date: startDate,meal_type: "午餐",title: "原有双蛋",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }];
  const shopping = [{ id: "manual",name: "手工采购",amount: "一盒",checked: false }];
  const before = buildWeeklyPlan(input,{},[candidate],[stock(1,4)],[],existing,shopping);
  const after = buildWeeklyPlan(input,{},[candidate],[stock(1,8)],[],[{ ...existing[0],status: "skipped" }],shopping);
  assert.equal(before.shopping[0].missing,4);
  assert.equal(after.shopping[0].required,7);
  assert.equal(after.shopping[0].missing,0);
  assert.deepEqual(after.plannedPurchases,before.plannedPurchases);
});

test("no-spicy weekly planning does not assume a prepared batch has verified spice content",() => {
  const batch = { id: "19600000-0000-4000-8000-000000000001",food_name: "昨天的饭",remaining_servings: 2,produced_at: "2099-09-12T08:00:00Z",version: 1,is_reserved: false,planned_date: null,meal_type: "午餐" } as PreparedMeal;
  const preview = buildWeeklyPlan(input,{ avoid_spicy: true },[candidate],[],[batch],[],[]);
  assert(preview.draft!.meals.every(meal => meal.preparedServings === 0));
  assert(preview.checksPending.some(message => message.includes("辣度未核实")));
});
