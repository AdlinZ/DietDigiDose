import AsyncStorage from "@react-native-async-storage/async-storage";

export const CHAT_SESSIONS_STORAGE_KEY = "@shiyu_ai_chat_sessions";
export const SHOPPING_LIST_STORAGE_KEY = "@shiyu_shopping_list";
export const INVENTORY_SCAN_JOB_STORAGE_KEY = "@inventory_scan_job";

const LEGACY_UNSCOPED_PRIVATE_KEYS = [
  CHAT_SESSIONS_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
];

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
