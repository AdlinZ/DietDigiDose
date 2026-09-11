import { z } from "zod";
export const preferenceLearningUpdateSchema = z.discriminatedUnion("kind",[
  z.object({ kind: z.literal("learning"),version: z.number().int().positive(),enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("recipe"),version: z.number().int().positive(),recipeId: z.number().int().positive(),value: z.enum(["neutral","dislike"]) }).strict(),
]);
export type PreferenceLearningUpdate = z.infer<typeof preferenceLearningUpdateSchema>;
export type PreferenceLearningState = {
  version: number; enabled: boolean; ruleVersion: string;
  items: Array<{ recipeId: number; title: string; origin: "explicit" | "inferred"; explanation: string; updatedAt: string; evidence: Array<{ id: string; at: string; reason: string }> }>;
};
