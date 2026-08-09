import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  localNotificationEventSchema,
  notificationActionSchema,
  notificationPreferencesSchema,
  pushDeviceSchema,
} from "../validation/schemas.js";
import { currentDateKey } from "../utils/date.js";

const router = Router();
const APP_TIME_ZONE = process.env.APP_TIME_ZONE?.trim() || "Asia/Shanghai";

const DEFAULT_PREFERENCES = {
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

function recordEvent(userId: number, notificationId: number | null, eventType: string, metadata?: unknown) {
  db.prepare(`
    INSERT INTO notification_events (user_id, notification_id, event_type, metadata_json)
    VALUES (?, ?, ?, ?)
  `).run(userId, notificationId, eventType, metadata ? JSON.stringify(metadata) : null);
}

function materializeRoutineInbox(userId: number) {
  const preferences = db.prepare(`SELECT meal_reminder, water_reminder, breakfast_time, lunch_time,
    dinner_time, water_start_time, water_end_time, water_interval_minutes, quiet_start_time,
    quiet_end_time, weekdays_enabled, weekends_enabled
    FROM user_notification_preferences WHERE user_id = ?`).get(userId) as Record<string, string | number> | undefined;
  // A row exists only after the user has explicitly saved their reminder configuration.
  if (!preferences) return;
  const now = new Date();
  const currentTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, weekday: "short" }).format(now);
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  if ((isWeekend && preferences.weekends_enabled === 0) || (!isWeekend && preferences.weekdays_enabled === 0)) return;
  const dateKey = currentDateKey(now);
  const toMinutes = (value: string | number) => {
    const [hour = 0, minute = 0] = String(value).split(":").map(Number);
    return hour * 60 + minute;
  };
  const currentMinutes = toMinutes(currentTime);
  const quietStart = toMinutes(preferences.quiet_start_time);
  const quietEnd = toMinutes(preferences.quiet_end_time);
  const isQuiet = (minute: number) => quietStart !== quietEnd
    && (quietStart < quietEnd ? minute >= quietStart && minute < quietEnd : minute >= quietStart || minute < quietEnd);
  const find = db.prepare("SELECT id FROM user_notification_inbox WHERE user_id = ? AND group_key = ? LIMIT 1");
  const insert = db.prepare(`INSERT INTO user_notification_inbox
    (user_id, type, title, body, category, priority, action_status, group_key)
    VALUES (?, ?, ?, ?, 'routine', 'low', 'info', ?)`);
  const ensure = (kind: "meal" | "water", key: string, title: string, body: string) => {
    const groupKey = `routine:${kind}:${key}:${dateKey}`;
    if (find.get(userId, groupKey)) return;
    const result = insert.run(userId, `${kind}_reminder`, title, body, groupKey);
    recordEvent(userId, Number(result.lastInsertRowid), "created", { source: "routine_materializer", kind });
  };

  if (preferences.meal_reminder !== 0) {
    const meals = [
      ["breakfast", preferences.breakfast_time, "早餐打卡提醒", "记下早餐，让今天的营养规划有个好开始。"],
      ["lunch", preferences.lunch_time, "午餐打卡提醒", "记下这一餐，继续完善今天的营养记录。"],
      ["dinner", preferences.dinner_time, "晚餐打卡提醒", "晚餐后花一分钟记录，让今日营养更完整。"],
    ] as const;
    for (const [key, time, title, body] of meals) {
      const minute = toMinutes(time);
      if (minute <= currentMinutes && !isQuiet(minute)) ensure("meal", key, title, body);
    }
  }
  if (preferences.water_reminder !== 0) {
    const start = toMinutes(preferences.water_start_time);
    const end = toMinutes(preferences.water_end_time);
    const interval = Number(preferences.water_interval_minutes) || 120;
    let latestDue: number | null = null;
    for (let minute = start; minute <= end; minute += interval) {
      if (minute <= currentMinutes && !isQuiet(minute)) latestDue = minute;
    }
    if (latestDue !== null) ensure("water", "daily", "今日饮水提醒", "今天的饮水计划正在进行，记得及时补充水分。");
  }
}

router.get("/preferences", authMiddleware, (req: AuthRequest, res) => {
  const row = db.prepare(`
    SELECT expiring_alert, meal_reminder, water_reminder,
      breakfast_time, lunch_time, dinner_time, water_start_time, water_end_time,
      water_interval_minutes, quiet_start_time, quiet_end_time, weekdays_enabled, weekends_enabled
    FROM user_notification_preferences WHERE user_id = ?
  `).get(req.userId) as Record<string, string | number> | undefined;
  if (!row) return res.json(DEFAULT_PREFERENCES);
  return res.json({
    expiring_alert: row.expiring_alert !== 0,
    meal_reminder: row.meal_reminder !== 0,
    water_reminder: row.water_reminder !== 0,
    breakfast_time: row.breakfast_time,
    lunch_time: row.lunch_time,
    dinner_time: row.dinner_time,
    water_start_time: row.water_start_time,
    water_end_time: row.water_end_time,
    water_interval_minutes: row.water_interval_minutes,
    quiet_start_time: row.quiet_start_time,
    quiet_end_time: row.quiet_end_time,
    weekdays_enabled: row.weekdays_enabled !== 0,
    weekends_enabled: row.weekends_enabled !== 0,
  });
});

router.put("/preferences", authMiddleware, validateBody(notificationPreferencesSchema), (req: AuthRequest, res) => {
  const input = req.body;
  db.prepare(`
    INSERT INTO user_notification_preferences (
      user_id, expiring_alert, meal_reminder, water_reminder,
      breakfast_time, lunch_time, dinner_time, water_start_time, water_end_time,
      water_interval_minutes, quiet_start_time, quiet_end_time, weekdays_enabled, weekends_enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      expiring_alert = excluded.expiring_alert,
      meal_reminder = excluded.meal_reminder,
      water_reminder = excluded.water_reminder,
      breakfast_time = excluded.breakfast_time,
      lunch_time = excluded.lunch_time,
      dinner_time = excluded.dinner_time,
      water_start_time = excluded.water_start_time,
      water_end_time = excluded.water_end_time,
      water_interval_minutes = excluded.water_interval_minutes,
      quiet_start_time = excluded.quiet_start_time,
      quiet_end_time = excluded.quiet_end_time,
      weekdays_enabled = excluded.weekdays_enabled,
      weekends_enabled = excluded.weekends_enabled,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    req.userId,
    Number(input.expiring_alert), Number(input.meal_reminder), Number(input.water_reminder),
    input.breakfast_time, input.lunch_time, input.dinner_time, input.water_start_time, input.water_end_time,
    input.water_interval_minutes, input.quiet_start_time, input.quiet_end_time,
    Number(input.weekdays_enabled), Number(input.weekends_enabled),
  );
  return res.json(input);
});

router.put("/device", authMiddleware, validateBody(pushDeviceSchema), (req: AuthRequest, res) => {
  const { expo_push_token, platform } = req.body;
  db.prepare(`
    INSERT INTO push_devices (user_id, expo_push_token, platform, is_active, updated_at)
    VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(expo_push_token) DO UPDATE SET
      user_id = excluded.user_id,
      platform = excluded.platform,
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.userId, expo_push_token, platform);
  return res.status(204).end();
});

router.get("/unread-count", authMiddleware, (req: AuthRequest, res) => {
  materializeRoutineInbox(req.userId!);
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM user_notification_inbox
    WHERE user_id = ? AND is_read = 0
      AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)
  `).get(req.userId) as { count: number };
  return res.json({ count: row.count });
});

router.get("/history", authMiddleware, (req: AuthRequest, res) => {
  materializeRoutineInbox(req.userId!);
  const cursorValue = typeof req.query.cursor === "string" ? Number(req.query.cursor) : null;
  const cursor = Number.isSafeInteger(cursorValue) && Number(cursorValue) > 0 ? Number(cursorValue) : null;
  const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const filter = req.query.filter === "pending" || req.query.filter === "system" ? req.query.filter : "all";
  const conditions = ["user_id = ?", "(snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)"];
  const params: Array<number | string> = [req.userId!];
  if (filter === "pending") {
    conditions.push("category = 'action_required'", "action_status = 'pending'");
  } else if (filter === "system") {
    conditions.push("category = 'system'");
  }
  if (cursor) {
    conditions.push("id < ?");
    params.push(cursor);
  }
  params.push(limit + 1);
  const rows = db.prepare(`
    SELECT id, type, title, body, is_read AS isRead, created_at AS createdAt,
      inventory_item_id AS inventoryItemId, category, priority,
      action_status AS actionStatus, snoozed_until AS snoozedUntil,
      (SELECT COUNT(*) FROM notification_inventory_items nii WHERE nii.notification_id = user_notification_inbox.id) AS itemCount
    FROM user_notification_inbox
    WHERE ${conditions.join(" AND ")}
    ORDER BY id DESC LIMIT ?
  `).all(...params) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({ ...row, isRead: row.isRead !== 0 }));
  const nextCursor = hasMore ? Number(rows[limit - 1]?.id) : null;
  return res.json({ items, nextCursor, hasMore });
});

router.put("/read-all", authMiddleware, (_req: AuthRequest, res) => {
  const req = _req;
  const result = db.prepare(`
    UPDATE user_notification_inbox SET is_read = 1, read_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND is_read = 0
  `).run(req.userId);
  recordEvent(req.userId!, null, "read_all", { count: result.changes });
  return res.json({ updated: result.changes });
});

router.put("/:id/read", authMiddleware, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "通知 ID 无效" });
  const result = db.prepare(`
    UPDATE user_notification_inbox SET is_read = 1, read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "通知不存在" });
  recordEvent(req.userId!, id, "read");
  return res.json({ id, isRead: true });
});

router.post("/:id/actions", authMiddleware, validateBody(notificationActionSchema), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "通知 ID 无效" });
  const item = db.prepare(`
    SELECT id, inventory_item_id AS inventoryItemId FROM user_notification_inbox WHERE id = ? AND user_id = ?
  `).get(id, req.userId) as { id: number; inventoryItemId: number | null } | undefined;
  if (!item) return res.status(404).json({ error: "通知不存在" });

  const { action, metadata } = req.body;
  db.transaction(() => {
    if (action === "complete") {
      db.prepare(`UPDATE user_notification_inbox SET action_status = 'completed', is_read = 1,
        read_at = COALESCE(read_at, CURRENT_TIMESTAMP), snoozed_until = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`).run(id, req.userId);
      if (item.inventoryItemId) {
        db.prepare(`UPDATE inventory_items SET is_available = 0
          WHERE user_id = ? AND id IN (
            SELECT inventory_item_id FROM notification_inventory_items WHERE notification_id = ? AND user_id = ?
          )`).run(req.userId, id, req.userId);
      }
    } else if (action === "snooze_today") {
      db.prepare(`UPDATE user_notification_inbox SET snoozed_until = datetime(date('now', '+1 day')),
        is_read = 1, read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`).run(id, req.userId);
    } else {
      db.prepare(`UPDATE user_notification_inbox SET is_read = 1,
        read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`).run(id, req.userId);
    }
    recordEvent(req.userId!, id, `action_${action}`, metadata);
  })();
  return res.json({ id, action, actionStatus: action === "complete" ? "completed" : "pending" });
});

router.post("/local-event", authMiddleware, validateBody(localNotificationEventSchema), (req: AuthRequest, res) => {
  const { kind, title, body, event, source_id } = req.body;
  const groupKey = `local:${kind}:${source_id || new Date().toISOString().slice(0, 10)}`;
  let row = db.prepare(`
    SELECT id FROM user_notification_inbox
    WHERE user_id = ? AND type = ? AND title = ? AND date(created_at) = date('now')
    ORDER BY id DESC LIMIT 1
  `).get(req.userId, `${kind}_reminder`, title) as { id: number } | undefined;
  if (!row) {
    const result = db.prepare(`
      INSERT INTO user_notification_inbox
        (user_id, type, title, body, category, priority, action_status, group_key, is_read, read_at)
      VALUES (?, ?, ?, ?, 'routine', 'low', 'info', ?, ?, ?)
    `).run(req.userId, `${kind}_reminder`, title, body, groupKey, Number(event === "opened"), event === "opened" ? new Date().toISOString() : null);
    row = { id: Number(result.lastInsertRowid) };
    recordEvent(req.userId!, row.id, "created", { source: "local", kind });
  } else if (event === "opened") {
    db.prepare(`UPDATE user_notification_inbox SET is_read = 1,
      read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
  }
  recordEvent(req.userId!, row.id, event === "opened" ? "opened" : "received", { source: "local", kind });
  return res.status(201).json({ id: row.id });
});

export default router;
