import { db } from "../storage/db.js";
import { currentDateKey, dateKeyAfterDays } from "../utils/date.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";

type PushMessage = { to: string; title: string; body: string; data: Record<string, unknown> };
type ExpoTicket = { id?: string; status?: string; message?: string; details?: { error?: string } };

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

function isExpoPushToken(value: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(value);
}

function resolveNotificationOwner(message: PushMessage) {
  const device = db.prepare("SELECT user_id AS userId FROM push_devices WHERE expo_push_token = ?")
    .get(message.to) as { userId: number } | undefined;
  if (!device) return null;
  let notificationId: number | null = null;
  if (typeof message.data.inventoryItemId === "number") {
    notificationId = (db.prepare(`SELECT id FROM user_notification_inbox
      WHERE user_id = ? AND inventory_item_id = ? ORDER BY id DESC LIMIT 1`)
      .get(device.userId, message.data.inventoryItemId) as { id: number } | undefined)?.id ?? null;
  } else if (typeof message.data.campaignId === "number") {
    notificationId = (db.prepare(`SELECT id FROM user_notification_inbox
      WHERE user_id = ? AND campaign_id = ? ORDER BY id DESC LIMIT 1`)
      .get(device.userId, message.data.campaignId) as { id: number } | undefined)?.id ?? null;
  }
  return { userId: device.userId, notificationId };
}

export async function sendExpoPush(messages: PushMessage[]) {
  if (!messages.length) return [];
  const tickets: ExpoTicket[] = [];
  for (let start = 0; start < messages.length; start += 100) {
    const batch = messages.slice(start, start + 100);
    const response = await fetchWithTimeout(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(batch.map((message) => ({
        ...message,
        sound: "default",
        priority: "high",
        ...(message.data.type === "expiring_inventory" ? { categoryId: "inventory-expiring" } : {}),
      }))),
    });
    if (!response.ok) throw new Error(`Expo Push returned ${response.status}`);
    const result = await response.json() as { data?: ExpoTicket[] };
    const batchTickets = result.data ?? [];
    batchTickets.forEach((ticket, index) => {
      const message = batch[index];
      if (!message) return;
      if (ticket.details?.error === "DeviceNotRegistered") {
        db.prepare("UPDATE push_devices SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE expo_push_token = ?")
          .run(message.to);
      }
      const owner = resolveNotificationOwner(message);
      if (!owner) return;
      if (ticket.id) {
        db.prepare(`INSERT OR REPLACE INTO push_notification_receipts
          (expo_ticket_id, user_id, notification_id, expo_push_token, submit_status, receipt_status, error_code, error_message)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .run(ticket.id, owner.userId, owner.notificationId, message.to, ticket.status ?? "unknown", ticket.details?.error ?? null, ticket.message ?? null);
      }
      db.prepare(`INSERT INTO notification_events
        (user_id, notification_id, event_type, metadata_json, expo_ticket_id) VALUES (?, ?, ?, ?, ?)`)
        .run(owner.userId, owner.notificationId, ticket.status === "ok" ? "push_submitted" : "push_submit_failed",
          JSON.stringify({ error: ticket.details?.error ?? null }), ticket.id ?? null);
    });
    tickets.push(...batchTickets);
  }
  return tickets;
}

export async function checkExpoPushReceipts() {
  const pending = db.prepare(`SELECT expo_ticket_id AS ticketId, user_id AS userId,
    notification_id AS notificationId, expo_push_token AS token
    FROM push_notification_receipts WHERE receipt_status = 'pending'
      AND created_at <= datetime('now', '-5 minutes') ORDER BY created_at ASC LIMIT 300`)
    .all() as Array<{ ticketId: string; userId: number; notificationId: number | null; token: string }>;
  if (!pending.length) return { checked: 0 };
  const response = await fetchWithTimeout(EXPO_RECEIPTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ids: pending.map((item) => item.ticketId) }),
  });
  if (!response.ok) throw new Error(`Expo receipts returned ${response.status}`);
  const result = await response.json() as { data?: Record<string, ExpoTicket> };
  const update = db.prepare(`UPDATE push_notification_receipts SET receipt_status = ?, error_code = ?,
    error_message = ?, checked_at = CURRENT_TIMESTAMP WHERE expo_ticket_id = ?`);
  const event = db.prepare(`INSERT INTO notification_events
    (user_id, notification_id, event_type, metadata_json, expo_ticket_id) VALUES (?, ?, ?, ?, ?)`);
  db.transaction(() => pending.forEach((item) => {
    const receipt = result.data?.[item.ticketId];
    if (!receipt) return;
    const status = receipt.status === "ok" ? "delivered" : "failed";
    update.run(status, receipt.details?.error ?? null, receipt.message ?? null, item.ticketId);
    event.run(item.userId, item.notificationId, status === "delivered" ? "push_delivered" : "push_delivery_failed",
      JSON.stringify({ error: receipt.details?.error ?? null }), item.ticketId);
    if (receipt.details?.error === "DeviceNotRegistered") {
      db.prepare("UPDATE push_devices SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE expo_push_token = ?")
        .run(item.token);
    }
  }))();
  return { checked: pending.length };
}

/** Creates one deduplicated inbox task per user, then optionally delivers it to every active device. */
export async function sendExpiringInventoryNotifications() {
  const today = currentDateKey();
  const deadline = dateKeyAfterDays(3);
  const rows = db.prepare(`
    SELECT i.id, i.user_id, i.food_name, i.expiration_date
    FROM inventory_items i
    LEFT JOIN user_notification_preferences p ON p.user_id = i.user_id
    JOIN users u ON u.id = i.user_id AND COALESCE(u.is_disabled, 0) = 0
    WHERE i.is_available = 1 AND COALESCE(p.expiring_alert, 1) = 1
      AND i.expiration_date >= ? AND i.expiration_date <= ?
    ORDER BY i.user_id, i.expiration_date ASC, i.id ASC
  `).all(today, deadline) as Array<{ id: number; user_id: number; food_name: string; expiration_date: string }>;

  const allByUser = new Map<number, Array<{ id: number; name: string; expiration: string }>>();
  const grouped = new Map<number, Array<{ id: number; name: string; expiration: string }>>();
  const reserve = db.prepare(`INSERT OR IGNORE INTO notification_deliveries
    (user_id, inventory_item_id, notification_type, delivery_date) VALUES (?, ?, 'expiring_inventory', ?)`);
  for (const row of rows) {
    const allItems = allByUser.get(row.user_id) ?? [];
    allItems.push({ id: row.id, name: row.food_name, expiration: row.expiration_date });
    allByUser.set(row.user_id, allItems);
    if (!reserve.run(row.user_id, row.id, today).changes) continue;
    const items = grouped.get(row.user_id) ?? [];
    items.push({ id: row.id, name: row.food_name, expiration: row.expiration_date });
    grouped.set(row.user_id, items);
  }

  const messages: PushMessage[] = [];
  const insertInbox = db.prepare(`INSERT INTO user_notification_inbox
    (user_id, type, title, body, inventory_item_id, category, priority, action_status, group_key)
    VALUES (?, 'expiring_inventory', ?, ?, ?, 'action_required', ?, 'pending', ?)`);
  const insertInboxEvent = db.prepare(`INSERT INTO notification_events
    (user_id, notification_id, event_type, metadata_json) VALUES (?, ?, ?, ?)`);
  const findGroupedInbox = db.prepare(`SELECT id FROM user_notification_inbox
    WHERE user_id = ? AND group_key = ? ORDER BY id DESC LIMIT 1`);
  const updateGroupedInbox = db.prepare(`UPDATE user_notification_inbox
    SET title = ?, body = ?, inventory_item_id = ?, priority = ?, action_status = 'pending',
      snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const activeTokens = db.prepare(`SELECT expo_push_token AS token FROM push_devices
    WHERE user_id = ? AND is_active = 1`);
  const linkInventoryItem = db.prepare(`INSERT OR IGNORE INTO notification_inventory_items
    (notification_id, inventory_item_id, user_id) VALUES (?, ?, ?)`);

  for (const [userId] of grouped) {
    const items = allByUser.get(userId) ?? [];
    const first = items[0]!;
    const days = Math.max(0, Math.round((Date.parse(`${first.expiration}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
    const priority = days === 0 ? "urgent" : days === 1 ? "high" : "normal";
    const title = days === 0 ? "今天到期，请尽快处理" : days === 1 ? "明天到期，优先安排" : "3 天内临期提醒";
    const rest = items.length - 1;
    const body = rest > 0
      ? `【${first.name}】等 ${items.length} 种食材即将到期，可安排食谱或标记已处理。`
      : `【${first.name}】将于 ${first.expiration} 到期，可安排食谱或标记已处理。`;
    const groupKey = `expiring:${today}`;
    const existing = findGroupedInbox.get(userId, groupKey) as { id: number } | undefined;
    const notificationId = existing?.id ?? Number(insertInbox.run(userId, title, body, first.id, priority, groupKey).lastInsertRowid);
    if (existing) updateGroupedInbox.run(title, body, first.id, priority, notificationId);
    db.transaction(() => items.forEach((item) => linkInventoryItem.run(notificationId, item.id, userId)))();
    insertInboxEvent.run(userId, notificationId, existing ? "merged" : "created", JSON.stringify({ itemCount: items.length, daysUntilExpiry: days }));
    const tokens = activeTokens.all(userId) as Array<{ token: string }>;
    for (const { token } of tokens) {
      if (!isExpoPushToken(token)) continue;
      messages.push({ to: token, title, body, data: { type: "expiring_inventory", notificationId, inventoryItemId: first.id } });
    }
  }

  const tickets = await sendExpoPush(messages);
  const statuses = new Map<number, "accepted" | "failed">();
  tickets.forEach((ticket, index) => {
    const userId = resolveNotificationOwner(messages[index]!)?.userId;
    if (!userId) return;
    if (ticket.status === "ok") statuses.set(userId, "accepted");
    else if (!statuses.has(userId)) statuses.set(userId, "failed");
  });
  const mark = db.prepare(`UPDATE notification_deliveries SET status = ?
    WHERE user_id = ? AND notification_type = 'expiring_inventory' AND delivery_date = ? AND status = 'queued'`);
  db.transaction(() => grouped.forEach((_items, userId) => mark.run(statuses.get(userId) ?? "inbox_only", userId, today)))();
  return {
    recipients: grouped.size,
    messages: messages.length,
    failedRecipients: [...statuses.values()].filter((status) => status === "failed").length,
  };
}
