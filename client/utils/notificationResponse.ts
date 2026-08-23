export type AppNotificationData = {
  type?: string;
  kind?: "meal" | "water";
  sourceId?: string;
  notificationId?: number;
  inventoryItemId?: number;
  recipeId?: number;
  userId?: number;
};

export type ExpiringNotificationAction = "open" | "complete" | "plan_recipe";

export type NotificationDestination =
  | { pathname: "/(tabs)/inventory"; params: { highlightItemId: number } }
  | { pathname: "/ai-assistant"; params: { prompt: string } }
  | { pathname: "/diet-record" }
  | { pathname: "/notifications" }
  | { pathname: "/cooking-queue"; params: { highlightRecipeId: number } }
  | { pathname: "/cooking-mode"; params: { recipeId: number; fromQueue: boolean } }
  | null;

export function getExpiringNotificationAction(actionIdentifier: string): ExpiringNotificationAction {
  if (actionIdentifier === "COMPLETE") return "complete";
  if (actionIdentifier === "PLAN_RECIPE") return "plan_recipe";
  return "open";
}

export function resolveNotificationDestination(
  data: AppNotificationData,
  actionIdentifier: string,
): NotificationDestination {
  if (data.type === "expiring_inventory" && typeof data.notificationId === "number") {
    const action = getExpiringNotificationAction(actionIdentifier);
    if (action === "complete") return null;
    if (action === "plan_recipe") {
      return {
        pathname: "/ai-assistant",
        params: { prompt: "请用我即将到期的库存食材安排一份今天能完成的餐单。" },
      };
    }
    return typeof data.inventoryItemId === "number"
      ? { pathname: "/(tabs)/inventory", params: { highlightItemId: data.inventoryItemId } }
      : null;
  }

  if (data.type === "routine_reminder") {
    if (data.kind === "meal") return { pathname: "/diet-record" };
    if (data.kind === "water") return { pathname: "/notifications" };
    return null;
  }

  if (data.type === "cooking_reminder" && typeof data.recipeId === "number") {
    return actionIdentifier === "START_COOKING"
      ? { pathname: "/cooking-mode", params: { recipeId: data.recipeId, fromQueue: true } }
      : { pathname: "/cooking-queue", params: { highlightRecipeId: data.recipeId } };
  }

  if (data.type === "admin_campaign") return { pathname: "/notifications" };

  // Unknown or empty payloads must never change the startup route.
  return null;
}
