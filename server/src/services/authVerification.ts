import type { Request } from "express";
import { getProviderProfile } from "../providers/profiles.js";
import { db, getSystemSetting } from "../storage/db.js";
import { currentDateKey } from "../utils/date.js";
import {
  decryptVerificationSubject,
  encryptVerificationSubject,
  maskMainlandPhone,
  verificationSubjectHmac,
} from "./authVerificationCrypto.js";
import { defaultSmsEnabled, SMS_PROVIDER, type SmsServiceConfig } from "./smsVerificationProvider.js";

export type VerificationSubjectRow = {
  id: number;
  user_id: number | null;
  subject_hmac: string;
  subject_ciphertext: string;
  subject_iv: string;
  subject_auth_tag: string;
};

function numberSetting(key: string, fallback: number, min = 0, max = 1_000_000) {
  const value = Number(getSystemSetting(key, String(fallback)));
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export function getSmsServiceConfig(): SmsServiceConfig {
  return {
    enabled: getProviderProfile().providers.auth === SMS_PROVIDER
      && getSystemSetting("auth.sms.enabled", defaultSmsEnabled() ? "1" : "0") === "1",
    signName: getSystemSetting("auth.sms.sign_name", process.env.ALIYUN_SMS_SIGN_NAME?.trim() || "恒创联众"),
    templateCode: getSystemSetting("auth.sms.template_code", process.env.ALIYUN_SMS_TEMPLATE_CODE?.trim() || "100001"),
    packageTotal: numberSetting("auth.sms.package_total", 1000, 0),
    packageBaselineRemaining: numberSetting("auth.sms.package_baseline_remaining", 1000, 0),
    packageBaselineAt: getSystemSetting("auth.sms.package_baseline_at", "") || null,
    phoneHourlyLimit: numberSetting("auth.sms.limit.phone_hour", 5, 1, 1000),
    phoneDailyLimit: numberSetting("auth.sms.limit.phone_day", 10, 1, 1000),
    ipHourlyLimit: numberSetting("auth.sms.limit.ip_hour", 20, 1, 10000),
    ipDailyLimit: numberSetting("auth.sms.limit.ip_day", 50, 1, 10000),
    globalDailyLimit: numberSetting("auth.sms.limit.global_day", 100, 1, 1_000_000),
  };
}

export function normalizeMainlandPhone(value: unknown) {
  const raw = String(value || "").replace(/[\s-]/g, "").replace(/^\+?86/, "");
  return /^1[3-9]\d{9}$/.test(raw) ? raw : null;
}

export function getClientIp(req: Request) {
  // Express only applies forwarded addresses to req.ip when the deployment has
  // explicitly enabled `trust proxy`; never trust the raw client header here.
  return String(req.ip || req.socket.remoteAddress || "").trim().slice(0, 100);
}

export function findOrCreateSmsSubject(phone: string): VerificationSubjectRow {
  const hmac = verificationSubjectHmac(phone);
  const existing = db.prepare(`
    SELECT * FROM auth_verification_subjects
    WHERE channel = 'sms' AND provider = ? AND subject_hmac = ?
  `).get(SMS_PROVIDER, hmac) as VerificationSubjectRow | undefined;
  if (existing) {
    db.prepare("UPDATE auth_verification_subjects SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id);
    return existing;
  }
  const encrypted = encryptVerificationSubject(phone);
  const result = db.prepare(`
    INSERT INTO auth_verification_subjects (
      channel, provider, subject_hmac, subject_ciphertext, subject_iv, subject_auth_tag
    ) VALUES ('sms', ?, ?, ?, ?, ?)
  `).run(SMS_PROVIDER, hmac, encrypted.ciphertext, encrypted.iv, encrypted.authTag);
  return db.prepare("SELECT * FROM auth_verification_subjects WHERE id = ?").get(result.lastInsertRowid) as VerificationSubjectRow;
}

export function decryptSubjectPhone(subject: VerificationSubjectRow) {
  return decryptVerificationSubject({
    ciphertext: subject.subject_ciphertext,
    iv: subject.subject_iv,
    authTag: subject.subject_auth_tag,
  });
}

export function maskedSubjectPhone(subject: VerificationSubjectRow) {
  return maskMainlandPhone(decryptSubjectPhone(subject));
}

type EventInput = {
  subjectId: number;
  challengeId?: string | null;
  eventType: string;
  outcome: string;
  providerCode?: string | null;
  providerMessage?: string | null;
  providerRequestId?: string | null;
  bizId?: string | null;
  outId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
};

export function recordVerificationEvent(input: EventInput) {
  const safeProviderMessage = input.providerMessage
    ?.replace(/\b1[3-9]\d{9}\b/g, "[phone]")
    .slice(0, 500) || null;
  return db.prepare(`
    INSERT INTO auth_verification_events (
      subject_id, challenge_id, channel, provider, event_type, outcome,
      provider_code, provider_message, provider_request_id, biz_id, out_id,
      source_ip, user_agent, details_json
    ) VALUES (?, ?, 'sms', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.subjectId,
    input.challengeId || null,
    SMS_PROVIDER,
    input.eventType,
    input.outcome,
    input.providerCode || null,
    safeProviderMessage,
    input.providerRequestId || null,
    input.bizId || null,
    input.outId || null,
    input.sourceIp || null,
    input.userAgent?.slice(0, 500) || null,
    input.details ? JSON.stringify(input.details) : null,
  );
}

export type UsageCounter =
  | "send_requests" | "send_api_calls" | "accepted" | "delivered" | "delivery_failed"
  | "verify_api_calls" | "verify_passed" | "verify_failed" | "local_rate_limited"
  | "provider_errors" | "delivery_units";

export function incrementDailyUsage(counter: UsageCounter, amount = 1) {
  const usageDate = currentDateKey();
  db.prepare(`
    INSERT INTO auth_verification_usage_daily (usage_date, channel, provider, ${counter})
    VALUES (?, 'sms', ?, ?)
    ON CONFLICT(usage_date, channel, provider) DO UPDATE SET
      ${counter} = ${counter} + excluded.${counter},
      updated_at = CURRENT_TIMESTAMP
  `).run(usageDate, SMS_PROVIDER, amount);
}

export function countSubjectSends(subjectId: number, sinceModifier: string) {
  return (db.prepare(`
    SELECT COUNT(*) AS count FROM auth_verification_events
    WHERE subject_id = ? AND event_type = 'send_api_called' AND created_at >= datetime('now', ?)
  `).get(subjectId, sinceModifier) as { count: number }).count;
}

export function countIpSends(ip: string, sinceModifier: string) {
  return (db.prepare(`
    SELECT COUNT(*) AS count FROM auth_verification_events
    WHERE source_ip = ? AND event_type = 'send_api_called' AND created_at >= datetime('now', ?)
  `).get(ip, sinceModifier) as { count: number }).count;
}

export function currentGlobalDailySends() {
  return (db.prepare(`
    SELECT COALESCE(send_api_calls, 0) AS count FROM auth_verification_usage_daily
    WHERE usage_date = ? AND channel = 'sms' AND provider = ?
  `).get(currentDateKey(), SMS_PROVIDER) as { count: number } | undefined)?.count || 0;
}
