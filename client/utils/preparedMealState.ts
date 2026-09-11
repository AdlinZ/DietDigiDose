import type { PreparedMeal } from "@dietdigidose/contracts";

/** Completed meals remain as versioned tombstones so an old replay cannot revive them. */
export function mergePreparedMeals(current: PreparedMeal[], incoming: PreparedMeal[]): PreparedMeal[] {
  const meals = new Map(current.map(meal => [meal.id, meal]));
  for (const meal of incoming) {
    const previous = meals.get(meal.id);
    if (!previous || meal.version > previous.version) meals.set(meal.id, meal);
  }
  return [...meals.values()];
}
