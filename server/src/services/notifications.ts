import { db } from "../storage/db.js";
import { currentDateKey, dateKeyAfterDays } from "../utils/date.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";

type PushDevice = { expo_push_token: string };

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(value: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(value);
}

export async function sendExpoPush(messages: Array<{ to: string; title: string; body: string; data: Record<string, unknown> }>) {
  if (!messages.length) return [];
  const tickets: Array<{ status?: string; details?: { error?: string } }> = [];
  for (let start = 0; start < messages.length; start += 100) {
    const batch = messages.slice(start, start + 100);
    const response = await fetchWithTimeout(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(batch.map((message) => ({ ...message, sound: "default", priority: "high" }))),
    });
    if (!response.ok) throw new Error(`Expo Push returned ${response.status}`);
    const result = await response.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
    const batchTickets = result.data ?? [];
    batchTickets.forEach((ticket, index) => {
      if (ticket.details?.error === "DeviceNotRegistered") {
        db.prepare("UPDATE push_devices SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE expo_push_token = ?")
          .run(batch[index]?.to);
      }
    });
    tickets.push(...batchTickets);
  }
  return tickets;
}

/** Sends one deduplicated push per user for food expiring in the next three days. */
export async function sendExpiringInventoryNotifications() {
  const today = currentDateKey();
  const deadline = dateKeyAfterDays(3);
  const rows = db.prepare(`
    SELECT i.id, i.user_id, i.food_name, i.expiration_date, d.expo_push_token
    FROM inventory_items i
    LEFT JOIN user_notification_preferences p ON p.user_id = i.user_id
    JOIN push_devices d ON d.user_id = i.user_id AND d.is_active = 1
    WHERE i.is_available = 1 AND COALESCE(p.expiring_alert, 1) = 1
      AND i.expiration_date >= ? AND i.expiration_date <= ?
    ORDER BY i.expiration_date ASC
  `).all(today, deadline) as Array<{ id: number; user_id: number; food_name: string; expiration_date: string; expo_push_token: string }>;

  const grouped = new Map<number, { tokens: Set<string>; items: Array<{ id: number; name: string; expiration: string }> }>();
  const reserve = db.prepare(`
    INSERT OR IGNORE INTO notification_deliveries (user_id, inventory_item_id, notification_type, delivery_date)
    VALUES (?, ?, 'expiring_inventory', ?)
  `);

  for (const row of rows) {
    if (!isExpoPushToken(row.expo_push_token)) continue;
    if (!reserve.run(row.user_id, row.id, today).changes) continue;
    const current = grouped.get(row.user_id) ?? { tokens: new Set<string>(), items: [] };
    current.tokens.add(row.expo_push_token);
    current.items.push({ id: row.id, name: row.food_name, expiration: row.expiration_date });
    grouped.set(row.user_id, current);
  }

  const messages: Array<{ to: string; title: string; body: string; data: Record<string, unknown> }> = [];
  const addInboxItem = db.prepare(`
    INSERT INTO user_notification_inbox (user_id, type, title, body, inventory_item_id)
    VALUES (?, 'expiring_inventory', '食材临期提醒', ?, ?)
  `);
  for (const [userId, group] of grouped) {
    const first = group.items[0];
    const rest = group.items.length - 1;
    const body = rest > 0
      ? `【${first.name}】等 ${group.items.length} 种食材将在 3 天内到期，优先安排食用吧。`
      : `【${first.name}】将于 ${first.expiration} 到期，记得优先安排食用。`;
    addInboxItem.run(userId, body, first.id);
    for (const token of group.tokens) {
      messages.push({ to: token, title: "食材临期提醒", body, data: { type: "expiring_inventory", userId, inventoryItemId: first.id } });
    }
  }

  const tickets = await sendExpoPush(messages);
  const userStatuses = new Map<number, "accepted" | "failed">();
  tickets.forEach((ticket, index) => {
    const userId = messages[index]?.data.userId;
    if (typeof userId !== "number") return;
    if (ticket.status === "ok") userStatuses.set(userId, "accepted");
    else if (!userStatuses.has(userId)) userStatuses.set(userId, "failed");
  });
  const markDelivery = db.prepare(`
    UPDATE notification_deliveries SET status = ?
    WHERE user_id = ? AND notification_type = 'expiring_inventory' AND delivery_date = ? AND status = 'queued'
  `);
  db.transaction(() => userStatuses.forEach((status, userId) => markDelivery.run(status, userId, today)))();
  return { recipients: grouped.size, messages: messages.length };
}

export function startNotificationScheduler() {
  const run = () => sendExpiringInventoryNotifications().catch((error) => {
    console.error("Unable to send expiring inventory notifications:", error);
  });
  run();
  return setInterval(run, 60 * 60 * 1000);
}
