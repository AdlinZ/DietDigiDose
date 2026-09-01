import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../storage/db.js";
import { sendError } from "../utils/http.js";
import { ensureUserInitialState, recordFunnelEvent, signUserToken } from "../modules/accessControl/index.js";
import {
  countIpSends,
  countSubjectSends,
  currentGlobalDailySends,
  decryptSubjectPhone,
  findOrCreateSmsSubject,
  getClientIp,
  getSmsServiceConfig,
  incrementDailyUsage,
  maskedSubjectPhone,
  normalizeMainlandPhone,
  recordVerificationEvent,
  type VerificationSubjectRow,
} from "../services/authVerification.js";
import { hashRegistrationToken } from "../services/authVerificationCrypto.js";
import { getSmsProvider, smsCredentialsStatus } from "../services/smsVerificationProvider.js";

const router = Router();

type ChallengeRow = {
  id: string;
  subject_id: number;
  purpose: string;
  out_id: string;
  biz_id: string | null;
  status: string;
  attempt_count: number;
  expires_at: string;
  registration_expires_at: string | null;
  user_id: number | null;
  subject_hmac: string;
  subject_ciphertext: string;
  subject_iv: string;
  subject_auth_tag: string;
};

function challengeSubject(row: ChallengeRow): VerificationSubjectRow {
  return {
    id: row.subject_id,
    user_id: row.user_id,
    subject_hmac: row.subject_hmac,
    subject_ciphertext: row.subject_ciphertext,
    subject_iv: row.subject_iv,
    subject_auth_tag: row.subject_auth_tag,
  };
}

function userResponse(userId: number) {
  return db.prepare(`
    SELECT id, username, email, phone, avatar_url, bio, role, daily_calories_target,
           created_at, phone_verified_at, last_login_at, last_login_ip
    FROM users WHERE id = ?
  `).get(userId);
}

router.post("/send", async (req, res) => {
  const phone = normalizeMainlandPhone(req.body?.phone);
  if (!phone) return sendError(res, 400, "请输入有效的中国大陆手机号", "INVALID_PHONE");

  const config = getSmsServiceConfig();
  if (!config.enabled) return sendError(res, 503, "短信认证服务暂未启用", "SMS_SERVICE_DISABLED");
  if (!smsCredentialsStatus().configured) {
    return sendError(res, 503, "短信认证服务尚未完成密钥配置", "SMS_SERVICE_NOT_CONFIGURED");
  }

  const sourceIp = getClientIp(req);
  const userAgent = req.get("user-agent") || null;
  const subject = findOrCreateSmsSubject(phone);
  incrementDailyUsage("send_requests");
  recordVerificationEvent({
    subjectId: subject.id,
    eventType: "send_requested",
    outcome: "received",
    sourceIp,
    userAgent,
  });

  const limited =
    countSubjectSends(subject.id, "-1 hour") >= config.phoneHourlyLimit
    || countSubjectSends(subject.id, "-1 day") >= config.phoneDailyLimit
    || countIpSends(sourceIp, "-1 hour") >= config.ipHourlyLimit
    || countIpSends(sourceIp, "-1 day") >= config.ipDailyLimit
    || currentGlobalDailySends() >= config.globalDailyLimit;
  if (limited) {
    incrementDailyUsage("local_rate_limited");
    recordVerificationEvent({
      subjectId: subject.id,
      eventType: "send_rate_limited",
      outcome: "blocked",
      sourceIp,
      userAgent,
    });
    res.setHeader("Retry-After", "3600");
    return sendError(res, 429, "验证码请求过于频繁，请稍后再试", "SMS_RATE_LIMITED");
  }

  const challengeId = crypto.randomUUID();
  const outId = `sms_${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  db.prepare(`
    INSERT INTO auth_verification_challenges (
      id, subject_id, purpose, out_id, status, expires_at, source_ip, user_agent
    ) VALUES (?, ?, 'login', ?, 'pending', ?, ?, ?)
  `).run(challengeId, subject.id, outId, expiresAt, sourceIp, userAgent);
  incrementDailyUsage("send_api_calls");
  recordVerificationEvent({
    subjectId: subject.id,
    challengeId,
    eventType: "send_api_called",
    outcome: "pending",
    sourceIp,
    userAgent,
    outId,
  });

  try {
    const result = await getSmsProvider().send(phone, outId, config);
    if (!result.success) {
      db.prepare("UPDATE auth_verification_challenges SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(challengeId);
      incrementDailyUsage("provider_errors");
      recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "send_rejected",
        outcome: "provider_error",
        providerCode: result.code,
        providerMessage: result.message,
        providerRequestId: result.requestId,
        bizId: result.bizId,
        outId,
        sourceIp,
        userAgent,
      });
      return sendError(res, 502, "短信发送失败，请稍后重试", "SMS_PROVIDER_REJECTED");
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE auth_verification_challenges
        SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
        WHERE subject_id = ? AND id != ? AND status IN ('pending', 'accepted')
      `).run(subject.id, challengeId);
      db.prepare(`
        UPDATE auth_verification_challenges
        SET status = 'accepted', biz_id = ?, provider_request_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(result.bizId, result.requestId, challengeId);
      incrementDailyUsage("accepted");
      recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "send_accepted",
        outcome: "accepted",
        providerCode: result.code,
        providerMessage: result.message,
        providerRequestId: result.requestId,
        bizId: result.bizId,
        outId,
        sourceIp,
        userAgent,
      });
    })();
    return res.status(201).json({
      challengeId,
      phoneMasked: maskedSubjectPhone(subject),
      expiresIn: 300,
      resendAfter: 60,
    });
  } catch (error) {
    db.prepare("UPDATE auth_verification_challenges SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(challengeId);
    incrementDailyUsage("provider_errors");
    recordVerificationEvent({
      subjectId: subject.id,
      challengeId,
      eventType: "send_failed",
      outcome: "provider_error",
      providerCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      outId,
      sourceIp,
      userAgent,
    });
    console.error("[SMS Provider Error]", error instanceof Error ? error.name : "UnknownError");
    return sendError(res, 502, "短信发送失败，请稍后重试", "SMS_PROVIDER_UNAVAILABLE");
  }
});

router.post("/verify", async (req, res) => {
  const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId.trim() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!challengeId || !/^\d{6}$/.test(code)) {
    return sendError(res, 400, "请输入 6 位数字验证码", "INVALID_VERIFICATION_INPUT");
  }

  const challenge = db.prepare(`
    SELECT c.*, s.user_id, s.subject_hmac, s.subject_ciphertext, s.subject_iv, s.subject_auth_tag
    FROM auth_verification_challenges c
    JOIN auth_verification_subjects s ON s.id = c.subject_id
    WHERE c.id = ?
  `).get(challengeId) as ChallengeRow | undefined;
  if (!challenge) return sendError(res, 404, "验证码请求不存在", "SMS_CHALLENGE_NOT_FOUND");
  if (challenge.purpose !== "login") return sendError(res, 403, "该验证码仅用于管理员测试", "SMS_CHALLENGE_PURPOSE_MISMATCH");

  const sourceIp = getClientIp(req);
  const userAgent = req.get("user-agent") || null;
  if (challenge.attempt_count >= 5) {
    return sendError(res, 429, "验证码尝试次数过多，请重新获取", "SMS_VERIFY_LIMITED");
  }
  if (!["accepted", "pending"].includes(challenge.status)) {
    return sendError(res, 409, "该验证码已失效，请重新获取", "SMS_CHALLENGE_NOT_ACTIVE");
  }
  if (Date.parse(challenge.expires_at) <= Date.now()) {
    db.prepare("UPDATE auth_verification_challenges SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(challengeId);
    recordVerificationEvent({ subjectId: challenge.subject_id, challengeId, eventType: "verify_rejected", outcome: "expired", sourceIp, userAgent, outId: challenge.out_id });
    return sendError(res, 410, "验证码已过期，请重新获取", "SMS_CODE_EXPIRED");
  }
  const attemptUpdate = db.prepare(`
    UPDATE auth_verification_challenges
    SET attempt_count = attempt_count + 1, status = 'verifying', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND attempt_count < 5 AND status IN ('pending', 'accepted')
  `).run(challengeId);
  if (attemptUpdate.changes !== 1) {
    return sendError(res, 429, "验证码尝试次数过多，请重新获取", "SMS_VERIFY_LIMITED");
  }

  const subject = challengeSubject(challenge);
  const phone = decryptSubjectPhone(subject);
  incrementDailyUsage("verify_api_calls");
  recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_api_called", outcome: "pending", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });

  try {
    const result = await getSmsProvider().verify(phone, challenge.out_id, code);
    if (!result.success) {
      db.prepare(`
        UPDATE auth_verification_challenges
        SET attempt_count = MAX(0, attempt_count - 1), status = 'accepted',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'verifying'
      `).run(challengeId);
      incrementDailyUsage("provider_errors");
      recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "verify_failed",
        outcome: "provider_error",
        providerCode: result.code,
        providerMessage: result.message,
        sourceIp,
        userAgent,
        outId: challenge.out_id,
        bizId: challenge.biz_id,
      });
      return sendError(res, 502, "验证码核验服务暂时不可用", "SMS_VERIFY_UNAVAILABLE");
    }
    if (!result.passed) {
      db.prepare(`
        UPDATE auth_verification_challenges
        SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'accepted' END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'verifying'
      `).run(challengeId);
      incrementDailyUsage("verify_failed");
      recordVerificationEvent({
        subjectId: subject.id,
        challengeId,
        eventType: "verify_failed",
        outcome: "mismatch",
        providerCode: result.code,
        providerMessage: result.message,
        sourceIp,
        userAgent,
        outId: challenge.out_id,
        bizId: challenge.biz_id,
      });
      return sendError(res, 401, "验证码错误或已失效", "SMS_CODE_INVALID");
    }

    incrementDailyUsage("verify_passed");
    const user = db.prepare("SELECT id, is_disabled FROM users WHERE phone = ?").get(phone) as { id: number; is_disabled: number } | undefined;
    const nowIso = new Date().toISOString();
    if (user) {
      db.transaction(() => {
        db.prepare("UPDATE auth_verification_subjects SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id, subject.id);
        db.prepare("UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, ?), last_login_at = ?, last_login_ip = ? WHERE id = ?").run(nowIso, nowIso, sourceIp, user.id);
        db.prepare("UPDATE auth_verification_challenges SET status = 'consumed', verified_at = ?, consumed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nowIso, nowIso, challengeId);
        recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_passed", outcome: "passed", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
        recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "login", outcome: user.is_disabled ? "account_disabled" : "succeeded", sourceIp, userAgent });
      })();
      if (user.is_disabled === 1) return sendError(res, 403, "账号已被停用", "ACCOUNT_DISABLED");
      await ensureUserInitialState(user.id);
      await recordFunnelEvent(user.id, "login_succeeded");
      return res.json({
        status: "authenticated",
        token: await signUserToken(user.id),
        user: userResponse(user.id),
      });
    }

    const registrationToken = crypto.randomBytes(32).toString("base64url");
    const registrationExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    db.transaction(() => {
      db.prepare(`
        UPDATE auth_verification_challenges
        SET status = 'verified', verified_at = ?, registration_token_hash = ?,
            registration_expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nowIso, hashRegistrationToken(registrationToken), registrationExpiresAt, challengeId);
      recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_passed", outcome: "registration_required", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
    })();
    return res.json({
      status: "registration_required",
      registrationToken,
      phoneMasked: maskedSubjectPhone(subject),
      expiresIn: 600,
    });
  } catch (error) {
    db.prepare(`
      UPDATE auth_verification_challenges
      SET attempt_count = MAX(0, attempt_count - 1), status = 'accepted',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'verifying'
    `).run(challengeId);
    incrementDailyUsage("provider_errors");
    recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_failed", outcome: "provider_error", providerCode: error instanceof Error ? error.name : "UNKNOWN_ERROR", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
    console.error("[SMS Verify Provider Error]", error instanceof Error ? error.name : "UnknownError");
    return sendError(res, 502, "验证码核验服务暂时不可用", "SMS_VERIFY_UNAVAILABLE");
  }
});

router.post("/register", async (req, res) => {
  const registrationToken = typeof req.body?.registrationToken === "string" ? req.body.registrationToken : "";
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (registrationToken.length < 32) return sendError(res, 400, "注册凭证无效", "INVALID_REGISTRATION_TOKEN");
  if (username.length < 2 || username.length > 30) return sendError(res, 400, "用户名长度应为 2 至 30 位", "INVALID_USERNAME");
  if (password.length < 6 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return sendError(res, 400, "备用密码至少 6 位，且必须包含字母和数字", "INVALID_PASSWORD");
  }

  const tokenHash = hashRegistrationToken(registrationToken);
  const sourceIp = getClientIp(req);
  const userAgent = req.get("user-agent") || null;
  try {
    let newUserId = 0;
    db.transaction(() => {
      const challenge = db.prepare(`
        SELECT c.*, s.user_id, s.subject_hmac, s.subject_ciphertext, s.subject_iv, s.subject_auth_tag
        FROM auth_verification_challenges c
        JOIN auth_verification_subjects s ON s.id = c.subject_id
        WHERE c.registration_token_hash = ? AND c.status = 'verified'
          AND c.consumed_at IS NULL AND datetime(c.registration_expires_at) > datetime('now')
      `).get(tokenHash) as ChallengeRow | undefined;
      if (!challenge) throw new Error("REGISTRATION_TOKEN_INVALID");
      const phone = decryptSubjectPhone(challengeSubject(challenge));
      if (db.prepare("SELECT id FROM users WHERE phone = ?").get(phone)) throw new Error("PHONE_EXISTS");
      if (db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username)) throw new Error("USERNAME_EXISTS");

      const nowIso = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO users (username, email, phone, password_hash, avatar_url, phone_verified_at)
        VALUES (?, NULL, ?, ?, NULL, ?)
      `).run(username, phone, bcrypt.hashSync(password, bcrypt.genSaltSync(12)), nowIso);
      newUserId = Number(result.lastInsertRowid);
      // The SQLite adapter executes this idempotent insert synchronously so it remains part of the registration transaction.
      void ensureUserInitialState(newUserId);
      db.prepare("UPDATE auth_verification_subjects SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newUserId, challenge.subject_id);
      db.prepare("UPDATE auth_verification_challenges SET status = 'consumed', consumed_at = ?, registration_token_hash = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nowIso, challenge.id);
      recordVerificationEvent({ subjectId: challenge.subject_id, challengeId: challenge.id, eventType: "registration", outcome: "succeeded", sourceIp, userAgent });
    })();
    await recordFunnelEvent(newUserId, "account_registered");
    return res.status(201).json({
      token: await signUserToken(newUserId),
      user: userResponse(newUserId),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "USERNAME_EXISTS") return sendError(res, 409, "该用户名已被使用", "USERNAME_EXISTS");
    if (code === "PHONE_EXISTS") return sendError(res, 409, "该手机号已注册，请直接登录", "PHONE_EXISTS");
    if (code === "REGISTRATION_TOKEN_INVALID") return sendError(res, 401, "注册凭证已失效，请重新验证手机号", "REGISTRATION_TOKEN_INVALID");
    if (String(error).includes("UNIQUE constraint failed: users.phone")) return sendError(res, 409, "该手机号已注册，请直接登录", "PHONE_EXISTS");
    console.error("[SMS Registration Error]", error instanceof Error ? error.name : "UnknownError");
    return sendError(res, 500, "注册失败", "REGISTER_FAILED");
  }
});

export default router;
