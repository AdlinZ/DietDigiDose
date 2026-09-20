import { summarizeMealPreferences } from "./preferenceSummary";

test("extracts only supported meal details for review", () => {
  expect(summarizeMealPreferences("我们两个人，20分钟，不吃辣，花生过敏").preferences).toEqual({ servings: 2, meal_time_minutes: 20, avoid_spicy: true });
});
test("does not infer missing personal data or negate a denial", () => {
  expect(summarizeMealPreferences("不知道体重，也没说不吃辣").preferences).toEqual({});
  expect(summarizeMealPreferences("不是两个人").preferences).toEqual({});
});
