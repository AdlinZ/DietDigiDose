import AsyncStorage from "@react-native-async-storage/async-storage";

import { getUserStorageKey } from "./userStorage";

export const COOKING_QUEUE_STORAGE_KEY = "@dietdigidose:cooking_queue";
const COOKING_QUEUE_MIGRATION_KEY = "@dietdigidose:cooking_queue_server_migrated";
const MAX_QUEUE_ITEMS = 30;

export type CookingQueueItem = {
  recipeId: number;
  title: string;
  imageUrl: string | null;
  cookTime: number;
  calories: number;
  difficulty: string;
  addedAt: number;
  ingredients: Array<{ name: string; amount: string }>;
  reminderAt?: number;
  reminderNotificationId?: string;
  shoppingListSyncedAt?: number;
  preparedIngredientNames: string[];
};

export function normalizeCookingQueue(value: unknown): CookingQueueItem[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<number>();
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const recipeId = Number(item.recipeId);
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!Number.isInteger(recipeId) || recipeId <= 0 || !title || seen.has(recipeId)) return [];
    seen.add(recipeId);
    return [{
      recipeId,
      title,
      imageUrl: typeof item.imageUrl === "string" && item.imageUrl.trim() ? item.imageUrl : null,
      cookTime: Math.max(0, Number(item.cookTime) || 0),
      calories: Math.max(0, Number(item.calories) || 0),
      difficulty: typeof item.difficulty === "string" && item.difficulty.trim() ? item.difficulty.trim() : "难度未知",
      addedAt: Number.isFinite(Number(item.addedAt)) ? Number(item.addedAt) : Date.now(),
      ingredients: Array.isArray(item.ingredients)
        ? item.ingredients.flatMap((rawIngredient) => {
          if (!rawIngredient || typeof rawIngredient !== "object") return [];
          const ingredient = rawIngredient as Record<string, unknown>;
          const name = typeof ingredient.name === "string" ? ingredient.name.trim() : "";
          if (!name) return [];
          return [{
            name,
            amount: typeof ingredient.amount === "string" && ingredient.amount.trim()
              ? ingredient.amount.trim()
              : "适量",
          }];
        })
        : [],
      reminderAt: Number.isFinite(Number(item.reminderAt)) && Number(item.reminderAt) > 0
        ? Number(item.reminderAt)
        : undefined,
      reminderNotificationId: typeof item.reminderNotificationId === "string" && item.reminderNotificationId
        ? item.reminderNotificationId
        : undefined,
      shoppingListSyncedAt: Number.isFinite(Number(item.shoppingListSyncedAt)) && Number(item.shoppingListSyncedAt) > 0
        ? Number(item.shoppingListSyncedAt)
        : undefined,
      preparedIngredientNames: Array.isArray(item.preparedIngredientNames)
        ? [...new Set(item.preparedIngredientNames
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean))]
        : [],
    }];
  }).slice(0, MAX_QUEUE_ITEMS);
}

function queueStorageKey(userId?: number | null) {
  return getUserStorageKey(COOKING_QUEUE_STORAGE_KEY, userId);
}

function queueMigrationKey(userId?: number | null) {
  return getUserStorageKey(COOKING_QUEUE_MIGRATION_KEY, userId);
}

export async function needsCookingQueueServerMigration(userId?: number | null) {
  const key = queueMigrationKey(userId);
  return key ? (await AsyncStorage.getItem(key)) !== "1" : false;
}

export async function markCookingQueueServerMigrated(userId?: number | null) {
  const key = queueMigrationKey(userId);
  if (key) await AsyncStorage.setItem(key, "1");
}

export async function getCookingQueue(userId?: number | null) {
  const storageKey = queueStorageKey(userId);
  if (!storageKey) return [];
  const saved = await AsyncStorage.getItem(storageKey);
  if (!saved) return [];
  try {
    return normalizeCookingQueue(JSON.parse(saved));
  } catch {
    return [];
  }
}

export async function addToCookingQueue(userId: number, item: CookingQueueItem) {
  const storageKey = queueStorageKey(userId);
  if (!storageKey) throw new Error("登录后才能使用烹饪队列");
  const current = await getCookingQueue(userId);
  if (current.some((queuedItem) => queuedItem.recipeId === item.recipeId)) {
    return { items: current, added: false };
  }
  const items = [...current, item].slice(-MAX_QUEUE_ITEMS);
  await AsyncStorage.setItem(storageKey, JSON.stringify(items));
  return { items, added: true };
}

export async function saveCookingQueue(userId: number, items: CookingQueueItem[]) {
  const storageKey = queueStorageKey(userId);
  if (!storageKey) return [];
  const normalized = normalizeCookingQueue(items);
  await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

export async function updateCookingQueueItem(
  userId: number,
  recipeId: number,
  updates: Partial<Omit<CookingQueueItem, "recipeId">>,
) {
  const current = await getCookingQueue(userId);
  return saveCookingQueue(userId, current.map((item) => (
    item.recipeId === recipeId ? { ...item, ...updates } : item
  )));
}

export async function moveCookingQueueItem(userId: number, recipeId: number, offset: -1 | 1) {
  const current = await getCookingQueue(userId);
  const currentIndex = current.findIndex((item) => item.recipeId === recipeId);
  const targetIndex = currentIndex + offset;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
  const items = [...current];
  [items[currentIndex], items[targetIndex]] = [items[targetIndex], items[currentIndex]];
  return saveCookingQueue(userId, items);
}

export async function removeFromCookingQueue(userId: number, recipeId: number) {
  const storageKey = queueStorageKey(userId);
  if (!storageKey) return [];
  const items = (await getCookingQueue(userId)).filter((item) => item.recipeId !== recipeId);
  await AsyncStorage.setItem(storageKey, JSON.stringify(items));
  return items;
}

export async function clearCookingQueue(userId: number) {
  const storageKey = queueStorageKey(userId);
  if (storageKey) await AsyncStorage.removeItem(storageKey);
}
