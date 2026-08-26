const mockStorage = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      mockStorage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockStorage.delete(key);
      return Promise.resolve();
    }),
  },
}));

jest.mock("expo-constants", () => ({ expoConfig: null, easConfig: null }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { CALENDAR: "calendar", DATE: "date", DAILY: "daily" },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("scheduled-id")),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("./inventory", () => ({ daysUntilDateKey: jest.fn(() => 1) }));
jest.mock("./cookingReminders", () => ({
  cancelCookingQueueRemindersForUser: jest.fn(() => Promise.resolve()),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { cancelCookingQueueRemindersForUser } from "./cookingReminders";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  EXPIRING_STOCK_ALERT_IDS_KEY,
  NOTIFICATION_SCHEDULE_IDS_KEY,
  cancelAllLocalNotificationsForUser,
  getNextExpiringAlertDate,
  scheduleExpiringStockAlerts,
  syncLocalNotificationSchedules,
} from "./notifications";
import { getUserStorageKey } from "./userStorage";

describe("user-scoped local notifications", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  it("stores routine schedule ids under the current account only", async () => {
    const preferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      meal_reminder: false,
      water_reminder: false,
    };

    await syncLocalNotificationSchedules(preferences, 101);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101),
      "[]",
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 202),
      expect.anything(),
    );
  });

  it("cancels an account's previous expiring alert when the preference is off", async () => {
    const key = getUserStorageKey(EXPIRING_STOCK_ALERT_IDS_KEY, 101)!;
    mockStorage.set(key, JSON.stringify(["old-alert"]));

    await scheduleExpiringStockAlerts([], 101, false);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("old-alert");
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockStorage.has(key)).toBe(false);
  });

  it("uses a one-time dated trigger for expiring inventory", async () => {
    const now = new Date(2026, 7, 26, 8, 30);
    await scheduleExpiringStockAlerts([
      { food_name: "菠菜", expiration_date: "2026-08-27", is_available: true },
    ], 101, true, now);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        categoryIdentifier: "inventory-expiring",
        data: expect.objectContaining({ userId: 101 }),
      }),
      trigger: { type: "date", date: new Date(2026, 7, 26, 9, 0) },
    }));
  });

  it("moves the one-time alert to tomorrow after 09:00", () => {
    expect(getNextExpiringAlertDate(new Date(2026, 7, 26, 9, 1)))
      .toEqual(new Date(2026, 7, 27, 9, 0));
  });

  it("cancels routine, inventory, and cooking reminders before account cleanup", async () => {
    mockStorage.set(getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!, JSON.stringify(["routine"]));
    mockStorage.set(getUserStorageKey(EXPIRING_STOCK_ALERT_IDS_KEY, 101)!, JSON.stringify(["inventory"]));

    await cancelAllLocalNotificationsForUser(101);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("routine");
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("inventory");
    expect(cancelCookingQueueRemindersForUser).toHaveBeenCalledWith(101);
  });
});
