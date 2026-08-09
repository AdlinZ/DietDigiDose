import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { authApi } from "@/services/api";

type NotificationData = {
  type?: string;
  kind?: "meal" | "water";
  sourceId?: string;
  notificationId?: number;
  inventoryItemId?: number;
};

export function NotificationLifecycle() {
  const { token } = useAuth();
  const router = useSafeRouter();

  useEffect(() => {
    if (Platform.OS === "web" || !token) return;

    const recordRoutine = (notification: Notifications.Notification, event: "received" | "opened") => {
      const data = notification.request.content.data as NotificationData;
      if (data.type !== "routine_reminder" || (data.kind !== "meal" && data.kind !== "water")) return;
      void authApi.recordLocalNotificationEvent(token, {
        kind: data.kind,
        title: notification.request.content.title || (data.kind === "meal" ? "用餐提醒" : "饮水提醒"),
        body: notification.request.content.body || "按计划完成今天的健康习惯。",
        event,
        source_id: data.sourceId,
      }).catch(() => undefined);
    };

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const notification = response.notification;
      const data = notification.request.content.data as NotificationData;
      recordRoutine(notification, "opened");
      if (data.type === "expiring_inventory" && typeof data.notificationId === "number") {
        const action = response.actionIdentifier === "COMPLETE"
          ? "complete"
          : response.actionIdentifier === "PLAN_RECIPE" ? "plan_recipe" : "open";
        void authApi.notificationAction(token, data.notificationId, action).catch(() => undefined);
        if (action === "complete") return;
        if (action === "plan_recipe") {
          router.push("/ai-assistant", { prompt: "请用我即将到期的库存食材安排一份今天能完成的餐单。" });
          return;
        }
        router.push("/(tabs)/inventory", { highlightItemId: data.inventoryItemId });
        return;
      }
      if (data.kind === "meal") router.push("/diet-record");
      else router.push("/notifications");
    };

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      recordRoutine(notification, "received");
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleResponse(response);
        void Notifications.clearLastNotificationResponseAsync();
      }
    });
    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, [router, token]);

  return null;
}
