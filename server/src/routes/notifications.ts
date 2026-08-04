import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { notificationPreferencesSchema, pushDeviceSchema } from "../validation/schemas.js";

const router = Router();

router.get("/preferences", authMiddleware, (req: AuthRequest, res) => {
  const row = db.prepare(`
    SELECT expiring_alert, meal_reminder, water_reminder
    FROM user_notification_preferences WHERE user_id = ?
  `).get(req.userId) as Record<string, number> | undefined;
  return res.json({
    expiring_alert: row?.expiring_alert !== 0,
    meal_reminder: row?.meal_reminder !== 0,
    water_reminder: row?.water_reminder !== 0,
  });
});

router.put("/preferences", authMiddleware, validateBody(notificationPreferencesSchema), (req: AuthRequest, res) => {
  const { expiring_alert, meal_reminder, water_reminder } = req.body;
  db.prepare(`
    INSERT INTO user_notification_preferences (user_id, expiring_alert, meal_reminder, water_reminder, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      expiring_alert = excluded.expiring_alert,
      meal_reminder = excluded.meal_reminder,
      water_reminder = excluded.water_reminder,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.userId, Number(expiring_alert), Number(meal_reminder), Number(water_reminder));
  return res.json({ expiring_alert, meal_reminder, water_reminder });
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

router.get("/history", authMiddleware, (req: AuthRequest, res) => {
  const items = db.prepare(`
    SELECT id, type, title, body, is_read AS isRead, created_at AS createdAt
    FROM user_notification_inbox
    WHERE user_id = ? ORDER BY id DESC LIMIT 50
  `).all(req.userId);
  return res.json({ items });
});

export default router;
