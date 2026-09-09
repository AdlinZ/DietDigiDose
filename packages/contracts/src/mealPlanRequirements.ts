import { inventoryUnitSchema } from "./inventory.ts";
import { kitchenPreferencesSchema } from "./mealPreferences.ts";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日期无效");
export const mealPlanRequirementsSchema = z.object({
  preferences: kitchenPreferencesSchema.optional(),
  meals: z.array(z.object({
    id: z.string().trim().min(1).max(80), date,
    mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    servings: z.number().finite().min(0.001).max(30),
  }).strict()).min(1).max(28),
  excludedPreparedMealIds: z.array(z.string().uuid()).max(100).default([]),
}).strict().refine(value => new Set(value.meals.map(meal => meal.id)).size === value.meals.length, "餐次标识不能重复");
export type MealPlanRequirementsInput = z.infer<typeof mealPlanRequirementsSchema>;

const amount = z.number().finite().nonnegative();
const positiveAmount = z.number().finite().positive();
export const cookingPlanDraftSchema = z.object({
  status: z.literal("requires_validation"),
  meals: z.array(z.object({
    id: z.string().min(1).max(80), date, mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    servings: positiveAmount.max(30), preparedServings: amount, cookServings: amount,
    allocations: z.array(z.object({ preparedMealId: z.string().uuid(), version: z.number().int().positive(),
      foodName: z.string().max(200), servings: positiveAmount, validationRequired: z.literal(true) })).max(100),
  })).min(1).max(28),
  totalCookServings: amount,
  cooking: z.array(z.object({ targetMealId: z.string().max(80), recipeId: z.number().int().positive(),
    title: z.string().max(200), servings: positiveAmount, recipeYield: positiveAmount,
    demands: z.array(z.object({ food_name: z.string().max(200), amount_value: positiveAmount, unit: inventoryUnitSchema })).max(100),
  })).max(28),
  unresolved: z.array(z.object({ targetMealId: z.string().max(80), reason: z.string().max(1000) })).max(28),
  ingredientBudget: z.array(z.object({ food_name: z.string().max(200), covered_value: amount, missing_value: amount,
    unit: inventoryUnitSchema, fully_covered: z.boolean(), requested_value: amount.optional(), name_available: z.boolean().optional(),
    deductions: z.array(z.object({ item_id: z.number().int().positive(), version: z.number().int().positive(),
      food_name: z.string().max(200), expiration_date: z.string().max(40), batch_code: z.string().max(200).nullable(),
      mode: z.enum(["all", "amount"]), amount_value: positiveAmount, unit: inventoryUnitSchema,
    })).max(1000).optional(),
    quantity_status: z.enum(["sufficient", "insufficient", "unknown", "unavailable"]).optional(),
  })).max(2800),
  time: z.object({ budgetMinutes: positiveAmount, knownSequentialMinutes: amount, exceedsBudget: z.boolean(),
    isEstimate: z.boolean(), incomplete: z.boolean(), missing: z.array(z.string().max(200)).max(50) }),
  checksPending: z.array(z.string().max(200)).max(50),
  excludedPreparedMealIds: z.array(z.string().uuid()).max(100),
  effectivePreferences: kitchenPreferencesSchema,
}).superRefine((draft, context) => {
  const close = (left: number, right: number) => Math.abs(left - right) <= 0.00001;
  const invalid = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  const ids = new Set(draft.meals.map(meal => meal.id));
  if (ids.size !== draft.meals.length) invalid(["meals"], "餐次标识不能重复");
  const excluded = new Set(draft.excludedPreparedMealIds);
  const batchVersions = new Map<string, number>();
  draft.meals.forEach((meal, index) => {
    if (!close(meal.preparedServings + meal.cookServings, meal.servings)) invalid(["meals", index], "待吃份量与补做份量之和必须等于需求份量");
    if (!close(meal.allocations.reduce((sum, item) => sum + item.servings, 0), meal.preparedServings)) invalid(["meals", index, "allocations"], "待吃分配之和必须等于待吃份量");
    if (new Set(meal.allocations.map(item => item.preparedMealId)).size !== meal.allocations.length) invalid(["meals", index, "allocations"], "同一餐次不能重复分配同一待吃批次");
    meal.allocations.forEach((allocation, allocationIndex) => {
      if (excluded.has(allocation.preparedMealId)) invalid(["meals", index, "allocations", allocationIndex], "保留或排除的待吃餐不能被分配");
      const version = batchVersions.get(allocation.preparedMealId);
      if (version !== undefined && version !== allocation.version) invalid(["meals", index, "allocations", allocationIndex], "同一待吃批次的版本必须一致");
      batchVersions.set(allocation.preparedMealId, allocation.version);
    });
    const cooking = draft.cooking.filter(item => item.targetMealId === meal.id);
    const unresolved = draft.unresolved.filter(item => item.targetMealId === meal.id);
    if (meal.cookServings > 0) {
      if (cooking.length + unresolved.length !== 1) invalid(["meals", index], "补做餐次必须有唯一的新做菜或待解决原因");
      if (cooking.length === 1 && !close(cooking[0].servings, meal.cookServings)) invalid(["meals", index], "新做菜的份量必须等于该餐次补做份量");
    } else if (cooking.length || unresolved.length) invalid(["meals", index], "无需补做的餐次不能重复安排新做菜");
  });
  draft.cooking.forEach((item, index) => {
    if (!ids.has(item.targetMealId)) invalid(["cooking", index, "targetMealId"], "新做菜必须属于现有餐次");
    if (!item.demands.length) invalid(["cooking", index, "demands"], "新做菜必须有明确原料用量");
  });
  draft.unresolved.forEach((item, index) => {
    if (!ids.has(item.targetMealId)) invalid(["unresolved", index, "targetMealId"], "待解决项必须属于现有餐次");
  });
  if (!close(draft.totalCookServings, draft.meals.reduce((sum, meal) => sum + meal.cookServings, 0))) invalid(["totalCookServings"], "总补做份量与各餐次不一致");
  if (draft.time.exceedsBudget !== (draft.time.knownSequentialMinutes > draft.time.budgetMinutes)) invalid(["time", "exceedsBudget"], "超时状态与时间预算不一致");
});
export type CookingPlanDraft = z.infer<typeof cookingPlanDraftSchema>;
export const saveCookingPlanDraftSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(120), draft: cookingPlanDraftSchema,
}).strict();
export type SaveCookingPlanDraftInput = z.infer<typeof saveCookingPlanDraftSchema>;

export const replaceCookingPlanItemSchema = z.object({
  draft: cookingPlanDraftSchema,
  targetMealId: z.string().min(1).max(80),
  recipeId: z.number().int().positive().optional(),
}).strict();
export type ReplaceCookingPlanItemInput = z.infer<typeof replaceCookingPlanItemSchema>;

export const updateCookingPlanDraftSchema = z.object({
  version: z.number().int().positive(), idempotencyKey: z.string().uuid(), draft: cookingPlanDraftSchema,
}).strict();
export type UpdateCookingPlanDraftInput = z.infer<typeof updateCookingPlanDraftSchema>;
