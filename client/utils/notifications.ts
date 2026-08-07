import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { daysUntilDateKey } from "./inventory";

export type NotificationPreferences = {
  expiring_alert: boolean;
  meal_reminder: boolean;
  water_reminder: boolean;
};

const SCHEDULE_IDS_KEY = "@notification_schedule_ids";
const EXPIRING_STOCK_ALERT_IDS_KEY = "@expiring_stock_alert_ids";

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

export async function scheduleExpiringStockAlerts(
  inventoryItems: Array<{ food_name: string; expiration_date: string; is_available: boolean }>,
  enabled: boolean = true
) {
  if (Platform.OS === "web" || !enabled) return;
  const saved = await AsyncStorage.getItem(EXPIRING_STOCK_ALERT_IDS_KEY);
  const previousIds: string[] = saved ? JSON.parse(saved) : [];
  await Promise.all(previousIds.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  await AsyncStorage.removeItem(EXPIRING_STOCK_ALERT_IDS_KEY);

  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;

  const urgentItems = inventoryItems.filter((item) => {
    if (!item.is_available) return false;
    const days = daysUntilDateKey(item.expiration_date);
    return days !== null && days >= 0 && days <= 2;
  });

  if (urgentItems.length === 0) return;

  const itemNames = urgentItems.slice(0, 3).map((i) => i.food_name).join("、");
  const title = "冰箱临期食用提醒";
  const body = `你有【${itemNames}】等 ${urgentItems.length} 种食材将在 1-2 天内到期，建议今天优先烹饪！`;

  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default" },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 9, minute: 0 },
  });
  await AsyncStorage.setItem(EXPIRING_STOCK_ALERT_IDS_KEY, JSON.stringify([id]));
}

export async function sendImmediateTestNotification(
  title: string = "食光烙记通知测试",
  body: string = "你的本地临期提醒配置正常！"
) {
  if (Platform.OS === "web") return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") {
    const request = await Notifications.requestPermissionsAsync();
    if (request.status !== "granted") return;
  }

  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default" },
    trigger: null,
  });
}
