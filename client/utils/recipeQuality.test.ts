import { getRecipeNutritionPresentation } from "./recipeQuality";

test("uses approximate wording and an estimate disclosure for estimated recipes", () => {
  expect(getRecipeNutritionPresentation(true)).toEqual({
    prefix: "约",
    title: "营养估算",
    disclosure: "营养数据为估算值，实际结果会因食材品牌、份量与烹饪方式而变化。",
  });
});

test("keeps trusted source nutrition unqualified", () => {
  expect(getRecipeNutritionPresentation(false)).toEqual({
    prefix: "",
    title: "营养成分",
    disclosure: null,
  });
});
