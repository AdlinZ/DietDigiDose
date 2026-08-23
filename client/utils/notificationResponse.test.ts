import {
  getExpiringNotificationAction,
  resolveNotificationDestination,
} from "./notificationResponse";

describe("notification response routing", () => {
  it("does not redirect ordinary startup for an empty or unknown response", () => {
    expect(resolveNotificationDestination({}, "default")).toBeNull();
    expect(resolveNotificationDestination({ type: "unknown" }, "default")).toBeNull();
  });

  it("routes supported notification payloads", () => {
    expect(resolveNotificationDestination({ type: "routine_reminder", kind: "meal" }, "default"))
      .toEqual({ pathname: "/diet-record" });
    expect(resolveNotificationDestination({ type: "routine_reminder", kind: "water" }, "default"))
      .toEqual({ pathname: "/notifications" });
    expect(resolveNotificationDestination({ type: "admin_campaign" }, "default"))
      .toEqual({ pathname: "/notifications" });
    expect(resolveNotificationDestination({
      type: "expiring_inventory",
      notificationId: 12,
      inventoryItemId: 34,
    }, "default")).toEqual({
      pathname: "/(tabs)/inventory",
      params: { highlightItemId: 34 },
    });
    expect(resolveNotificationDestination({ type: "cooking_reminder", recipeId: 8 }, "default"))
      .toEqual({ pathname: "/cooking-queue", params: { highlightRecipeId: 8 } });
    expect(resolveNotificationDestination({ type: "cooking_reminder", recipeId: 8 }, "START_COOKING"))
      .toEqual({ pathname: "/cooking-mode", params: { recipeId: 8, fromQueue: true } });
  });

  it("preserves expiring inventory actions", () => {
    expect(getExpiringNotificationAction("COMPLETE")).toBe("complete");
    expect(getExpiringNotificationAction("PLAN_RECIPE")).toBe("plan_recipe");
    expect(getExpiringNotificationAction("default")).toBe("open");
    expect(resolveNotificationDestination({
      type: "expiring_inventory",
      notificationId: 12,
      inventoryItemId: 34,
    }, "COMPLETE")).toBeNull();
  });
});
