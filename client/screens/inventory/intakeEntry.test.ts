import { blankIntakeEntry, buildIntake, quantityFields, summarizeInventoryText } from "./intakeEntry";

test("manual inventory keeps absent and approximate quantities unknown", () => {
  expect(quantityFields("")).toEqual({ quantity: "数量未知", quantity_value: null, quantity_unit: null });
  expect(quantityFields("大概 500g").quantity_value).toBeNull();
  expect(quantityFields("500g")).toEqual({ quantity: "500g", quantity_value: 500, quantity_unit: "g" });
  const input = buildIntake([{ ...blankIntakeEntry, foodName: "番茄" }], "stable-intake-request-1");
  expect(input.items[0]).toMatchObject({ quantity: "数量未知", quantity_value: null, quantity_unit: null, expiration_date: "", confirmed: true });
});

test("editable summaries preserve explicit quantities without inventing omitted values", () => {
  const items = summarizeInventoryText("家里有鸡蛋 3 个、番茄、两盒牛奶");
  expect(items.map(item => [item.foodName, item.quantity])).toEqual([["鸡蛋", "3 个"], ["番茄", ""], ["牛奶", "2盒"]]);
  expect(items.every(item => item.expirationDate === "")).toBe(true);
  expect(summarizeInventoryText("鸡蛋十五个")[0].quantity).toBe("");
  expect(summarizeInventoryText("鸡蛋大约3个")[0]).toMatchObject({ foodName: "鸡蛋大约3个", quantity: "" });
});

test("saving an incomplete summary is rejected before any request is sent", () => {
  expect(() => buildIntake([{ ...blankIntakeEntry }], "stable-intake-request-1")).toThrow();
  expect(() => buildIntake([], "stable-intake-request-1")).toThrow();
});
