import { inventoryUnitSchema } from "./inventory.ts";
import { z } from "zod";
const names = z.array(z.string().trim().min(1).max(100)).max(50);
export const householdDiningPreferencesSchema = z.object({
  membershipId: z.number().int().positive(),version: z.number().int().positive(),shared: z.boolean(),
  allergies: names,restrictions: names,
}).strict();
export type HouseholdDiningPreferencesInput = z.infer<typeof householdDiningPreferencesSchema>;

const diningMemberIdentity = z.object({
  membershipId: z.number().int().positive(), userId: z.number().int().positive(),
  name: z.string(), version: z.number().int().positive(),
});
export const householdDiningMembersSchema = z.object({
  members: z.array(z.discriminatedUnion("shared", [
    diningMemberIdentity.extend({ shared: z.literal(false) }).strict(),
    diningMemberIdentity.extend({ shared: z.literal(true), allergies: names, restrictions: names }).strict(),
  ])),
}).strict();
export type HouseholdDiningMembers = z.infer<typeof householdDiningMembersSchema>;

const diningServings = z.number().finite().min(0.000001).max(30).refine(
  value => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 0.000001,
  "份量最多保留六位小数",
);
export const householdDiningAllocationSchema = z.object({
  recipeId: z.number().int().positive().optional(),
  participants: z.array(z.object({
    membershipId: z.number().int().positive(), version: z.number().int().positive(), servings: diningServings,
  }).strict()).min(1).max(30),
}).strict().superRefine((value,ctx) => {
  if (new Set(value.participants.map(item => item.membershipId)).size !== value.participants.length)
    ctx.addIssue({ code: "custom",path: ["participants"],message: "共餐成员不能重复" });
  if (value.participants.reduce((sum,item) => sum + Math.round(item.servings * 1_000_000),0) > 30_000_000)
    ctx.addIssue({ code: "custom",path: ["participants"],message: "单次共餐总份量不能超过30份" });
});
export type HouseholdDiningAllocationInput = z.infer<typeof householdDiningAllocationSchema>;
export const householdDiningAllocationPreviewSchema = z.object({
  householdId: z.number().int().positive(), totalServings: diningServings,
  recipeCheck: z.object({
    recipeId: z.number().int().positive(), title: z.string(),status: z.enum(["blocked","needs_review"]),
    materials: z.object({
      status: z.enum(["known","unknown"]),recipeYield: z.number().finite().positive().nullable(),
      demands: z.array(z.object({ food_name: z.string(),amount_value: z.number().finite().positive().max(1_000_000_000),unit: inventoryUnitSchema }).strict()),
    }).strict(),
    conflicts: z.array(z.object({ membershipId: z.number().int().positive(),constraint: z.string(),kind: z.enum(["allergy","restriction"]) }).strict()),
    checks: z.array(z.string()),
  }).strict().optional(),
  participants: z.array(diningMemberIdentity.extend({ shared: z.literal(true),allergies: names,restrictions: names,servings: diningServings }).strict()).min(1).max(30),
  allergies: z.array(z.string()).max(1500),restrictions: z.array(z.string()).max(1500),recipeValidationRequired: z.literal(true),
}).strict();
export type HouseholdDiningAllocationPreview = z.infer<typeof householdDiningAllocationPreviewSchema>;

export const householdMealProductionSchema = z.object({
  idempotencyKey: z.string().uuid(), membershipId: z.number().int().positive(),
  foodName: z.string().trim().min(1).max(120), producedServings: diningServings,
  inventory: z.array(z.object({ itemId: z.number().int().positive(),version: z.number().int().positive(),
    amount: z.number().finite().positive().max(1_000_000_000),unit: inventoryUnitSchema,
  }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.inventory.map(item => item.itemId)).size === value.inventory.length,"原料不能重复");
export type HouseholdMealProductionInput = z.infer<typeof householdMealProductionSchema>;
