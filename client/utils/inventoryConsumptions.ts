import { addQuantityValues } from "@dietdigidose/contracts/quantity-decimal";
import type { InventoryConsumptionInput, InventoryConsumptionPreviewResponse } from "@dietdigidose/contracts";

type Deduction = InventoryConsumptionPreviewResponse["items"][number]["deductions"][number];

/** One API write per batch, retaining exact decimal amounts and only request fields. */
export function combineInventoryDeductions(deductions: Deduction[]): InventoryConsumptionInput["items"] {
  const combined = new Map<number, InventoryConsumptionInput["items"][number]>();
  for (const deduction of deductions) {
    const existing = combined.get(deduction.item_id);
    if (existing && existing.version !== deduction.version) throw new Error("库存已变化，请刷新后重试");
    if (!existing || deduction.mode === "all") {
      combined.set(deduction.item_id, deduction.mode === "all"
        ? { item_id: deduction.item_id, version: deduction.version, mode: "all" }
        : { item_id: deduction.item_id, version: deduction.version, mode: "amount",
          amount_value: deduction.amount_value, unit: deduction.unit });
    } else if (existing.mode === "amount") {
      if (existing.unit !== deduction.unit) throw new Error("同一库存批次的单位不一致，请刷新后重试");
      existing.amount_value = addQuantityValues(existing.amount_value!, deduction.amount_value);
    }
  }
  return [...combined.values()];
}
