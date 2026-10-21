import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateActiveReplacement, type ActiveReplacementArguments } from "../src/modules/mealPlans/activeReplacement.js";
import { executionRecipeKey } from "../src/modules/recipes/execution.js";
import { recipeExecutionProof } from "../src/modules/recipes/planExecution.js";
import { executionFixture } from "./helpers/recipeExecution.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";
function fixture(): ActiveReplacementArguments {
  const recipes: Row[] = [1, 2].map(id => ({ id, title: `菜${id}`, status: "approved", quality_status: "trusted", visibility: "public", serving_size: 2, cook_time: 10, prep_time: 5, steps_json: ["准备", "煮熟", "收尾"], ingredients_json: [{ name: "米", amount: "100g" }] }));
  for (const row of recipes) row.execution_json = { recipeKey: executionRecipeKey(row), reviewedBy: 1, reviewedAt: "2026-10-20T00:00:00Z", profile: { ...executionFixture, handling: { storage: "fresh_only", maxHoldHours: 0, coldServingAllowed: true, carryAllowed: false, sourceUrl: "https://example.invalid/review", reference: "合成测试存放依据", instructions: "仅用于自动测试的合成依据，不代表真实食品安全保证" } } };
  const executions = Object.fromEntries(["a", "b"].map(id => [id, { targetMealId: `old-${id}`, recipeId: 1, title: "菜1", servings: 2, recipeYield: 2, demands: [{ food_name: "米", amount_value: 100, unit: "g" }] }]));
  const items = ["a", "b"].map(id => ({ id, version: 1, plan_id: "p", status: "planned", planned_date: "2026-10-21", meal_type: "午餐", recipe_id: 1, title: "菜1", steps_json: recipes[0].steps_json, ingredients_json: recipes[0].ingredients_json }));
  return { userId: 1, itemId: "a", today: "2026-10-21", input: { version: 1, recipeId: 2 }, items, plan: { id: "p", user_id: 1, status: "active", start_date: "2026-10-21", end_date: "2026-10-23", constraints_json: { executionItems: executions, executionRecipeKeys: { a: recipeExecutionProof(recipes[0]), b: recipeExecutionProof(recipes[0]) }, currentCookingDraft: { productionDate: "2026-10-21", time: { budgetMinutes: 60 }, meals: [{ id: "stale", date: "1999-01-01" }], cooking: [{ recipeId: 999 }] } } }, data: { recipes, prepared_meal_allocations: [], prepared_meals: [], cooking_queue_items: [], user_health_profiles: [{ user_id: 1, kitchen_constraints_json: { meal_time_minutes: 60 } }], inventory_items: [{ id: 1, user_id: 1, is_available: 1, food_name: "米", quantity_value: 300, quantity_unit: "g", version: 1, expiration_date: "2026-11-01", quantity_evidence_status: "known" }], kitchenware_items: [{ id: 1, user_id: 1, catalog_id: 1, name: "测试锅", attributes_json: { capacityMl: 1000 } }], recipe_kitchenware_requirements: [], recipe_compatibility: [], meal_plans: [], meal_plan_items: [] } };
}
test("actual reviewed fixture passes, retains the other live meal and ignores stale draft targets", () => {
  const args = fixture(), before = structuredClone(args);
  const result = evaluateActiveReplacement(args);
  assert.deepEqual(result.checks, []); assert.equal(result.canApply, true);
  assert.equal(result.time?.schedule?.elapsedMinutes, 34);
  assert.equal(result.ingredientBudget.reduce((sum, part) => sum + part.covered_value, 0), 200);
  assert.equal(result.allocation?.constraints?.executionItems.a.recipeId, 2);
  assert.deepEqual(result.allocation?.constraints?.executionItems.b, (args.plan.constraints_json as Row).executionItems && ((args.plan.constraints_json as Row).executionItems as Row).b);
  assert.deepEqual(args, before);
});
test("whole live plan shortage and full-session overtime block the change", () => {
  const args = fixture(); args.data.inventory_items[0].quantity_value = 150;
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_shortage"));
  const fast = fixture(); ((fast.plan.constraints_json as Row).currentCookingDraft as Row).time = { budgetMinutes: 20 };
  assert(evaluateActiveReplacement(fast).checks.some(check => check.code === "time_exceeded"));
});
test("current allergies override stale permissive draft preferences", () => {
  const args = fixture(); args.data.user_health_profiles[0].allergies_json = [{ name: "米" }];
  ((args.plan.constraints_json as Row).currentCookingDraft as Row).effectivePreferences = { allergies: [] };
  const result = evaluateActiveReplacement(args); assert.equal(result.canApply, false);
  assert(result.checks.some(check => check.code === "hard_constraint"));
});
test("external commitments reserve only current plan window and current plan is not double charged", () => {
  const args = fixture(); args.data.inventory_items[0].quantity_value = 250;
  args.data.meal_plans = [{ id: "other", user_id: 1, status: "active" }, args.plan];
  args.data.meal_plan_items = [...args.items, ...["2026-10-20", "2026-10-22", "2026-10-24"].map((date, i) => ({ ...args.items[0], id: `ext${i}`, plan_id: "other", planned_date: date, ingredients_json: [{ name: "米", amount: "50g" }] }))];
  assert.equal(evaluateActiveReplacement(args).canApply, true);
  args.data.inventory_items[0].quantity_value = 249;
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_shortage"));
});
test("completed and skipped meals do not reuse ingredients; queued targets remain protected", () => {
  for (const status of ["completed", "skipped"]) {
    const args = fixture(); args.items[1].status = status; args.data.inventory_items[0].quantity_value = 100;
    const result = evaluateActiveReplacement(args); assert.equal(result.canApply, true); assert.equal(result.time?.schedule?.elapsedMinutes, 17);
  }
  const args = fixture(); args.items[0].status = "queued";
  assert.equal(evaluateActiveReplacement(args).checks[0].code, "item_locked");
});
test("missing execution, stale other recipe and household rows fail closed", () => {
  const missing = fixture(); (missing.plan.constraints_json as Row).executionItems = {};
  assert.equal(evaluateActiveReplacement(missing).checks[0].code, "execution_missing");
  const changed = fixture(); changed.items[1].steps_json = ["未审核修改"];
  assert(evaluateActiveReplacement(changed).checks.some(check => check.code === "execution_changed"));
  const dining = fixture(); dining.items[1].dining_json = { participants: [] };
  assert(evaluateActiveReplacement(dining).checks.some(check => check.code === "personal_only"));
});
test("missing prepared evidence and related allocations are pending, not successful confirmation", () => {
  const args = fixture(); delete args.data.prepared_meal_allocations;
  assert.equal(evaluateActiveReplacement(args).canApply, false);
  args.data.prepared_meal_allocations = [{ id: "allocation", plan_id: "p", status: "active", target_meal_id: "old-a" }];
  const before = structuredClone(args); assert(evaluateActiveReplacement(args).checks.some(check => check.code === "prepared_allocation_pending")); assert.deepEqual(args, before);
});
test("weekly unrelated prepared allocations remain unchanged and do not block replacement", () => {
  const args = fixture(); ((args.plan.constraints_json as Row).currentCookingDraft as Row).planningMode = "weekly";
  args.data.prepared_meal_allocations = [{ id: "unrelated", plan_id: "p", status: "active", target_meal_id: "prepared-only", planned_date: "2026-10-23", meal_type: "晚餐" }];
  const result = evaluateActiveReplacement(args); assert.equal(result.canApply, true); assert.equal(result.checks[0].severity, "info");
});
test("date and restoration operations also revalidate the current recipe", () => {
  const args = fixture(); args.items[0].status = "skipped"; args.input = { version: 1, status: "planned" };
  assert.equal(evaluateActiveReplacement(args).canApply, true);
  args.input.plannedDate = "2026-10-24";
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "invalid_scope"));
});

test("inventory evidence and availability cannot silently certify unverified stock", () => {
  const args = fixture(); args.data.inventory_change_logs = [{ id: 1, user_id: 1, inventory_item_id: 1, metadata_json: { inventory_version: 1, field_evidence: { quantity: { status: "unknown" } } } }];
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_unknown"));
  args.data.inventory_items[0].is_available = 0;
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "inventory_shortage"));
});
test("queue linkage protects a planned-looking target and weekly same-meal sessions share devices", () => {
  const args = fixture(); args.data.cooking_queue_items = [{ id: 1, source_plan_item_id: "a", status: "pending" }];
  assert.equal(evaluateActiveReplacement(args).checks[0].code, "item_locked");
  const weekly = fixture(); Object.assign((weekly.plan.constraints_json as Row).currentCookingDraft as Row, { planningMode: "weekly", time: { budgetMinutes: 60, sessionBudgetMinutes: 20 } });
  assert(evaluateActiveReplacement(weekly).checks.some(check => check.code === "time_exceeded"));
});

test("same-recipe edits cannot silently recapture changed steps or quantities", () => {
  const args = fixture(); args.input = { version: 1, mealType: "晚餐" }; args.items[0].steps_json = ["旧步骤已不同"];
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "execution_changed"));
});

test("revoked catalog governance cannot count as an available reviewed device", () => {
  const args = fixture(); args.data.kitchenware_catalog = [{ id: 1, name: "测试锅", quality_status: "needs_review" }];
  assert(evaluateActiveReplacement(args).checks.some(check => check.code === "schedule_incomplete"));
});

test("personal restore payload with unchanged null dining is accepted; stale item version is blocked", () => {
  const args = fixture(); args.items[0].status = "skipped";
  args.input = { version: 1, status: "planned", dining: null, plannedDate: "2026-10-21", mealType: "午餐" };
  assert.equal(evaluateActiveReplacement(args).canApply, true);
  args.input.version = 2;
  assert.equal(evaluateActiveReplacement(args).checks[0].code, "version_conflict");
});
test("legacy plans without production configuration cannot guess production from plan start", () => {
  const args = fixture(); delete (args.plan.constraints_json as Row).currentCookingDraft;
  const result = evaluateActiveReplacement(args); assert.equal(result.canApply, false);
  assert(result.checks.some(check => check.code === "production_configuration_missing"));
});
