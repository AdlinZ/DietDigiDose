jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { addToCookingQueue, moveCookingQueueItem, normalizeCookingQueue } from "./cookingQueue";

describe("cooking queue", () => {
  beforeEach(() => {
    (AsyncStorage.getItem as jest.Mock).mockReset().mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it("normalizes valid recipes and removes duplicates", () => {
    expect(normalizeCookingQueue([
      { recipeId: 12, title: " 番茄炒蛋 ", cookTime: 10, calories: 260, difficulty: "简单", addedAt: 1 },
      { recipeId: 12, title: "重复菜谱" },
      { recipeId: 0, title: "无效菜谱" },
    ])).toEqual([expect.objectContaining({ recipeId: 12, title: "番茄炒蛋", ingredients: [], preparedIngredientNames: [] })]);
  });

  it("does not enqueue the same recipe twice", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([
      { recipeId: 12, title: "番茄炒蛋", imageUrl: null, cookTime: 10, calories: 260, difficulty: "简单", addedAt: 1, ingredients: [], preparedIngredientNames: [] },
    ]));
    const result = await addToCookingQueue(101, {
      recipeId: 12,
      title: "番茄炒蛋",
      imageUrl: null,
      cookTime: 10,
      calories: 260,
      difficulty: "简单",
      addedAt: 2,
      ingredients: [],
      preparedIngredientNames: [],
    });
    expect(result.added).toBe(false);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("normalizes prepared ingredients and persists queue reordering", async () => {
    const queue = [
      { recipeId: 1, title: "第一道", imageUrl: null, cookTime: 10, calories: 100, difficulty: "简单", addedAt: 1, ingredients: [], preparedIngredientNames: [" 葱 ", "葱"] },
      { recipeId: 2, title: "第二道", imageUrl: null, cookTime: 20, calories: 200, difficulty: "简单", addedAt: 2, ingredients: [], preparedIngredientNames: [] },
    ];
    expect(normalizeCookingQueue(queue)[0].preparedIngredientNames).toEqual(["葱"]);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    const items = await moveCookingQueueItem(101, 2, -1);

    expect(items.map((item) => item.recipeId)).toEqual([2, 1]);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining(":user:101"),
      expect.stringContaining('"recipeId":2'),
    );
  });
});
