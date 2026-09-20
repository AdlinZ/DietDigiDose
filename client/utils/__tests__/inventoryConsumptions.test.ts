import { combineInventoryDeductions } from "../inventoryConsumptions";
const deduction = (amount: number, mode: "amount" | "all" = "amount") => ({
  item_id: 1, version: 1, mode, amount_value: amount, unit: "kg" as const,
  food_name: "盐", expiration_date: "", batch_code: null,
});
test("cooking combines decimal deductions without sending response-only fields", () => {
  expect(combineInventoryDeductions([deduction(0.1), deduction(0.2)])).toEqual([
    { item_id: 1, version: 1, mode: "amount", amount_value: 0.3, unit: "kg" },
  ]);
  expect(combineInventoryDeductions([deduction(0.0002)])).toEqual([
    { item_id: 1, version: 1, mode: "amount", amount_value: 0.0002, unit: "kg" },
  ]);
  expect(combineInventoryDeductions([deduction(0.1), deduction(0.2, "all")])).toEqual([
    { item_id: 1, version: 1, mode: "all" },
  ]);
});
test("cooking rejects stale batch versions and unrepresentable sums", () => {
  expect(() => combineInventoryDeductions([deduction(0.1), { ...deduction(0.1), version: 2 }])).toThrow("库存已变化");
  expect(() => combineInventoryDeductions([deduction(1), deduction(1e-20)])).toThrow("计量精度");
});
