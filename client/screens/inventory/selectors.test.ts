import { filterAndRankRecipes, filterInventoryItems, filterKitchenware } from "./selectors";
import type { InventoryItem, KitchenwareItem, Recipe } from "./types";

const inventory = [
  { id: 1, food_name: "番茄", category: "蔬菜", storage_location: "冷藏", quantity: "2个", expiration_date: "2030-01-01", image_url: null, is_available: true },
  { id: 2, food_name: "鸡蛋", category: "乳制品", storage_location: "未知", quantity: "6个", expiration_date: "2030-01-02", image_url: null, is_available: true },
] satisfies InventoryItem[];

const recipes = [
  { id: 1, title: "清炒时蔬", description: "简单", image_url: "", cook_time: 10, difficulty: "简单", calories: 100, protein: 2, carbs: 10, fat: 2, category: "快手菜", tags: [] },
  { id: 2, title: "番茄炒鸡蛋", description: "番茄与鸡蛋", image_url: "", cook_time: 12, difficulty: "简单", calories: 220, protein: 12, carbs: 15, fat: 8, category: "快手菜", tags: [] },
] satisfies Recipe[];

test("filters inventory by storage and treats unknown locations as room temperature", () => {
  expect(filterInventoryItems(inventory, "冷藏库").map((item) => item.id)).toEqual([1]);
  expect(filterInventoryItems(inventory, "常温库").map((item) => item.id)).toEqual([2]);
});

test("ranks recipes by the number of matching inventory foods", () => {
  expect(filterAndRankRecipes(recipes, inventory, "全部", "").map((recipe) => recipe.id)).toEqual([2, 1]);
  expect(filterAndRankRecipes(recipes, inventory, "冰箱可做", "").map((recipe) => recipe.id)).toEqual([2]);
});

test("filters kitchenware by category", () => {
  const items = [{ id: 1, name: "炒锅", category: "锅具", status: "良好", image_url: null }] satisfies KitchenwareItem[];
  expect(filterKitchenware(items, "锅具")).toEqual(items);
  expect(filterKitchenware(items, "刀具")).toEqual([]);
});
