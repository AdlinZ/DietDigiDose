import type { Pool, PoolClient } from "pg";
import { expiryContent, type ExpiryItem } from "./expiry.js";
import type { NotificationsRepository } from "./repository.js";
import type {
  AdminNotificationData, CampaignDelivery, ExpoTicket, NotificationAction, NotificationFilter,
  NotificationPreferences, PushMessage, PushReceiptResult,
} from "./types.js";

export class PostgresNotificationsRepository implements NotificationsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async preferences(userId: number) {
    const row = (await this.pool.query(`SELECT expiring_alert,meal_reminder,water_reminder,breakfast_time,lunch_time,dinner_time,
      water_start_time,water_end_time,water_interval_minutes,quiet_start_time,quiet_end_time,weekdays_enabled,weekends_enabled
      FROM user_notification_preferences WHERE user_id=$1`, [userId])).rows[0];
    return row ? this.preference(row) : null;
  }

  async savePreferences(userId: number, input: NotificationPreferences) {
    await this.pool.query(`INSERT INTO user_notification_preferences(user_id,expiring_alert,meal_reminder,water_reminder,
      breakfast_time,lunch_time,dinner_time,water_start_time,water_end_time,water_interval_minutes,quiet_start_time,quiet_end_time,
      weekdays_enabled,weekends_enabled,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET expiring_alert=EXCLUDED.expiring_alert,meal_reminder=EXCLUDED.meal_reminder,
      water_reminder=EXCLUDED.water_reminder,breakfast_time=EXCLUDED.breakfast_time,lunch_time=EXCLUDED.lunch_time,
      dinner_time=EXCLUDED.dinner_time,water_start_time=EXCLUDED.water_start_time,water_end_time=EXCLUDED.water_end_time,
      water_interval_minutes=EXCLUDED.water_interval_minutes,quiet_start_time=EXCLUDED.quiet_start_time,
      quiet_end_time=EXCLUDED.quiet_end_time,weekdays_enabled=EXCLUDED.weekdays_enabled,weekends_enabled=EXCLUDED.weekends_enabled,
      updated_at=CURRENT_TIMESTAMP`, [userId, input.expiring_alert, input.meal_reminder, input.water_reminder, input.breakfast_time,
      input.lunch_time, input.dinner_time, input.water_start_time, input.water_end_time, input.water_interval_minutes,
      input.quiet_start_time, input.quiet_end_time, input.weekdays_enabled, input.weekends_enabled]);
  }

  async saveDevice(userId: number, token: string, platform: string) {
    await this.pool.query(`INSERT INTO push_devices(user_id,expo_push_token,platform,is_active,updated_at)
      VALUES($1,$2,$3,TRUE,CURRENT_TIMESTAMP) ON CONFLICT(expo_push_token) DO UPDATE SET user_id=EXCLUDED.user_id,
      platform=EXCLUDED.platform,is_active=TRUE,updated_at=CURRENT_TIMESTAMP`, [userId, token, platform]);
  }

  async ensureRoutineNotification(input: { userId: number; kind: "meal" | "water"; key: string; dateKey: string; title: string; body: string }) {
    await this.tx(async (client) => {
      const groupKey = `routine:${input.kind}:${input.key}:${input.dateKey}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`notification:${input.userId}:${groupKey}`]);
      if ((await client.query("SELECT 1 FROM user_notification_inbox WHERE user_id=$1 AND group_key=$2 LIMIT 1", [input.userId, groupKey])).rowCount) return;
      const inserted = await client.query(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key)
        VALUES($1,$2,$3,$4,'routine','low','info',$5) RETURNING id`, [input.userId, `${input.kind}_reminder`, input.title, input.body, groupKey]);
      await this.event(client, input.userId, Number(inserted.rows[0].id), "created", { source: "routine_materializer", kind: input.kind });
    });
  }

  async unreadCount(userId: number) {
    return Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM user_notification_inbox WHERE user_id=$1 AND is_read=FALSE
      AND(snoozed_until IS NULL OR snoozed_until<=CURRENT_TIMESTAMP)`, [userId])).rows[0].count);
  }

  async history(userId: number, filter: NotificationFilter, cursor: number | null, limit: number) {
    const conditions = ["user_id=$1", "(snoozed_until IS NULL OR snoozed_until<=CURRENT_TIMESTAMP)"];
    const params: Array<number | string> = [userId];
    if (filter === "pending") conditions.push("category='action_required'", "action_status='pending'");
    else if (filter === "system") conditions.push("category='system'");
    if (cursor) { params.push(cursor); conditions.push(`id<$${params.length}`); }
    params.push(limit);
    const rows = (await this.pool.query(`SELECT id,type,title,body,is_read AS "isRead",created_at AS "createdAt",
      inventory_item_id AS "inventoryItemId",category,priority,action_status AS "actionStatus",snoozed_until AS "snoozedUntil",
      (SELECT COUNT(*)::integer FROM notification_inventory_items n WHERE n.notification_id=user_notification_inbox.id) AS "itemCount"
      FROM user_notification_inbox WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT $${params.length}`, params)).rows;
    return rows.map((row) => ({ ...row, id: Number(row.id), inventoryItemId: row.inventoryItemId == null ? null : Number(row.inventoryItemId),
      isRead: Boolean(row.isRead), itemCount: Number(row.itemCount) }));
  }

  async readAll(userId: number) {
    return this.tx(async (client) => {
      const changes = (await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE user_id=$1 AND is_read=FALSE`, [userId])).rowCount ?? 0;
      await this.event(client, userId, null, "read_all", { count: changes });
      return changes;
    });
  }

  async read(userId: number, notificationId: number) {
    return this.tx(async (client) => {
      const changed = (await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,read_at=COALESCE(read_at,CURRENT_TIMESTAMP),
        updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId])).rowCount === 1;
      if (changed) await this.event(client, userId, notificationId, "read");
      return changed;
    });
  }

  async action(userId: number, notificationId: number, action: NotificationAction, metadata?: unknown) {
    return this.tx(async (client) => {
      const item = (await client.query(`SELECT inventory_item_id AS "inventoryItemId" FROM user_notification_inbox
        WHERE id=$1 AND user_id=$2 FOR UPDATE`, [notificationId, userId])).rows[0];
      if (!item) return false;
      if (action === "complete") {
        await client.query(`UPDATE user_notification_inbox SET action_status='completed',is_read=TRUE,
          read_at=COALESCE(read_at,CURRENT_TIMESTAMP),snoozed_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId]);
        if (item.inventoryItemId != null) await client.query(`UPDATE inventory_items SET is_available=FALSE WHERE user_id=$1 AND id IN
          (SELECT inventory_item_id FROM notification_inventory_items WHERE notification_id=$2 AND user_id=$1)`, [userId, notificationId]);
      } else if (action === "snooze_today") await client.query(`UPDATE user_notification_inbox SET
        snoozed_until=date_trunc('day',CURRENT_TIMESTAMP)+INTERVAL '1 day',is_read=TRUE,
        read_at=COALESCE(read_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId]);
      else await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,read_at=COALESCE(read_at,CURRENT_TIMESTAMP),
        updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2`, [notificationId, userId]);
      await this.event(client, userId, notificationId, `action_${action}`, metadata);
      return true;
    });
  }

  async localEvent(input: { userId: number; kind: string; title: string; body: string; event: string; sourceId?: string }) {
    return this.tx(async (client) => {
      const lockKey = `local:${input.userId}:${input.kind}:${input.title}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockKey]);
      let row = (await client.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND type=$2 AND title=$3
        AND created_at::date=CURRENT_DATE ORDER BY id DESC LIMIT 1 FOR UPDATE`, [input.userId, `${input.kind}_reminder`, input.title])).rows[0];
      if (!row) {
        const groupKey = `local:${input.kind}:${input.sourceId || new Date().toISOString().slice(0, 10)}`;
        row = (await client.query(`INSERT INTO user_notification_inbox(user_id,type,title,body,category,priority,action_status,group_key,is_read,read_at)
          VALUES($1,$2,$3,$4,'routine','low','info',$5,$6,$7) RETURNING id`, [input.userId, `${input.kind}_reminder`, input.title,
          input.body, groupKey, input.event === "opened", input.event === "opened" ? new Date().toISOString() : null])).rows[0];
        await this.event(client, input.userId, Number(row.id), "created", { source: "local", kind: input.kind });
      } else if (input.event === "opened") await client.query(`UPDATE user_notification_inbox SET is_read=TRUE,
        read_at=COALESCE(read_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [row.id]);
      await this.event(client, input.userId, Number(row.id), input.event === "opened" ? "opened" : "received", { source: "local", kind: input.kind });
      return Number(row.id);
    });
  }

  async adminData(since: string): Promise<AdminNotificationData> {
    const [active, enabled, campaigns, automatic, events] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::integer AS count FROM push_devices d JOIN users u ON u.id=d.user_id
        WHERE d.is_active=TRUE AND u.role!='admin' AND COALESCE(u.is_disabled,FALSE)=FALSE`),
      this.pool.query(`SELECT COUNT(*)::integer AS count FROM users u LEFT JOIN user_notification_preferences p ON p.user_id=u.id
        WHERE u.role!='admin' AND COALESCE(u.is_disabled,FALSE)=FALSE AND(COALESCE(p.expiring_alert,TRUE)=TRUE
        OR COALESCE(p.meal_reminder,TRUE)=TRUE OR COALESCE(p.water_reminder,TRUE)=TRUE)`),
      this.pool.query(`SELECT c.id,c.title,c.body,c.status,c.recipient_count AS "recipientCount",c.success_count AS "successCount",
        c.failure_count AS "failureCount",c.created_at AS "createdAt",c.sent_at AS "sentAt",u.username AS "adminName"
        FROM notification_campaigns c JOIN users u ON u.id=c.admin_user_id ORDER BY c.id DESC LIMIT 30`),
      this.pool.query(`SELECT delivery_date AS "deliveryDate",status,COUNT(*)::integer AS count FROM notification_deliveries
        WHERE notification_type='expiring_inventory' GROUP BY delivery_date,status ORDER BY delivery_date DESC LIMIT 30`),
      this.pool.query(`SELECT event_type AS "eventType",COUNT(*)::integer AS count FROM notification_events WHERE created_at>=$1 GROUP BY event_type`, [since]),
    ]);
    return { activeDevices: Number(active.rows[0].count), enabledUsers: Number(enabled.rows[0].count),
      campaigns: campaigns.rows.map((row) => ({ ...row, id: Number(row.id) })), automatic: automatic.rows,
      eventCounts: Object.fromEntries(events.rows.map((row) => [String(row.eventType), Number(row.count)])) };
  }

  async beginCampaign(adminUserId: number, title: string, body: string) {
    return this.tx(async (client) => {
      const recipientCount = Number((await client.query(`SELECT COUNT(*)::integer AS count FROM users
        WHERE role!='admin' AND COALESCE(is_disabled,FALSE)=FALSE`)).rows[0].count);
      const campaignId = Number((await client.query(`INSERT INTO notification_campaigns(admin_user_id,title,body,recipient_count)
        VALUES($1,$2,$3,$4) RETURNING id`, [adminUserId, title, body, recipientCount])).rows[0].id);
      await client.query(`WITH inserted AS(INSERT INTO user_notification_inbox(user_id,type,title,body,campaign_id,category,priority,action_status)
        SELECT id,'admin_campaign',$1,$2,$3,'system','normal','info' FROM users WHERE role!='admin' AND COALESCE(is_disabled,FALSE)=FALSE
        RETURNING id,user_id) INSERT INTO notification_events(user_id,notification_id,event_type,metadata_json)
        SELECT user_id,id,'created',jsonb_build_object('source','admin_campaign','campaignId',$3::bigint) FROM inserted`, [title, body, campaignId]);
      const devices = (await client.query(`SELECT d.id,d.user_id AS "userId",d.expo_push_token AS token FROM push_devices d JOIN users u ON u.id=d.user_id
        WHERE d.is_active=TRUE AND u.role!='admin' AND COALESCE(u.is_disabled,FALSE)=FALSE`)).rows
        .map((row) => ({ id: Number(row.id), userId: Number(row.userId), token: String(row.token) }));
      return { campaignId, recipientCount, devices };
    });
  }

  async finishCampaign(campaignId: number, deliveries: CampaignDelivery[], success: number, failure: number) {
    await this.tx(async (client) => {
      for (const item of deliveries) await client.query(`INSERT INTO notification_campaign_deliveries
        (campaign_id,user_id,push_device_id,status,error_code) VALUES($1,$2,$3,$4,$5)`,
      [campaignId, item.userId, item.deviceId, item.status, item.errorCode]);
      await client.query(`UPDATE notification_campaigns SET status=$1,success_count=$2,failure_count=$3,sent_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [failure ? "completed_with_failures" : "completed", success, failure, campaignId]);
    });
  }

  async failCampaign(campaignId: number, failureCount: number) {
    await this.pool.query("UPDATE notification_campaigns SET status='failed',failure_count=$1,sent_at=CURRENT_TIMESTAMP WHERE id=$2", [failureCount, campaignId]);
  }

  async recordPushTickets(entries: Array<{ message: PushMessage; ticket: ExpoTicket }>) {
    await this.tx(async (client) => {
      for (const { message, ticket } of entries) {
        if (ticket.details?.error === "DeviceNotRegistered") await this.deactivate(client, message.to);
        const owner = await this.owner(client, message);
        if (!owner) continue;
        if (ticket.id) await client.query(`INSERT INTO push_notification_receipts(expo_ticket_id,user_id,notification_id,expo_push_token,
          submit_status,receipt_status,error_code,error_message) VALUES($1,$2,$3,$4,$5,'pending',$6,$7)
          ON CONFLICT(expo_ticket_id) DO UPDATE SET user_id=EXCLUDED.user_id,notification_id=EXCLUDED.notification_id,
          expo_push_token=EXCLUDED.expo_push_token,submit_status=EXCLUDED.submit_status,receipt_status='pending',
          error_code=EXCLUDED.error_code,error_message=EXCLUDED.error_message,checked_at=NULL`,
        [ticket.id, owner.userId, owner.notificationId, message.to, ticket.status ?? "unknown", ticket.details?.error ?? null, ticket.message ?? null]);
        await this.event(client, owner.userId, owner.notificationId, ticket.status === "ok" ? "push_submitted" : "push_submit_failed",
          { error: ticket.details?.error ?? null }, ticket.id ?? null);
      }
    });
  }

  async pendingReceipts(before: string, limit: number) {
    const rows = (await this.pool.query(`SELECT expo_ticket_id AS "ticketId",user_id AS "userId",notification_id AS "notificationId",
      expo_push_token AS token FROM push_notification_receipts WHERE receipt_status='pending' AND created_at<=$1
      ORDER BY created_at ASC LIMIT $2`, [before, limit])).rows;
    return rows.map((row) => ({ ticketId: String(row.ticketId), userId: Number(row.userId),
      notificationId: row.notificationId == null ? null : Number(row.notificationId), token: String(row.token) }));
  }

  async applyReceipts(receipts: PushReceiptResult[]) {
    await this.tx(async (client) => {
      for (const item of receipts) {
        const status = item.receipt.status === "ok" ? "delivered" : "failed";
        await client.query(`UPDATE push_notification_receipts SET receipt_status=$1,error_code=$2,error_message=$3,checked_at=CURRENT_TIMESTAMP
          WHERE expo_ticket_id=$4`, [status, item.receipt.details?.error ?? null, item.receipt.message ?? null, item.ticketId]);
        await this.event(client, item.userId, item.notificationId, status === "delivered" ? "push_delivered" : "push_delivery_failed",
          { error: item.receipt.details?.error ?? null }, item.ticketId);
        if (item.receipt.details?.error === "DeviceNotRegistered") await this.deactivate(client, item.token);
      }
    });
  }

  async prepareExpiring(today: string, deadline: string) {
    return this.tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`expiring-notifications:${today}`]);
      const rows = (await client.query(`SELECT i.id,i.user_id AS "userId",i.food_name AS name,i.expiration_date AS expiration
        FROM inventory_items i LEFT JOIN user_notification_preferences p ON p.user_id=i.user_id JOIN users u ON u.id=i.user_id
        AND COALESCE(u.is_disabled,FALSE)=FALSE WHERE i.is_available=TRUE AND COALESCE(p.expiring_alert,TRUE)=TRUE
        AND i.expiration_date>=$1 AND i.expiration_date<=$2 ORDER BY i.user_id,i.expiration_date,i.id`, [today, deadline])).rows
        .map((row) => ({ id: Number(row.id), userId: Number(row.userId), name: String(row.name), expiration: String(row.expiration).slice(0, 10) }));
      const all = new Map<number, ExpiryItem[]>(); const reserved = new Set<number>();
      for (const row of rows) {
        all.set(row.userId, [...(all.get(row.userId) ?? []), { id: row.id, name: row.name, expiration: row.expiration }]);
        const inserted = await client.query(`INSERT INTO notification_deliveries(user_id,inventory_item_id,notification_type,delivery_date)
          VALUES($1,$2,'expiring_inventory',$3) ON CONFLICT(user_id,inventory_item_id,notification_type,delivery_date) DO NOTHING RETURNING id`,
        [row.userId, row.id, today]);
        if (inserted.rowCount) reserved.add(row.userId);
      }
      const result = [];
      for (const userId of reserved) {
        const items = all.get(userId)!; const content = expiryContent(today, items); const groupKey = `expiring:${today}`;
        const existing = (await client.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND group_key=$2
          ORDER BY id DESC LIMIT 1 FOR UPDATE`, [userId, groupKey])).rows[0];
        let notificationId: number;
        if (existing) {
          notificationId = Number(existing.id);
          await client.query(`UPDATE user_notification_inbox SET title=$1,body=$2,inventory_item_id=$3,priority=$4,action_status='pending',
            snoozed_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$5`, [content.title, content.body, content.first.id, content.priority, notificationId]);
        } else notificationId = Number((await client.query(`INSERT INTO user_notification_inbox
          (user_id,type,title,body,inventory_item_id,category,priority,action_status,group_key)
          VALUES($1,'expiring_inventory',$2,$3,$4,'action_required',$5,'pending',$6) RETURNING id`,
        [userId, content.title, content.body, content.first.id, content.priority, groupKey])).rows[0].id);
        for (const item of items) await client.query(`INSERT INTO notification_inventory_items(notification_id,inventory_item_id,user_id)
          VALUES($1,$2,$3) ON CONFLICT(notification_id,inventory_item_id) DO NOTHING`, [notificationId, item.id, userId]);
        await this.event(client, userId, notificationId, existing ? "merged" : "created", { itemCount: items.length, daysUntilExpiry: content.days });
        const tokens = (await client.query("SELECT expo_push_token AS token FROM push_devices WHERE user_id=$1 AND is_active=TRUE", [userId])).rows
          .map((row) => String(row.token));
        result.push({ userId, notificationId, inventoryItemId: content.first.id, title: content.title, body: content.body, tokens });
      }
      return result;
    });
  }

  async markExpiringDeliveries(today: string, statuses: Array<{ userId: number; status: "accepted" | "failed" | "inbox_only" }>) {
    await this.tx(async (client) => {
      for (const item of statuses) await client.query(`UPDATE notification_deliveries SET status=$1 WHERE user_id=$2
        AND notification_type='expiring_inventory' AND delivery_date=$3 AND status='queued'`, [item.status, item.userId, today]);
    });
  }

  private preference(row: Record<string, unknown>): NotificationPreferences {
    return { expiring_alert: Boolean(row.expiring_alert), meal_reminder: Boolean(row.meal_reminder), water_reminder: Boolean(row.water_reminder),
      breakfast_time: String(row.breakfast_time), lunch_time: String(row.lunch_time), dinner_time: String(row.dinner_time),
      water_start_time: String(row.water_start_time), water_end_time: String(row.water_end_time), water_interval_minutes: Number(row.water_interval_minutes),
      quiet_start_time: String(row.quiet_start_time), quiet_end_time: String(row.quiet_end_time), weekdays_enabled: Boolean(row.weekdays_enabled),
      weekends_enabled: Boolean(row.weekends_enabled) };
  }
  private event(executor: PoolClient, userId: number, notificationId: number | null, eventType: string, metadata?: unknown, ticketId?: string | null) {
    return executor.query(`INSERT INTO notification_events(user_id,notification_id,event_type,metadata_json,expo_ticket_id)
      VALUES($1,$2,$3,$4::jsonb,$5)`, [userId, notificationId, eventType, metadata === undefined ? null : JSON.stringify(metadata), ticketId ?? null]);
  }
  private deactivate(executor: PoolClient, token: string) {
    return executor.query("UPDATE push_devices SET is_active=FALSE,updated_at=CURRENT_TIMESTAMP WHERE expo_push_token=$1", [token]);
  }
  private async owner(executor: PoolClient, message: PushMessage) {
    const device = (await executor.query("SELECT user_id AS \"userId\" FROM push_devices WHERE expo_push_token=$1", [message.to])).rows[0];
    if (!device) return null;
    const userId = Number(device.userId); let notificationId: number | null = null;
    if (typeof message.data.inventoryItemId === "number") {
      const row = (await executor.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND inventory_item_id=$2 ORDER BY id DESC LIMIT 1`,
        [userId, message.data.inventoryItemId])).rows[0]; notificationId = row ? Number(row.id) : null;
    } else if (typeof message.data.campaignId === "number") {
      const row = (await executor.query(`SELECT id FROM user_notification_inbox WHERE user_id=$1 AND campaign_id=$2 ORDER BY id DESC LIMIT 1`,
        [userId, message.data.campaignId])).rows[0]; notificationId = row ? Number(row.id) : null;
    }
    return { userId, notificationId };
  }
  private async tx<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
