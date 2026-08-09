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
  breakfast_time: string;
  lunch_time: string;
  dinner_time: string;
  water_start_time: string;
  water_end_time: string;
  water_interval_minutes: number;
  quiet_start_time: string;
  quiet_end_time: string;
  weekdays_enabled: boolean;
  weekends_enabled: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  expiring_alert: true,
  meal_reminder: true,
  water_reminder: true,
  breakfast_time: "08:00",
  lunch_time: "12:00",
  dinner_time: "18:00",
  water_start_time: "10:00",
  water_end_time: "18:00",
  water_interval_minutes: 120,
  quiet_start_time: "22:00",
  quiet_end_time: "07:00",
  weekdays_enabled: true,
  weekends_enabled: true,
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
  await Notifications.setNotificationCategoryAsync("inventory-expiring", [
    { identifier: "PLAN_RECIPE", buttonTitle: "安排食谱" },
    { identifier: "COMPLETE", buttonTitle: "已处理", options: { opensAppToForeground: false } },
  ]);
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

function timeParts(value: string) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return { hour, minute, total: hour * 60 + minute };
}

function isQuietTime(total: number, preferences: NotificationPreferences) {
  const start = timeParts(preferences.quiet_start_time).total;
  const end = timeParts(preferences.quiet_end_time).total;
  if (start === end) return false;
  return start < end ? total >= start && total < end : total >= start || total < end;
}

function enabledWeekdays(preferences: NotificationPreferences) {
  const days: number[] = [];
  if (preferences.weekdays_enabled) days.push(2, 3, 4, 5, 6);
  if (preferences.weekends_enabled) days.push(1, 7);
  return days;
}

async function scheduleWeekly(
  title: string,
  body: string,
  time: string,
  weekdays: number[],
  data: Record<string, string>,
) {
  const { hour, minute } = timeParts(time);
  return Promise.all(weekdays.map((weekday) => Notifications.scheduleNotificationAsync({
    content: { title, body, sound: "default", data: { ...data, sourceId: `${data.kind}:${weekday}:${time}` } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, repeats: true, weekday, hour, minute },
  })));
}

function minutesToTime(total: number) {
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
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
  const weekdays = enabledWeekdays(preferences);
  if (preferences.meal_reminder) {
    const meals = [
      ["早餐打卡提醒", "记下早餐，让今天的营养规划有个好开始。", preferences.breakfast_time, "breakfast"],
      ["午餐打卡提醒", "记下这一餐，食光会继续为你安排接下来的饮食。", preferences.lunch_time, "lunch"],
      ["晚餐打卡提醒", "晚餐后花一分钟记录，让今日营养更完整。", preferences.dinner_time, "dinner"],
    ] as const;
    for (const [title, body, time, meal] of meals) {
      if (!isQuietTime(timeParts(time).total, preferences)) {
        ids.push(...await scheduleWeekly(title, body, time, weekdays, { type: "routine_reminder", kind: "meal", meal }));
      }
    }
  }
  if (preferences.water_reminder) {
    const start = timeParts(preferences.water_start_time).total;
    const end = timeParts(preferences.water_end_time).total;
    for (let total = start; total <= end; total += preferences.water_interval_minutes) {
      if (!isQuietTime(total, preferences)) {
        const time = minutesToTime(total);
        ids.push(...await scheduleWeekly("补充一杯水", "该补充约 250ml 水分了。", time, weekdays, { type: "routine_reminder", kind: "water" }));
      }
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
