import { Router } from "express";
import { db, logAdminAction } from "../../storage/db.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { notificationCampaignSchema } from "../../validation/schemas.js";
import { sendExpoPush } from "../../services/notifications.js";

export function createAdminNotificationsRouter() {
  const router = Router();

  router.get("/notifications", (_req, res) => {
    const activeDevices = (db.prepare(`
      SELECT COUNT(*) AS count FROM push_devices d
      JOIN users u ON u.id = d.user_id
      WHERE d.is_active = 1 AND u.role != 'admin' AND COALESCE(u.is_disabled, 0) = 0
    `).get() as { count: number }).count;
    const enabledUsers = (db.prepare(`
      SELECT COUNT(*) AS count FROM users u
      LEFT JOIN user_notification_preferences p ON p.user_id = u.id
      WHERE u.role != 'admin' AND COALESCE(u.is_disabled, 0) = 0
        AND (COALESCE(p.expiring_alert, 1) = 1 OR COALESCE(p.meal_reminder, 1) = 1 OR COALESCE(p.water_reminder, 1) = 1)
    `).get() as { count: number }).count;
    const campaigns = db.prepare(`
      SELECT c.id, c.title, c.body, c.status, c.recipient_count AS recipientCount,
             c.success_count AS successCount, c.failure_count AS failureCount,
             c.created_at AS createdAt, c.sent_at AS sentAt,
             COALESCE(u.nickname, u.username) AS adminName
      FROM notification_campaigns c JOIN users u ON u.id = c.admin_user_id
      ORDER BY c.id DESC LIMIT 30
    `).all();
    const automatic = db.prepare(`
      SELECT delivery_date AS deliveryDate, status, COUNT(*) AS count
      FROM notification_deliveries
      WHERE notification_type = 'expiring_inventory'
      GROUP BY delivery_date, status ORDER BY delivery_date DESC LIMIT 30
    `).all();
    return res.json({ activeDevices, enabledUsers, campaigns, automatic });
  });

  router.post("/notifications/campaigns", validateBody(notificationCampaignSchema), async (req: AuthRequest, res) => {
    const { title, body } = req.body;
    const devices = db.prepare(`
      SELECT d.id, d.user_id, d.expo_push_token FROM push_devices d
      JOIN users u ON u.id = d.user_id
      WHERE d.is_active = 1 AND u.role != 'admin' AND COALESCE(u.is_disabled, 0) = 0
    `).all() as Array<{ id: number; user_id: number; expo_push_token: string }>;
    const recipients = db.prepare("SELECT id FROM users WHERE role != 'admin' AND COALESCE(is_disabled, 0) = 0")
      .all() as Array<{ id: number }>;
    const created = db.prepare(`INSERT INTO notification_campaigns (admin_user_id, title, body, recipient_count)
      VALUES (?, ?, ?, ?)`)
      .run(req.userId, title, body, recipients.length);
    const campaignId = Number(created.lastInsertRowid);
    try {
      const addInboxItem = db.prepare(`
        INSERT INTO user_notification_inbox (user_id, type, title, body, campaign_id)
        VALUES (?, 'admin_campaign', ?, ?, ?)
      `);
      db.transaction(() => recipients.forEach((user) => addInboxItem.run(user.id, title, body, campaignId)))();
      const tickets = await sendExpoPush(devices.map((device) => ({
        to: device.expo_push_token, title, body, data: { type: "admin_campaign", campaignId },
      })));
      const record = db.prepare(`INSERT INTO notification_campaign_deliveries
        (campaign_id, user_id, push_device_id, status, error_code) VALUES (?, ?, ?, ?, ?)`);
      const pushStatusByUser = new Map<number, "accepted" | "failed">();
      db.transaction(() => devices.forEach((device, index) => {
        const ticket = tickets[index];
        const failed = ticket?.status !== "ok";
        const error = ticket?.details?.error ?? null;
        if (!failed) pushStatusByUser.set(device.user_id, "accepted");
        else if (!pushStatusByUser.has(device.user_id)) pushStatusByUser.set(device.user_id, "failed");
        record.run(campaignId, device.user_id, device.id, failed ? "failed" : "accepted", error);
      }))();
      const success = [...pushStatusByUser.values()].filter((status) => status === "accepted").length;
      const failure = [...pushStatusByUser.values()].filter((status) => status === "failed").length;
      db.prepare(`UPDATE notification_campaigns
        SET status = ?, success_count = ?, failure_count = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(failure ? "completed_with_failures" : "completed", success, failure, campaignId);
      logAdminAction({ adminUserId: req.userId!, action: "notifications.campaign.send", resourceType: "notification_campaign", resourceId: campaignId, summary: `发送通知「${title}」给 ${recipients.length} 位用户`, ipAddress: req.ip, userAgent: req.get("user-agent") });
      return res.status(201).json({ id: campaignId, recipients: recipients.length, success, failure });
    } catch (error) {
      db.prepare("UPDATE notification_campaigns SET status = 'failed', failure_count = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(devices.length, campaignId);
      throw error;
    }
  });

  return router;
}
