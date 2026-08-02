jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    multiRemove: jest.fn(),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CHAT_SESSIONS_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  getUserStorageKey,
  purgeLegacyUnscopedPrivateStorage,
  storageBelongsToCurrentUser,
} from "./userStorage";

describe("user-scoped private storage", () => {
  const mockMultiRemove = AsyncStorage.multiRemove as jest.Mock;

  beforeEach(() => {
    mockMultiRemove.mockReset();
    mockMultiRemove.mockResolvedValue(undefined);
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
  });

  it("removes legacy device-wide private caches", async () => {
    await purgeLegacyUnscopedPrivateStorage();

    expect(mockMultiRemove).toHaveBeenCalledWith([
      CHAT_SESSIONS_STORAGE_KEY,
      SHOPPING_LIST_STORAGE_KEY,
      INVENTORY_SCAN_JOB_STORAGE_KEY,
    ]);
  });
});
