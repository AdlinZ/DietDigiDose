import { z } from "zod";
const names = z.array(z.string().trim().min(1).max(100)).max(50);
export const householdDiningPreferencesSchema = z.object({
  membershipId: z.number().int().positive(),version: z.number().int().positive(),shared: z.boolean(),
  allergies: names,restrictions: names,
}).strict();
export type HouseholdDiningPreferencesInput = z.infer<typeof householdDiningPreferencesSchema>;
