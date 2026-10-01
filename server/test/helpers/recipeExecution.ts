import assert from "node:assert/strict";
import type { RecipeExecutionProfile } from "@dietdigidose/contracts";
import type { AdminRecipesService } from "../../src/modules/adminRecipes/service.js";
import type { RecipesService } from "../../src/modules/recipes/service.js";
import type { RecommendationsService } from "../../src/modules/recommendations/service.js";
import type { KitchenwareService } from "../../src/modules/kitchenware/service.js";
import { planTime } from "../../src/modules/recommendations/plan.js";
import { reviewedExecution } from "../../src/modules/recipes/execution.js";

export const executionFixture: RecipeExecutionProfile = { version: 1, maxBatchServings: 2,
  reference: "合成固定时长回归依据，不代表真实菜谱验收", tools: [
    { key: "pot", name: "测试锅", catalogId: 1, capacity: { kind: "volume", mlPerServing: 500 } },
  ], tasks: [
    { id: "prepare", title: "准备", phase: "preparation", minutes: 5, active: true, dependsOn: [], tools: [] },
    { id: "cook", title: "烹饪", phase: "cooking", minutes: 10, active: false, dependsOn: ["prepare"], tools: ["pot"] },
    { id: "clean", title: "收尾", phase: "cleanup", minutes: 2, active: true, dependsOn: ["cook"], tools: ["pot"] },
  ] };

type Query = (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
export async function verifyRecipeExecution(admin: AdminRecipesService, recipes: RecipesService,
  recommendations: RecommendationsService, kitchenware: KitchenwareService, adminId: number, query: Query) {
  const userId = Number((await query("INSERT INTO users(username,email) VALUES('execution-fixture','execution-fixture@example.invalid') RETURNING id"))[0].id);
  const catalog = await kitchenware.resolveCatalog("平底锅"); assert(catalog && catalog.confidence === 1);
  const device = await kitchenware.create(userId, { name: "平底锅", attributes: { capacityMl: 1000 } });
  const body = { title: "合成排程回归菜谱", ingredients: [{ name: "排程回归原料", amount: "2个" }],
    steps: ["准备", "煮熟", "收尾"], cook_time: 10, prep_time: 5, serving_size: 2, required_kitchenware: ["平底锅"] };
  const context = { adminUserId: adminId };
  const recipeId = (await admin.create(adminId, body, context)).id;
  const profile = { ...executionFixture, handling: { storage: "refrigerated" as const, maxHoldHours: 72, coldServingAllowed: true, carryAllowed: false,
    sourceUrl: "https://example.invalid/handling-fixture", reference: "合成存放审核回归依据", instructions: "合成测试专用，不作为实际菜谱存放和食用依据" }, tools: [{ ...executionFixture.tools[0], name: "平底锅", catalogId: catalog.id }] };
  const keys = await admin.execution(recipeId); assert.equal(keys.execution, null);
  const input = { recipeKey: keys.recipeKey, reviewKey: keys.reviewKey, profile };
  await assert.rejects(admin.reviewExecution(adminId, recipeId, { ...input, profile: { ...profile, tools: [] } }, context));
  const concurrent = await Promise.allSettled([admin.reviewExecution(adminId, recipeId, input, context), admin.reviewExecution(adminId, recipeId, input, context)]);
  assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(item => item.status === "rejected").length, 1);
  await assert.rejects(admin.reviewExecution(adminId, recipeId, input, context), /改变/);
  const stored = (await query("SELECT * FROM recipes WHERE id=?", [recipeId]))[0];
  assert.equal(reviewedExecution(stored)?.reviewedBy, adminId);
  const detail = await recipes.detail(recipeId, { protocol: "http", host: "localhost" });
  assert.deepEqual(detail.execution_profile, profile); assert.equal("execution_json" in detail, false);
  assert.equal("reviewedBy" in (detail.execution_evidence as Record<string, unknown>), false);
  const computed = await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 20 });
  assert.equal(computed.results.length, 1); assert(computed.results[0].hardConstraints.satisfied.includes("time"));
  assert.equal(computed.results[0].features.cookingSchedule.elapsedMinutes, 17);
  await query("UPDATE kitchenware_catalog SET quality_status='needs_review' WHERE id=?", [catalog.id]);
  const revokedCatalog = await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 20 });
  assert(revokedCatalog.results.length === 0 || revokedCatalog.results[0].hardConstraints.pending.includes("time"));
  const catalogKeys = await admin.execution(recipeId);
  await assert.rejects(admin.reviewExecution(adminId, recipeId, { recipeKey: catalogKeys.recipeKey, reviewKey: catalogKeys.reviewKey, profile }, context), /已审核/);
  await query("UPDATE kitchenware_catalog SET quality_status='trusted' WHERE id=?", [catalog.id]);
  assert.equal((await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 16 })).results.length, 0);
  const draft = await recommendations.cookingPlan(userId, { excludedPreparedMealIds: [], preferences: { meal_time_minutes: 30 },
    meals: [{ id: "execution-dinner", date: "2099-01-01", mealType: "dinner", servings: 3 }] });
  // Other catalogue candidates exist; directly price this reviewed candidate for the requested portions too.
  assert(draft.time.schedule);
  const split = planTime([{ targetMealId: "dinner", recipeId, title: body.title, servings: 3, recipeYield: 2,
    demands: [{ food_name: "排程回归原料", amount_value: 3, unit: "piece" }] }], computed.results,
  [{ id: device.id, catalog_id: catalog.id, name: "平底锅", attributes_json: { capacityMl: 750 } }], 30);
  assert.equal(split.schedule.elapsedMinutes, 34); assert.equal(split.exceedsBudget, true);
  await kitchenware.update(userId, Number(device.id), { name: "平底锅", attributes: { capacityMl: null } });
  const unknown = await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 20 });
  assert(unknown.results[0].hardConstraints.pending.includes("time")); assert.equal(unknown.results[0].features.cookingSchedule.elapsedMinutes, null);
  const beforeEdit = await admin.execution(recipeId);
  await admin.update(adminId, recipeId, { ...body, ingredients: [{ name: "排程回归原料", amount: "3个" }] }, context);
  assert.equal((await admin.execution(recipeId)).execution, null);
  assert.equal((await recipes.detail(recipeId, { protocol: "http", host: "localhost" })).execution_profile, null);
  await assert.rejects(admin.reviewExecution(adminId, recipeId, { recipeKey: beforeEdit.recipeKey, reviewKey: beforeEdit.reviewKey, profile }, context), /改变/);
  const fresh = await admin.execution(recipeId);
  await admin.reviewExecution(adminId, recipeId, { recipeKey: fresh.recipeKey, reviewKey: fresh.reviewKey, profile }, context);
  const reviewed = await admin.execution(recipeId);
  await admin.reviewExecution(adminId, recipeId, { recipeKey: reviewed.recipeKey, reviewKey: reviewed.reviewKey, profile: null }, context);
  assert.equal((await query("SELECT execution_json FROM recipes WHERE id=?", [recipeId]))[0].execution_json, null);
  assert.equal(Number((await query("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='recipe.execution_review' AND resource_id=?", [String(recipeId)]))[0].n), 3);
}
