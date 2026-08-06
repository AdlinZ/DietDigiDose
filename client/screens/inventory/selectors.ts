import type { InventoryItem, KitchenwareItem, Recipe, StorageLocation } from "./types";

const STORAGE_FILTERS: Record<string, StorageLocation> = {
  冷藏库: "冷藏",
  冷冻库: "冷冻",
  常温库: "常温",
};

export function filterInventoryItems(items: InventoryItem[], category: string) {
  if (category === "全部") return items;
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

export function filterAndRankRecipes(
  recipes: Recipe[],
  inventoryItems: InventoryItem[],
  category: string,
  searchQuery: string,
) {
  const inventoryFoodNames = inventoryItems.map((item) => item.food_name.trim()).filter(Boolean);
  const matchCount = (recipe: Recipe) => inventoryFoodNames.reduce(
    (score, name) => recipe.title.includes(name) || recipe.description?.includes(name) ? score + 1 : score,
    0,
  );

  return recipes
    .filter((recipe) => {
      const inventoryMatch = matchCount(recipe) > 0;
      const categoryMatch = category === "全部" || (category === "冰箱可做" && inventoryMatch) || recipe.category === category;
      const searchMatch = !searchQuery || recipe.title.includes(searchQuery) || recipe.description?.includes(searchQuery);
      return categoryMatch && searchMatch;
    })
    .sort((left, right) => matchCount(right) - matchCount(left));
}

export function recipeMatchesInventory(recipe: Recipe, inventoryItems: InventoryItem[]) {
  return inventoryItems
    .map((item) => item.food_name.trim())
    .filter(Boolean)
    .some((name) => recipe.title.includes(name) || recipe.description?.includes(name));
}

export function filterKitchenware(items: KitchenwareItem[], category: string) {
  return category === "全部" ? items : items.filter((item) => item.category === category);
}
