import type { HouseholdMealProductionInput } from "@dietdigidose/contracts";
import { calculateInventoryConsumption, InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { recipeDemands } from "../recommendations/quantities.js";
import { HouseholdsError } from "./errors.js";
import type { Row } from "./types.js";
export function productionRequest(input: HouseholdMealProductionInput) {
  return { idempotencyKey: input.idempotencyKey,membershipId: input.membershipId,foodName: input.foodName,producedServings: input.producedServings,inventory: [...input.inventory].sort((a,b) => a.itemId-b.itemId).map(item => ({ itemId: item.itemId,version: item.version,amount: item.amount,unit: item.unit })) };
}
export function productionResult(row: Row, repeated: boolean) {
  return { id: String(row.id),householdId: Number(row.household_id),foodName: String(row.food_name),
    producedServings: Number(row.produced_servings),remainingServings: Number(row.remaining_servings),version: Number(row.version),repeated };
}
export function repeatProduction(row: Row,userId: number,input: HouseholdMealProductionInput) {
  const request = typeof row.request_json === "string" ? JSON.parse(row.request_json) : row.request_json;
  if (Number(row.created_by_user_id) !== userId || Number(row.membership_id) !== input.membershipId || JSON.stringify(productionRequest(request)) !== JSON.stringify(productionRequest(input)))
    throw new HouseholdsError(409,"制作编号已用于另一项记录，请重新核对","PRODUCTION_KEY_CONFLICT");
  return productionResult(row,true);
}
export function consumeProductionItem(row: Row, input: HouseholdMealProductionInput["inventory"][number]) {
  const measured = recipeDemands([{ name: String(row.food_name),amount: String(row.quantity).trim() }],1,1)?.[0];
  try {
    const next = calculateInventoryConsumption({ ...row,id: row.id,food_name: row.food_name,quantity: row.quantity,is_available: row.is_available,version: row.version,
      quantity_value: measured?.amount_value ?? null,quantity_unit: measured?.unit ?? null },
    { item_id: input.itemId,version: input.version,mode: "amount",amount_value: input.amount,unit: input.unit });
    if (Number(next.amountUsed) > Number(next.storedValue) || Math.abs(Number(next.storedValue) - Number(next.amountUsed) - next.remaining) > 1e-9) throw new HouseholdsError(409,"库存数量不足或扣减超出计量精度，请核对后重试","QUANTITY_PRECISION_REQUIRED");
    if (!Number.isFinite(next.remaining) || next.remaining >= Number(next.storedValue)) throw new HouseholdsError(409,"扣减量小于当前库存计量精度，请调整数量单位后重试","QUANTITY_PRECISION_REQUIRED");
    return next;
  } catch (error) {
    if (error instanceof InventoryQuantityError) throw new HouseholdsError(409,error.message,error.code);
    throw error;
  }
}
