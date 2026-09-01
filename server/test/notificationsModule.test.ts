import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NotificationsRepository } from "../src/modules/notifications/repository.js";
import { createNotificationsService, DEFAULT_NOTIFICATION_PREFERENCES } from "../src/modules/notifications/service.js";

function repository(overrides: Partial<NotificationsRepository> = {}): NotificationsRepository {
  return {
    preferences: async () => null,
    savePreferences: async () => {},
    saveDevice: async () => {},
    ensureRoutineNotification: async () => {},
    unreadCount: async () => 0,
    history: async () => [],
    readAll: async () => 0,
    read: async () => false,
    action: async () => false,
    localEvent: async () => 1,
    adminData: async () => ({ activeDevices: 0, enabledUsers: 0, campaigns: [], automatic: [], eventCounts: {} }),
    beginCampaign: async () => ({ campaignId: 1, recipientCount: 0, devices: [] }),
    finishCampaign: async () => {},
    failCampaign: async () => {},
    recordPushTickets: async () => {},
    pendingReceipts: async () => [],
    applyReceipts: async () => {},
    prepareExpiring: async () => [],
    markExpiringDeliveries: async () => {},
    ...overrides,
  };
}

describe("notifications module", () => {
  test("keeps default preferences and pagination database-neutral", async () => {
    const service = createNotificationsService(repository({ history: async () => [
      { id: 8, isRead: false }, { id: 7, isRead: true }, { id: 6, isRead: false },
    ] }));
    assert.deepEqual(await service.preferences(42), DEFAULT_NOTIFICATION_PREFERENCES);
    assert.deepEqual(await service.history(42, "all", null, 2), {
      items: [{ id: 8, isRead: false }, { id: 7, isRead: true }], nextCursor: 7, hasMore: true,
    });
  });

  test("materializes due routines only after preferences exist", async () => {
    const ensured: string[] = [];
    const service = createNotificationsService(repository({
      preferences: async () => ({ ...DEFAULT_NOTIFICATION_PREFERENCES, breakfast_time: "00:00", lunch_time: "00:00",
        dinner_time: "00:00", water_start_time: "00:00", water_end_time: "00:00", quiet_start_time: "00:00", quiet_end_time: "00:00" }),
      ensureRoutineNotification: async (input) => { ensured.push(`${input.kind}:${input.key}`); },
      unreadCount: async () => 4,
    }));
    assert.equal(await service.unreadCount(42), 4);
    assert.deepEqual(ensured, ["meal:breakfast", "meal:lunch", "meal:dinner", "water:daily"]);
  });

  test("records Expo submissions and receipt outcomes through the repository", async () => {
    const recorded: unknown[] = []; const applied: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => new Response(JSON.stringify({ data:
      String(input).includes("getReceipts") ? { "ticket-1": { status: "ok" } } : [{ id: "ticket-1", status: "ok" }] }),
    { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const service = createNotificationsService(repository({
        recordPushTickets: async (entries) => { recorded.push(...entries); },
        pendingReceipts: async () => [{ ticketId: "ticket-1", userId: 42, notificationId: 7, token: "ExpoPushToken[test]" }],
        applyReceipts: async (entries) => { applied.push(...entries); },
      }));
      const tickets = await service.sendExpoPush([{ to: "ExpoPushToken[test]", title: "标题", body: "内容", data: { type: "system" } }]);
      assert.equal(tickets[0]?.id, "ticket-1");
      assert.equal(recorded.length, 1);
      assert.deepEqual(await service.checkExpoPushReceipts(), { checked: 1 });
      assert.equal(applied.length, 1);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("finishes inbox-only expiry and zero-device campaigns without network calls", async () => {
    const marked: unknown[] = []; const finished: unknown[] = [];
    const service = createNotificationsService(repository({
      prepareExpiring: async () => [{ userId: 42, notificationId: 7, inventoryItemId: 9, title: "临期", body: "处理", tokens: [] }],
      markExpiringDeliveries: async (_date, entries) => { marked.push(...entries); },
      beginCampaign: async () => ({ campaignId: 3, recipientCount: 2, devices: [] }),
      finishCampaign: async (...args) => { finished.push(args); },
    }));
    assert.deepEqual(await service.sendExpiringInventoryNotifications(), { recipients: 1, messages: 0, failedRecipients: 0 });
    assert.deepEqual(marked, [{ userId: 42, status: "inbox_only" }]);
    assert.deepEqual(await service.sendCampaign(1, "维护", "已完成"), { id: 3, recipients: 2, success: 0, failure: 0 });
    assert.equal(finished.length, 1);
  });
});
