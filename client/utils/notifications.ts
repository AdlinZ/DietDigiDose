import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type NotificationPreferences = {
  expiring_alert: boolean;
  meal_reminder: boolean;
  water_reminder: boolean;
};

const SCHEDULE_IDS_KEY = "@notification_schedule_ids";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function getExpoPushToken() {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "默认通知",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
}

async function clearScheduledNotifications() {
  const saved = await AsyncStorage.getItem(SCHEDULE_IDS_KEY);
  const ids: string[] = saved ? JSON.parse(saved) : [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

async function scheduleDaily(title: string, body: string, hour: number) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default" },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute: 0 },
  });
}

/** Keeps on-device meal and hydration reminders aligned with the saved preferences. */
export async function syncLocalNotificationSchedules(preferences: NotificationPreferences) {
  if (Platform.OS === "web" || !Device.isDevice) return;
  await clearScheduledNotifications();
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") {
    await AsyncStorage.removeItem(SCHEDULE_IDS_KEY);
    return;
  }
  const ids: string[] = [];
  if (preferences.meal_reminder) {
    ids.push(await scheduleDaily("该记录一餐啦", "早餐、午餐和晚餐的饮食记录会帮你更好地规划营养。", 8));
    ids.push(await scheduleDaily("午餐打卡提醒", "记下这一餐，食光会继续为你安排接下来的饮食。", 12));
    ids.push(await scheduleDaily("晚餐打卡提醒", "晚餐后花一分钟记录，让今日营养更完整。", 18));
  }
  if (preferences.water_reminder) {
    for (const hour of [10, 12, 14, 16, 18]) {
      ids.push(await scheduleDaily("补充一杯水", "该补充约 250ml 水分了。", hour));
    }
  }
  await AsyncStorage.setItem(SCHEDULE_IDS_KEY, JSON.stringify(ids));
}
