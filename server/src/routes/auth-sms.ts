import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { sendError } from "../utils/http.js";
import { ensureUserInitialState, recordFunnelEvent, signUserToken } from "../modules/accessControl/index.js";
import { authVerificationService } from "../modules/authVerification/runtime.js";
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

router.post("/send", async (req, res) => {
  const phone = normalizeMainlandPhone(req.body?.phone);
  if (!phone) return sendError(res, 400, "请输入有效的中国大陆手机号", "INVALID_PHONE");

  const config = await getSmsServiceConfig();
  if (!config.enabled) return sendError(res, 503, "短信认证服务暂未启用", "SMS_SERVICE_DISABLED");
  if (!smsCredentialsStatus().configured) {
    return sendError(res, 503, "短信认证服务尚未完成密钥配置", "SMS_SERVICE_NOT_CONFIGURED");
  }

  const sourceIp = getClientIp(req);
  const userAgent = req.get("user-agent") || null;
  const subject = await findOrCreateSmsSubject(phone);
  await incrementDailyUsage("send_requests");
  await recordVerificationEvent({
    subjectId: subject.id,
    eventType: "send_requested",
    outcome: "received",
    sourceIp,
    userAgent,
  });

  const [subjectHour, subjectDay, ipHour, ipDay, globalDay] = await Promise.all([
    countSubjectSends(subject.id, "-1 hour"), countSubjectSends(subject.id, "-1 day"),
    countIpSends(sourceIp, "-1 hour"), countIpSends(sourceIp, "-1 day"), currentGlobalDailySends(),
  ]);
  const limited = subjectHour >= config.phoneHourlyLimit || subjectDay >= config.phoneDailyLimit
    || ipHour >= config.ipHourlyLimit || ipDay >= config.ipDailyLimit || globalDay >= config.globalDailyLimit;
  if (limited) {
    await incrementDailyUsage("local_rate_limited");
    await recordVerificationEvent({
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
  await authVerificationService().createChallenge({ id: challengeId, subjectId: subject.id, purpose: "login",
    outId, expiresAt, sourceIp, userAgent });
  await incrementDailyUsage("send_api_calls");
  await recordVerificationEvent({
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
      await authVerificationService().failChallenge(challengeId);
      await incrementDailyUsage("provider_errors");
      await recordVerificationEvent({
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

    await authVerificationService().acceptChallenge(challengeId, subject.id, result.bizId, result.requestId);
    await incrementDailyUsage("accepted");
    await recordVerificationEvent({
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
    return res.status(201).json({
      challengeId,
      phoneMasked: maskedSubjectPhone(subject),
      expiresIn: 300,
      resendAfter: 60,
    });
  } catch (error) {
    await authVerificationService().failChallenge(challengeId);
    await incrementDailyUsage("provider_errors");
    await recordVerificationEvent({
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

  const challenge = await authVerificationService().challenge(challengeId) as ChallengeRow | null;
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
    await authVerificationService().expireChallenge(challengeId);
    await recordVerificationEvent({ subjectId: challenge.subject_id, challengeId, eventType: "verify_rejected", outcome: "expired", sourceIp, userAgent, outId: challenge.out_id });
    return sendError(res, 410, "验证码已过期，请重新获取", "SMS_CODE_EXPIRED");
  }
  if (!await authVerificationService().beginVerification(challengeId)) {
    return sendError(res, 429, "验证码尝试次数过多，请重新获取", "SMS_VERIFY_LIMITED");
  }

  const subject = challengeSubject(challenge);
  const phone = decryptSubjectPhone(subject);
  await incrementDailyUsage("verify_api_calls");
  await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_api_called", outcome: "pending", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });

  try {
    const result = await getSmsProvider().verify(phone, challenge.out_id, code);
    if (!result.success) {
      await authVerificationService().restoreVerification(challengeId);
      await incrementDailyUsage("provider_errors");
      await recordVerificationEvent({
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
      await authVerificationService().rejectVerification(challengeId);
      await incrementDailyUsage("verify_failed");
      await recordVerificationEvent({
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

    await incrementDailyUsage("verify_passed");
    const user = await authVerificationService().userByPhone(phone);
    const nowIso = new Date().toISOString();
    if (user) {
      await authVerificationService().completeLogin({ userId: user.id, subjectId: subject.id, challengeId, at: nowIso, sourceIp });
      await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_passed", outcome: "passed", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
      await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "login", outcome: user.is_disabled ? "account_disabled" : "succeeded", sourceIp, userAgent });
      if (user.is_disabled === 1 || user.is_disabled === true) return sendError(res, 403, "账号已被停用", "ACCOUNT_DISABLED");
      await ensureUserInitialState(user.id);
      await recordFunnelEvent(user.id, "login_succeeded");
      return res.json({
        status: "authenticated",
        token: await signUserToken(user.id),
        user: await authVerificationService().userResponse(user.id),
      });
    }

    const registrationToken = crypto.randomBytes(32).toString("base64url");
    const registrationExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await authVerificationService().markRegistrationRequired({ challengeId, at: nowIso,
      tokenHash: hashRegistrationToken(registrationToken), expiresAt: registrationExpiresAt });
    await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_passed", outcome: "registration_required", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
    return res.json({
      status: "registration_required",
      registrationToken,
      phoneMasked: maskedSubjectPhone(subject),
      expiresIn: 600,
    });
  } catch (error) {
    await authVerificationService().restoreVerification(challengeId);
    await incrementDailyUsage("provider_errors");
    await recordVerificationEvent({ subjectId: subject.id, challengeId, eventType: "verify_failed", outcome: "provider_error", providerCode: error instanceof Error ? error.name : "UNKNOWN_ERROR", sourceIp, userAgent, outId: challenge.out_id, bizId: challenge.biz_id });
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
    const challenge = await authVerificationService().registrationChallenge(tokenHash);
    if (!challenge) throw new Error("REGISTRATION_TOKEN_INVALID");
    const phone = decryptSubjectPhone(challengeSubject(challenge));
    const result = await authVerificationService().register({ tokenHash, phone, username,
      passwordHash: bcrypt.hashSync(password, bcrypt.genSaltSync(12)), at: new Date().toISOString() });
    if (result.status === "invalid_token") throw new Error("REGISTRATION_TOKEN_INVALID");
    if (result.status === "phone_exists") throw new Error("PHONE_EXISTS");
    if (result.status === "username_exists") throw new Error("USERNAME_EXISTS");
    const newUserId = result.userId;
    await recordVerificationEvent({ subjectId: challenge.subject_id, challengeId: challenge.id, eventType: "registration", outcome: "succeeded", sourceIp, userAgent });
    await recordFunnelEvent(newUserId, "account_registered");
    return res.status(201).json({
      token: await signUserToken(newUserId),
      user: await authVerificationService().userResponse(newUserId),
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
