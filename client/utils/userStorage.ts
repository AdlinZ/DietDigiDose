import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paths } from "expo-file-system";

export const CHAT_SESSIONS_STORAGE_KEY = "@shiyu_ai_chat_sessions";
export const SHOPPING_LIST_STORAGE_KEY = "@shiyu_shopping_list";
export const INVENTORY_SCAN_JOB_STORAGE_KEY = "@inventory_scan_job";
export const AI_DATA_CONSENT_STORAGE_KEY = "@ai_data_consent_v1";
export const SEARCH_HISTORY_STORAGE_KEY = "@dietdigidose:global-search-history";

const LEGACY_UNSCOPED_PRIVATE_KEYS = [
  CHAT_SESSIONS_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SEARCH_HISTORY_STORAGE_KEY,
];
const CLEARABLE_CACHE_PREFIXES = ["offline_cache_"];

export function getUserStorageKey(baseKey: string, userId?: number | null) {
  if (!Number.isInteger(userId) || Number(userId) <= 0) return null;
  return `${baseKey}:user:${userId}`;
}

export function storageBelongsToCurrentUser(
  currentUserStorageKey: string | null,
  loadedStorageKey: string | null,
) {
  return Boolean(currentUserStorageKey && currentUserStorageKey === loadedStorageKey);
}

/**
 * Older builds stored private data under device-wide keys. Those records cannot
 * be attributed to a user safely, so they must not be migrated into any account.
 */
export async function purgeLegacyUnscopedPrivateStorage() {
  await AsyncStorage.multiRemove(LEGACY_UNSCOPED_PRIVATE_KEYS);
}

export async function purgeUserPrivateStorage(userId?: number | null) {
  if (!Number.isInteger(userId) || Number(userId) <= 0) return;
  const suffix = `:user:${userId}`;
  const keys = await AsyncStorage.getAllKeys();
  const userKeys = keys.filter((key) => key.endsWith(suffix));
  if (userKeys.length) await AsyncStorage.multiRemove(userKeys);
}

export async function getUserPrivateStorageSize(userId?: number | null) {
  if (!Number.isInteger(userId) || Number(userId) <= 0) return 0;
  const suffix = `:user:${userId}`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.endsWith(suffix));
  if (!keys.length) return 0;
  const entries = await AsyncStorage.multiGet(keys);
  return entries.reduce((total, [key, value]) => total + key.length + (value?.length || 0), 0) * 2;
}

export function isClearableCacheKey(key: string, userId?: number | null) {
  if (!CLEARABLE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  const userScopeIndex = key.lastIndexOf(":user:");
  if (userScopeIndex < 0) return true;
  return Number.isInteger(userId) && Number(userId) > 0 && key.endsWith(`:user:${userId}`);
}

const getClearableCacheKeys = async (userId?: number | null) => {
  return (await AsyncStorage.getAllKeys()).filter((key) => isClearableCacheKey(key, userId));
};

export async function purgeClearableCache(userId?: number | null) {
  const keys = await getClearableCacheKeys(userId);
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

export async function getClearableCacheSize(userId?: number | null) {
  const keys = await getClearableCacheKeys(userId);
  if (!keys.length) return 0;
  const entries = await AsyncStorage.multiGet(keys);
  return entries.reduce((total, [key, value]) => total + key.length + (value?.length || 0), 0) * 2;
}

export function getNativeFileCacheSize() {
  try {
    return Math.max(0, Number(Paths.cache.size) || 0);
  } catch {
    return 0;
  }
}

export async function getTotalClearableCacheSize(userId?: number | null) {
  return (await getClearableCacheSize(userId)) + getNativeFileCacheSize();
}

export function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
