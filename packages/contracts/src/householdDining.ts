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
