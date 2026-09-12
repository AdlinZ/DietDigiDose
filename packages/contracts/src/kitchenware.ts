import { z } from "zod";
/** Omitted/null means unverified, never an inferred device specification. */
export const kitchenwareAttributesSchema = z.object({
  capacityMl: z.number().finite().positive().max(1_000_000).nullable().optional(),
  diameterCm: z.number().finite().positive().max(1_000).nullable().optional(),
  heatSources: z.array(z.enum(["gas","induction","electric"])).max(3)
    .refine(values => new Set(values).size === values.length,"热源不能重复").nullable().optional(),
}).strict();
export type KitchenwareAttributes = z.infer<typeof kitchenwareAttributesSchema>;

/** Conditions on a catalog capability. All conditions apply to one owned device. */
export const kitchenwareCapabilityConstraintsSchema = z.object({
  minCapacityMl: z.number().finite().positive().max(1_000_000).optional(),
  minDiameterCm: z.number().finite().positive().max(1_000).optional(),
  heatSource: z.enum(["gas", "induction", "electric"]).optional(),
}).strict();
export type KitchenwareCapabilityConstraints = z.infer<typeof kitchenwareCapabilityConstraintsSchema>;
