import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日期无效");
const servings = z.number().finite().min(0.001).max(1000);
const nutrition = z.number().finite().nonnegative().max(1_000_000).nullable().optional();
export const mealProductionSchema = z.object({
  food_name: z.string().trim().min(1).max(120),
  produced_servings: servings,
  eaten_servings: z.number().finite().min(0).max(1000).default(0),
  nutrition_per_serving: z.object({ calories: nutrition, protein: nutrition, carbs: nutrition, fat: nutrition }).strict().default({}),
  planned_date: date.nullable().optional(),
  meal_type: z.string().trim().max(30).default(""),
  eaten_at: date.optional(),
  eaten_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  storage_location: z.enum(["冷藏", "冷冻", "常温"]).nullable().optional(),
  queue_item_id: z.string().uuid().optional(),
  queue_version: z.number().int().positive().optional(),
  plan_item_id: z.string().uuid().optional(),
  plan_version: z.number().int().positive().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.eaten_servings > value.produced_servings) ctx.addIssue({ code: "custom", path: ["eaten_servings"], message: "食用份量不能超过制作份量" });
  if (value.eaten_servings > 0 && value.eaten_servings < 0.001) ctx.addIssue({ code: "custom", path: ["eaten_servings"], message: "食用份量最少 0.001 份" });
  for (const [id, version] of [["queue_item_id", "queue_version"], ["plan_item_id", "plan_version"]] as const) {
    if ((value[id] === undefined) !== (value[version] === undefined)) ctx.addIssue({ code: "custom", path: [version], message: "制作来源和版本必须同时提供" });
  }
});

export const preparedMealEventSchema = z.object({
  idempotency_key: z.string().trim().min(16).max(200),
  version: z.number().int().positive(),
  type: z.enum(["eat", "discard", "reschedule"]),
  servings: servings.optional(),
  recorded_at: date.optional(),
  recorded_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  planned_date: date.nullable().optional(),
  is_reserved: z.boolean().optional(),
  meal_type: z.string().trim().max(30).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.type !== "reschedule" && value.servings === undefined) ctx.addIssue({ code: "custom", path: ["servings"], message: "请填写实际食用或丢弃的份量" });
  if (value.type === "reschedule" && (value.servings !== undefined || (value.planned_date === undefined && value.is_reserved === undefined))) ctx.addIssue({ code: "custom", path: ["planned_date"], message: "延期只修改计划日期，不改变剩余份量" });
  if (value.type !== "reschedule" && value.is_reserved !== undefined) ctx.addIssue({ code: "custom", path: ["is_reserved"], message: "保留状态只能通过计划调整修改" });
  if (value.type !== "reschedule" && value.planned_date !== undefined) ctx.addIssue({ code: "custom", path: ["planned_date"], message: "请用延期操作修改计划日期" });
});
export type MealProduction = z.infer<typeof mealProductionSchema>;
export type PreparedMealEventInput = z.infer<typeof preparedMealEventSchema>;
export type PreparedMeal = {
  is_reserved: boolean;
  id: string; food_name: string; recipe_id: number | null; produced_servings: number; remaining_servings: number;
  nutrition_per_serving: { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null };
  planned_date: string | null; meal_type: string; storage_location: string | null;
  produced_at: string; version: number; queue_item_id: string | null; plan_item_id: string | null;
};
