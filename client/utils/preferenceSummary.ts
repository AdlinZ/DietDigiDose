import type { KitchenPreferences } from "@dietdigidose/contracts";

/** A conservative local parser: unsupported details remain in the editable transcript. */
export function summarizeMealPreferences(text: string): { preferences: KitchenPreferences; labels: string[] } {
  const preferences: KitchenPreferences = {};
  const labels: string[] = [];
  const numbers: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const people = text.match(/(?:我们|共|给)?\s*(\d{1,2}|[一二两三四五六七八九十])\s*个?人/);
  if (people && !/(?:不是|不要|别|不按).{0,4}[\d一二两三四五六七八九十].{0,2}人/.test(text)) {
    const value = numbers[people[1]] ?? Number(people[1]);
    if (value >= 1 && value <= 30) { preferences.servings = value; labels.push(`${value} 人用餐`); }
  }
  const duration = text.match(/(\d{1,3})\s*分钟/);
  const minutes = duration ? Number(duration[1]) : text.includes("半小时") ? 30 : null;
  if (minutes !== null && minutes >= 5 && minutes <= 300) { preferences.meal_time_minutes = minutes; labels.push(`做饭时间 ${minutes} 分钟`); }
  if (/不吃辣|不要辣|不能吃辣/.test(text) && !/(?:不是|没有说|没说).{0,4}(?:不吃辣|不要辣|不能吃辣)/.test(text)) {
    preferences.avoid_spicy = true; labels.push("不吃辣");
  }
  return { preferences, labels };
}
