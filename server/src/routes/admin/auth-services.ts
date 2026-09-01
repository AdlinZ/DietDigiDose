import crypto from "node:crypto";
import { Router } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { db } from "../../storage/db.js";
import { sendError } from "../../utils/http.js";
import {
  decryptSubjectPhone,
  findOrCreateSmsSubject,
  getClientIp,
  getSmsServiceConfig,
  incrementDailyUsage,
  normalizeMainlandPhone,
  recordVerificationEvent,
  type VerificationSubjectRow,
} from "../../services/authVerification.js";
import { maskMainlandPhone, verificationSubjectHmac } from "../../services/authVerificationCrypto.js";
import { getSmsProvider, SMS_PROVIDER, smsCredentialsStatus } from "../../services/smsVerificationProvider.js";
import { dateKeyAfterDays } from "../../utils/date.js";
import { auditAdminAction } from "./shared.js";

const SETTINGS: Record<string, string> = {
  enabled: "auth.sms.enabled",
  signName: "auth.sms.sign_name",
  templateCode: "auth.sms.template_code",
  packageTotal: "auth.sms.package_total",
  packageBaselineRemaining: "auth.sms.package_baseline_remaining",
  packageBaselineAt: "auth.sms.package_baseline_at",
  phoneHourlyLimit: "auth.sms.limit.phone_hour",
  phoneDailyLimit: "auth.sms.limit.phone_day",
  ipHourlyLimit: "auth.sms.limit.ip_hour",
  ipDailyLimit: "auth.sms.limit.ip_day",
  globalDailyLimit: "auth.sms.limit.global_day",
};

function saveSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

function eventSubject(row: Record<string, unknown>): VerificationSubjectRow {
  return {
    id: Number(row.subjectId),
    user_id: row.userId == null ? null : Number(row.userId),
    subject_hmac: String(row.subjectHmac),
    subject_ciphertext: String(row.subjectCiphertext),
    subject_iv: String(row.subjectIv),
    subject_auth_tag: String(row.subjectAuthTag),
  };
}

export function createAdminAuthServicesRouter() {
  const router = Router();

  router.get("/auth-services/sms/config", (_req, res) => {
    const config = getSmsServiceConfig();
    const credentials = smsCredentialsStatus();
    const recent = db.prepare(`
      SELECT event_type AS eventType, outcome, provider_code AS providerCode, created_at AS createdAt
      FROM auth_verification_events
      WHERE channel = 'sms' AND event_type IN ('send_accepted', 'send_rejected', 'send_failed')
      ORDER BY id DESC LIMIT 1
    `).get() || null;
    return res.json({
      ...config,
      provider: SMS_PROVIDER,
      endpoint: process.env.ALIYUN_DYPNS_ENDPOINT?.trim() || "dypnsapi.aliyuncs.com",
      credentials,
      callbackConfigured: Boolean(process.env.ALIYUN_SMS_CALLBACK_TOKEN?.trim()),
      auditEncryptionConfigured: Boolean(process.env.AUTH_AUDIT_ENCRYPTION_KEY?.trim()),
      fixedParameters: { countryCode: "86", codeLength: 6, validTime: 300, interval: 60, duplicatePolicy: 1, returnVerifyCode: false },
      recent,
    });
  });

  router.put("/auth-services/sms/config", async (req: AuthRequest, res) => {
    const body = req.body || {};
    const allowed = ["enabled", "signName", "templateCode", "packageTotal", "phoneHourlyLimit", "phoneDailyLimit", "ipHourlyLimit", "ipDailyLimit", "globalDailyLimit"];
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) return sendError(res, 400, `不支持的配置项：${key}`, "INVALID_SMS_CONFIG");
    }
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return sendError(res, 400, "服务开关格式无效", "INVALID_SMS_CONFIG");
    if (body.enabled === true && !smsCredentialsStatus().configured) {
      return sendError(res, 409, "请先在部署环境配置阿里云 AccessKey", "SMS_CREDENTIALS_REQUIRED");
    }
    if (body.enabled === true && !process.env.AUTH_AUDIT_ENCRYPTION_KEY?.trim()) {
      return sendError(res, 409, "请先在部署环境配置认证审计加密密钥", "SMS_AUDIT_KEY_REQUIRED");
    }
    for (const key of ["signName", "templateCode"]) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > 100)) {
        return sendError(res, 400, `${key} 格式无效`, "INVALID_SMS_CONFIG");
      }
    }
    for (const key of ["packageTotal", "phoneHourlyLimit", "phoneDailyLimit", "ipHourlyLimit", "ipDailyLimit", "globalDailyLimit"]) {
      if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < (key === "packageTotal" ? 0 : 1) || body[key] > 1_000_000)) {
        return sendError(res, 400, `${key} 格式无效`, "INVALID_SMS_CONFIG");
      }
    }
    db.transaction(() => {
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        const value = key === "enabled" ? (body[key] ? "1" : "0") : String(body[key]).trim();
        saveSetting(SETTINGS[key], value);
      }
    })();
    await auditAdminAction(req, {
      action: "auth.sms.config.update",
      resourceType: "auth_service",
      resourceId: "sms",
      summary: "更新短信认证服务配置",
      details: { fields: Object.keys(body) },
    });
    return res.json({ success: true, config: getSmsServiceConfig() });
  });

  router.post("/auth-services/sms/test-send", async (req: AuthRequest, res) => {
    const phone = normalizeMainlandPhone(req.body?.phone);
    if (!phone) return sendError(res, 400, "请输入有效的中国大陆手机号", "INVALID_PHONE");
    const config = getSmsServiceConfig();
    if (!config.enabled) return sendError(res, 409, "请先启用短信认证服务", "SMS_SERVICE_DISABLED");
    if (!smsCredentialsStatus().configured) return sendError(res, 503, "阿里云密钥未在部署环境中配置", "SMS_SERVICE_NOT_CONFIGURED");
    const subject = findOrCreateSmsSubject(phone);
    const challengeId = crypto.randomUUID();
    const outId = `test_${crypto.randomUUID().replace(/-/g, "")}`;
    const sourceIp = getClientIp(req);
    db.prepare(`
      INSERT INTO auth_verification_challenges (id, subject_id, purpose, out_id, status, expires_at, source_ip, user_agent)
      VALUES (?, ?, 'admin_test', ?, 'pending', ?, ?, ?)
    `).run(challengeId, subject.id, outId, new Date(Date.now() + 5 * 60_000).toISOString(), sourceIp, req.get("user-agent") || null);
    incrementDailyUsage("send_requests");
    incrementDailyUsage("send_api_calls");
    recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "send_api_called", outcome: "admin_test", sourceIp, userAgent: req.get("user-agent"), outId });
    try {
      const result = await getSmsProvider().send(phone, outId, config);
      db.prepare(`
        UPDATE auth_verification_challenges SET status = ?, biz_id = ?, provider_request_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(result.success ? "accepted" : "failed", result.bizId, result.requestId, challengeId);
      incrementDailyUsage(result.success ? "accepted" : "provider_errors");
      recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: result.success ? "send_accepted" : "send_rejected", outcome: result.success ? "accepted" : "provider_error", providerCode: result.code, providerMessage: result.message, providerRequestId: result.requestId, bizId: result.bizId, outId, sourceIp, userAgent: req.get("user-agent") });
      await auditAdminAction(req, { action: "auth.sms.test_send", resourceType: "auth_service", resourceId: challengeId, summary: `测试发送短信至 ${maskMainlandPhone(phone)}`, details: { success: result.success, providerCode: result.code } });
      if (!result.success) {
        const providerMessage = result.message.replace(/\b1[3-9]\d{9}\b/g, "[phone]").slice(0, 300);
        return sendError(
          res,
          502,
          `测试短信发送失败：${result.code}${providerMessage ? ` · ${providerMessage}` : ""}`,
          "SMS_PROVIDER_REJECTED",
        );
      }
      return res.json({ success: true, challengeId, phoneMasked: maskMainlandPhone(phone), bizId: result.bizId, requestId: result.requestId });
    } catch (error) {
      const providerErrorName = error instanceof Error ? error.name : "UNKNOWN_ERROR";
      const providerErrorMessage = error instanceof Error
        ? error.message.replace(/\b1[3-9]\d{9}\b/g, "[phone]").slice(0, 500)
        : "Unknown SMS provider error";
      console.error("[SMS test send error]", {
        name: providerErrorName,
        message: providerErrorMessage,
        stack: error instanceof Error
          ? error.stack?.replace(/\b1[3-9]\d{9}\b/g, "[phone]").split("\n").slice(0, 8).join("\n")
          : undefined,
      });
      db.prepare("UPDATE auth_verification_challenges SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(challengeId);
      incrementDailyUsage("provider_errors");
      recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "send_failed", outcome: "provider_error", providerCode: providerErrorName, providerMessage: providerErrorMessage, outId, sourceIp, userAgent: req.get("user-agent") });
      return sendError(res, 502, `测试短信发送失败：${providerErrorMessage}`, "SMS_PROVIDER_UNAVAILABLE");
    }
  });

  router.get("/auth-services/sms/overview", (req, res) => {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    const firstUsageDate = dateKeyAfterDays(-(days - 1));
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(send_requests), 0) AS sendRequests,
        COALESCE(SUM(send_api_calls), 0) AS sendApiCalls,
        COALESCE(SUM(accepted), 0) AS accepted,
        COALESCE(SUM(delivered), 0) AS delivered,
        COALESCE(SUM(delivery_failed), 0) AS deliveryFailed,
        COALESCE(SUM(verify_api_calls), 0) AS verifyApiCalls,
        COALESCE(SUM(verify_passed), 0) AS verifyPassed,
        COALESCE(SUM(verify_failed), 0) AS verifyFailed,
        COALESCE(SUM(local_rate_limited), 0) AS rateLimited,
        COALESCE(SUM(provider_errors), 0) AS providerErrors,
        COALESCE(SUM(delivery_units), 0) AS deliveryUnits
      FROM auth_verification_usage_daily
      WHERE channel = 'sms' AND provider = ? AND usage_date >= ?
    `).get(SMS_PROVIDER, firstUsageDate) as Record<string, number>;
    const daily = db.prepare(`
      SELECT usage_date AS date, send_api_calls AS sendApiCalls, accepted, delivered,
             delivery_failed AS deliveryFailed, verify_passed AS verifyPassed,
             verify_failed AS verifyFailed, local_rate_limited AS rateLimited,
             provider_errors AS providerErrors, delivery_units AS deliveryUnits
      FROM auth_verification_usage_daily
      WHERE channel = 'sms' AND provider = ? AND usage_date >= ?
      ORDER BY usage_date ASC
    `).all(SMS_PROVIDER, firstUsageDate);
    const config = getSmsServiceConfig();
    const usedSinceBaseline = (db.prepare(`
      SELECT COALESCE(SUM(delivery_units), 0) AS count
      FROM auth_verification_usage_daily
      WHERE channel = 'sms' AND provider = ? AND (? IS NULL OR usage_date >= date(?))
    `).get(SMS_PROVIDER, config.packageBaselineAt, config.packageBaselineAt) as { count: number }).count;
    const attacks = db.prepare(`
      SELECT source_ip AS ip, COUNT(*) AS blocked
      FROM auth_verification_events
      WHERE event_type = 'send_rate_limited' AND created_at >= datetime('now', ?)
      GROUP BY source_ip ORDER BY blocked DESC LIMIT 10
    `).all(`-${days} days`);
    return res.json({
      days,
      totals,
      daily,
      attacks,
      package: {
        total: config.packageTotal,
        baselineRemaining: config.packageBaselineRemaining,
        baselineAt: config.packageBaselineAt,
        usedSinceBaseline,
        estimatedRemaining: Math.max(0, config.packageBaselineRemaining - usedSinceBaseline),
      },
    });
  });

  router.get("/auth-services/sms/events", (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(10, Math.min(100, Number(req.query.pageSize) || 20));
    const conditions: string[] = ["e.channel = 'sms'"];
    const params: Array<string | number> = [];
    const stringFilter = (name: string) => typeof req.query[name] === "string" ? String(req.query[name]).trim() : "";
    const userId = stringFilter("userId");
    const username = stringFilter("username");
    const phone = stringFilter("phone");
    const ip = stringFilter("ip");
    const outcome = stringFilter("outcome");
    const providerId = stringFilter("providerId");
    if (userId) { conditions.push("u.id = ?"); params.push(Number(userId) || -1); }
    if (username) { conditions.push("u.username LIKE ?"); params.push(`%${username}%`); }
    if (phone) {
      const normalized = normalizeMainlandPhone(phone);
      if (!normalized) return sendError(res, 400, "完整手机号格式无效", "INVALID_PHONE_FILTER");
      conditions.push("s.subject_hmac = ?"); params.push(verificationSubjectHmac(normalized));
    }
    if (ip) { conditions.push("e.source_ip = ?"); params.push(ip); }
    if (outcome) { conditions.push("e.outcome = ?"); params.push(outcome); }
    if (providerId) { conditions.push("(e.biz_id = ? OR e.out_id = ? OR e.provider_request_id = ?)"); params.push(providerId, providerId, providerId); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const total = (db.prepare(`
      SELECT COUNT(*) AS count FROM auth_verification_events e
      JOIN auth_verification_subjects s ON s.id = e.subject_id
      LEFT JOIN users u ON u.id = s.user_id ${where}
    `).get(...params) as { count: number }).count;
    const rows = db.prepare(`
      SELECT e.id, e.subject_id AS subjectId, e.challenge_id AS challengeId,
             e.event_type AS eventType, e.outcome, e.provider_code AS providerCode,
             e.provider_message AS providerMessage, e.provider_request_id AS providerRequestId,
             e.biz_id AS bizId, e.out_id AS outId, e.source_ip AS sourceIp,
             e.created_at AS createdAt, u.id AS userId, u.username, u.is_disabled AS userDisabled,
             s.subject_hmac AS subjectHmac, s.subject_ciphertext AS subjectCiphertext,
             s.subject_iv AS subjectIv, s.subject_auth_tag AS subjectAuthTag
      FROM auth_verification_events e
      JOIN auth_verification_subjects s ON s.id = e.subject_id
      LEFT JOIN users u ON u.id = s.user_id
      ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
    const items = rows.map((row) => {
      const phoneMasked = maskMainlandPhone(decryptSubjectPhone(eventSubject(row)));
      const { subjectHmac: _h, subjectCiphertext: _c, subjectIv: _i, subjectAuthTag: _t, ...safe } = row;
      return { ...safe, phoneMasked, userStatus: row.userId == null ? "unregistered" : row.userDisabled === 1 ? "disabled" : "active" };
    });
    return res.json({ items, total, page, pageSize });
  });

  router.post("/auth-services/sms/events/:id/reveal-phone", async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "事件 ID 无效", "INVALID_EVENT_ID");
    const row = db.prepare(`
      SELECT e.id, s.id AS subjectId, s.user_id AS userId, s.subject_hmac AS subjectHmac,
             s.subject_ciphertext AS subjectCiphertext, s.subject_iv AS subjectIv,
             s.subject_auth_tag AS subjectAuthTag
      FROM auth_verification_events e
      JOIN auth_verification_subjects s ON s.id = e.subject_id WHERE e.id = ?
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) return sendError(res, 404, "认证事件不存在", "AUTH_EVENT_NOT_FOUND");
    const phone = decryptSubjectPhone(eventSubject(row));
    await auditAdminAction(req, {
      action: "auth.sms.phone.reveal",
      resourceType: "auth_verification_event",
      resourceId: id,
      summary: `查看认证事件 ${id} 的完整手机号`,
      details: { subjectId: row.subjectId, userId: row.userId || null },
    });
    return res.json({ eventId: id, phone });
  });

  router.post("/auth-services/sms/package/reconcile", async (req: AuthRequest, res) => {
    const remaining = Number(req.body?.remaining);
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > 10_000_000) {
      return sendError(res, 400, "套餐剩余量格式无效", "INVALID_PACKAGE_REMAINING");
    }
    const nowIso = new Date().toISOString();
    saveSetting(SETTINGS.packageBaselineRemaining, String(remaining));
    saveSetting(SETTINGS.packageBaselineAt, nowIso);
    await auditAdminAction(req, { action: "auth.sms.package.reconcile", resourceType: "auth_service", resourceId: "sms", summary: `校准短信套餐剩余量为 ${remaining}`, details: { remaining } });
    return res.json({ success: true, remaining, reconciledAt: nowIso });
  });

  return router;
}
