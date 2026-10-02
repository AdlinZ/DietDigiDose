import { summarizeMealPreferences } from "./preferenceSummary";

test("extracts only supported meal details for review", () => {
  expect(summarizeMealPreferences("我们两个人，20分钟，不吃辣，花生过敏").preferences).toEqual({ servings: 2, meal_time_minutes: 20, avoid_spicy: true });
});
test("does not infer missing personal data or negate a denial", () => {
  expect(summarizeMealPreferences("不知道体重，也没说不吃辣").preferences).toEqual({});
  expect(summarizeMealPreferences("不是两个人").preferences).toEqual({});
});

test("summarizes explicit regular meals, location and storage conditions", () => {
  const summary = summarizeMealPreferences("以后通常吃午餐和晚餐，在公司吃，需要带饭，有冰箱，可以加热");
  expect(summary.preferences).toEqual({ usual_meals: ["lunch", "dinner"], eating_location: "work", carry_meals: true, refrigeration_available: true, reheating_available: true });
  expect(summary.labels).toEqual(["常用餐次：午饭、晚饭", "用餐地点：公司", "需要带饭", "可以冷藏", "可以加热"]);
});
test("does not turn unavailable storage or reheating into an available facility", () => {
  expect(summarizeMealPreferences("不需要带饭，不能冷藏，没有微波炉").preferences).toEqual({ carry_meals: false, refrigeration_available: false, reheating_available: false });
});
test("leaves questions, examples, unknowns and negated corrections for manual review", () => {
  for (const text of ["不知道能不能冷藏", "能不能加热", "需要带饭？", "有冰箱?", "不确定有没有微波炉", "如果有冰箱", "可以加热吗", "没说需要带饭", "不是20分钟", "比如两个人", "“有冰箱”", "不在公司吃"]) {
    expect(summarizeMealPreferences(text).preferences).toEqual({});
  }
  expect(summarizeMealPreferences("今天做今晚和明天午饭").preferences.usual_meals).toBeUndefined();
});
