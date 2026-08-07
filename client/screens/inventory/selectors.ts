import type { InventoryItem, KitchenwareItem, Recipe, StorageLocation } from "./types";
import { daysUntilDateKey } from "@/utils/inventory";

const STORAGE_FILTERS: Record<string, StorageLocation> = {
  冷藏库: "冷藏",
  冷冻库: "冷冻",
  常温库: "常温",
};

export function filterInventoryItems(items: InventoryItem[], category: string) {
  if (category === "全部") return items;
  if (category === "家庭共享") return items.filter((item) => item.scope === "shared");
  const storageFilter = STORAGE_FILTERS[category];
  if (storageFilter) {
    return items.filter((item) => {
      const location = (["冷藏", "冷冻", "常温"].includes(item.storage_location)
        ? item.storage_location
        : "常温") as StorageLocation;
      return location === storageFilter;
    });
  }
  return items.filter((item) => item.category === category);
}

export interface RecipeInventoryAnalysis {
  matchStatus: "full" | "partial" | "low";
  matchedIngredients: Array<{ name: string; amount?: string }>;
  missingIngredients: Array<{ name: string; amount?: string }>;
  expiringIngredients: Array<{ name: string; daysLeft: number }>;
}

export function analyzeRecipeInventoryMatch(
  recipe: Recipe & { ingredients?: Array<{ name: string; amount?: string }> },
  inventoryItems: InventoryItem[]
): RecipeInventoryAnalysis {
  const activeInventory = inventoryItems.filter((i) => i.is_available !== false);

  // Extract recipe ingredient names if available, or fall back to searching title/description
  const recipeIngredientList = Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0
    ? recipe.ingredients
    : [];

  const matchedIngredients: Array<{ name: string; amount?: string }> = [];
  const missingIngredients: Array<{ name: string; amount?: string }> = [];
  const expiringIngredients: Array<{ name: string; daysLeft: number }> = [];

  if (recipeIngredientList.length > 0) {
    for (const req of recipeIngredientList) {
      const reqName = req.name.trim();
      const matchedItem = activeInventory.find(
        (inv) => inv.food_name.includes(reqName) || reqName.includes(inv.food_name)
      );

      if (matchedItem) {
        matchedIngredients.push({ name: reqName, amount: req.amount });
        const daysLeft = daysUntilDateKey(matchedItem.expiration_date);
        if (daysLeft !== null && daysLeft <= 3) {
          expiringIngredients.push({ name: matchedItem.food_name, daysLeft });
        }
      } else {
        missingIngredients.push({ name: reqName, amount: req.amount });
      }
    }
  } else {
    // Legacy fallback for recipes without detailed ingredient array
    for (const inv of activeInventory) {
      const invName = inv.food_name.trim();
      if (invName && (recipe.title.includes(invName) || recipe.description?.includes(invName))) {
        matchedIngredients.push({ name: invName, amount: inv.quantity });
        const daysLeft = daysUntilDateKey(inv.expiration_date);
        if (daysLeft !== null && daysLeft <= 3) {
          expiringIngredients.push({ name: invName, daysLeft });
        }
      }
    }
  }

  const missingCount = missingIngredients.length;
  const matchStatus: "full" | "partial" | "low" =
    recipeIngredientList.length > 0
      ? (missingCount === 0 ? "full" : missingCount <= 2 ? "partial" : "low")
      : (matchedIngredients.length > 0 ? "full" : "low");

  return {
    matchStatus,
    matchedIngredients,
    missingIngredients,
    expiringIngredients,
  };
}

export function filterAndRankRecipes(
  recipes: Recipe[],
  inventoryItems: InventoryItem[],
  category: string,
  searchQuery: string,
  cookTimeLimit: number = 0,
  matchStatusFilter: string = "全部"
) {
  const inventoryFoodNames = inventoryItems
    .filter((i) => i.is_available !== false)
    .map((item) => item.food_name.trim())
    .filter(Boolean);

  return recipes
    .map((recipe) => {
      const analysis = analyzeRecipeInventoryMatch(recipe, inventoryItems);
      const inventoryMatchCount = inventoryFoodNames.reduce(
        (score, name) => recipe.title.includes(name) || recipe.description?.includes(name) ? score + 1 : score,
        0
      );

      // Score for ranking: expiring matches count * 100 + matched count * 10 - missing count * 5
      const score = (analysis.expiringIngredients.length * 100) +
        (analysis.matchedIngredients.length * 10) +
        (inventoryMatchCount * 5) -
        (analysis.missingIngredients.length * 2);

      return {
        recipe,
        analysis,
        score,
      };
    })
    .filter(({ recipe, analysis }) => {
      // 1. Cook time limit filter
      if (cookTimeLimit > 0 && recipe.cook_time > cookTimeLimit) return false;

      // 2. Search query match
      const searchMatch = !searchQuery ||
        recipe.title.includes(searchQuery) ||
        recipe.description?.includes(searchQuery);
      if (!searchMatch) return false;

      // 3. Match status filter
      if (matchStatusFilter === "完全可做" && analysis.matchStatus !== "full") return false;
      if (matchStatusFilter === "缺1-2样" && (analysis.missingIngredients.length < 1 || analysis.missingIngredients.length > 2)) return false;
      if (matchStatusFilter === "优先临期" && analysis.expiringIngredients.length === 0) return false;

      // 4. Category filter
      const categoryMatch = category === "全部" ||
        (category === "冰箱可做" && (analysis.matchStatus === "full" || analysis.matchedIngredients.length > 0)) ||
        recipe.category === category;

      return categoryMatch;
    })
    .sort((left, right) => right.score - left.score)
    .map(({ recipe }) => recipe);
}

export function recipeMatchesInventory(recipe: Recipe, inventoryItems: InventoryItem[]) {
  return inventoryItems
    .filter((i) => i.is_available !== false)
    .map((item) => item.food_name.trim())
    .filter(Boolean)
    .some((name) => recipe.title.includes(name) || recipe.description?.includes(name));
}

export function filterKitchenware(items: KitchenwareItem[], category: string) {
  return category === "全部" ? items : items.filter((item) => item.category === category);
}
