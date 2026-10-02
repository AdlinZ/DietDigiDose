import { formatNutritionSummary, summarizeNutrition } from "./nutritionSummary";

test("nutrition summaries distinguish absent, unknown, partial and zero records", () => {
  expect(summarizeNutrition([])).toEqual({ total: null, incomplete: false });
  expect(summarizeNutrition([null, undefined])).toEqual({ total: null, incomplete: true });
  expect(formatNutritionSummary(summarizeNutrition([null, 120, 80]), " kcal")).toBe("已知 200 kcal");
  expect(formatNutritionSummary(summarizeNutrition([0]), "g")).toBe("0g");
  expect(formatNutritionSummary(summarizeNutrition([null]), "g")).toBe("未知");
});
