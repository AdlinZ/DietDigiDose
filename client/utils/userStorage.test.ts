jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(),
    multiGet: jest.fn(),
    multiRemove: jest.fn(),
  },
}));

jest.mock("expo-file-system", () => ({
  Paths: { cache: { size: 4096 } },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AI_DATA_CONSENT_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  getUserStorageKey,
  getClearableCacheSize,
  getTotalClearableCacheSize,
  purgeClearableCache,
  purgeLegacyUnscopedPrivateStorage,
  purgeUserPrivateStorage,
  storageBelongsToCurrentUser,
} from "./userStorage";

describe("user-scoped private storage", () => {
  const mockMultiRemove = AsyncStorage.multiRemove as jest.Mock;
  const mockGetAllKeys = AsyncStorage.getAllKeys as jest.Mock;
  const mockMultiGet = AsyncStorage.multiGet as jest.Mock;

  beforeEach(() => {
    mockMultiRemove.mockReset();
    mockMultiRemove.mockResolvedValue(undefined);
    mockGetAllKeys.mockReset();
    mockMultiGet.mockReset();
  });

  it("includes shared offline recipe data in visible cache size and clearing", async () => {
    mockGetAllKeys.mockResolvedValue([
      "offline_cache_recipes",
      "@shiyu_ai_chat_sessions:user:101",
      "@shiyu_ai_chat_sessions:user:202",
      "unrelated_preference",
    ]);
    mockMultiGet.mockResolvedValue([
      ["offline_cache_recipes", "recipes"],
      ["@shiyu_ai_chat_sessions:user:101", "chat"],
    ]);

    const size = await getClearableCacheSize(101);
    expect(size).toBeGreaterThan(0);
    await purgeClearableCache(101);
    expect(mockMultiRemove).toHaveBeenCalledWith([
      "offline_cache_recipes",
      "@shiyu_ai_chat_sessions:user:101",
    ]);
  });

  it("includes the native file cache in the displayed total", async () => {
    mockGetAllKeys.mockResolvedValue([]);
    expect(await getTotalClearableCacheSize(101)).toBe(4096);
  });

  it("uses different storage keys for different users", () => {
    const firstUserKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, 101);
    const secondUserKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, 202);

    expect(firstUserKey).toBe("@shiyu_ai_chat_sessions:user:101");
    expect(secondUserKey).toBe("@shiyu_ai_chat_sessions:user:202");
    expect(firstUserKey).not.toBe(secondUserKey);
    expect(getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, null)).toBeNull();
    expect(storageBelongsToCurrentUser(secondUserKey, firstUserKey)).toBe(false);
    expect(storageBelongsToCurrentUser(secondUserKey, secondUserKey)).toBe(true);
    expect(getUserStorageKey(AI_DATA_CONSENT_STORAGE_KEY, 101)).toBe("@ai_data_consent_v1:user:101");
  });

  it("removes legacy device-wide private caches", async () => {
    await purgeLegacyUnscopedPrivateStorage();

    expect(mockMultiRemove).toHaveBeenCalledWith([
      CHAT_SESSIONS_STORAGE_KEY,
      SHOPPING_LIST_STORAGE_KEY,
      INVENTORY_SCAN_JOB_STORAGE_KEY,
    ]);
  });

  it("removes all private caches for the logged-out user", async () => {
    mockGetAllKeys.mockResolvedValue([
      "offline_cache_inventory:user:101",
      "@shiyu_shopping_list:user:101",
      "offline_cache_inventory:user:202",
    ]);

    await purgeUserPrivateStorage(101);

    expect(mockMultiRemove).toHaveBeenCalledWith([
      "offline_cache_inventory:user:101",
      "@shiyu_shopping_list:user:101",
    ]);
  });
});
