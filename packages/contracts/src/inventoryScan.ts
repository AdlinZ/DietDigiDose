import { z } from "zod";
const fieldEvidence = z.object({
  status: z.enum(["known", "estimated", "unknown"]),
  source: z.enum(["user", "recognition", "barcode", "rule", "unknown"]),
  note: z.string().trim().max(200).optional(),
}).strict();
export const inventoryFieldEvidenceSchema = z.object({
  food_name: fieldEvidence.optional(), quantity: fieldEvidence.optional(),
  storage_location: fieldEvidence.optional(), expiration_date: fieldEvidence.optional(),
}).strict();
export type InventoryFieldEvidence = z.infer<typeof inventoryFieldEvidenceSchema>;
export { normalizeInventoryScanItems } from "./scanNormalization.ts";
