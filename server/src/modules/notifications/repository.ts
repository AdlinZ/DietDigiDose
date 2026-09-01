import type {
  AdminNotificationData,
  CampaignDelivery,
  CampaignStart,
  ExpoTicket,
  NotificationAction,
  NotificationFilter,
  NotificationPreferences,
  PreparedExpiryNotification,
  PushMessage,
  PushReceiptCandidate,
  PushReceiptResult,
} from "./types.js";

export interface NotificationsRepository {
  preferences(userId: number): Promise<NotificationPreferences | null>;
  savePreferences(userId: number, preferences: NotificationPreferences): Promise<void>;
  saveDevice(userId: number, token: string, platform: string): Promise<void>;
  ensureRoutineNotification(input: {
    userId: number; kind: "meal" | "water"; key: string; dateKey: string; title: string; body: string;
  }): Promise<void>;
  unreadCount(userId: number): Promise<number>;
  history(userId: number, filter: NotificationFilter, cursor: number | null, limit: number): Promise<Array<Record<string, unknown>>>;
  readAll(userId: number): Promise<number>;
  read(userId: number, notificationId: number): Promise<boolean>;
  action(userId: number, notificationId: number, action: NotificationAction, metadata?: unknown): Promise<boolean>;
  localEvent(input: { userId: number; kind: string; title: string; body: string; event: string; sourceId?: string }): Promise<number>;
  adminData(since: string): Promise<AdminNotificationData>;
  beginCampaign(adminUserId: number, title: string, body: string): Promise<CampaignStart>;
  finishCampaign(campaignId: number, deliveries: CampaignDelivery[], success: number, failure: number): Promise<void>;
  failCampaign(campaignId: number, failureCount: number): Promise<void>;
  recordPushTickets(entries: Array<{ message: PushMessage; ticket: ExpoTicket }>): Promise<void>;
  pendingReceipts(before: string, limit: number): Promise<PushReceiptCandidate[]>;
  applyReceipts(receipts: PushReceiptResult[]): Promise<void>;
  prepareExpiring(today: string, deadline: string): Promise<PreparedExpiryNotification[]>;
  markExpiringDeliveries(today: string, statuses: Array<{ userId: number; status: "accepted" | "failed" | "inbox_only" }>): Promise<void>;
}
