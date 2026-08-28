import { Router } from "express";
import { deleteUserAgentData } from "../services/agent/repository.js";
import bcrypt from "bcryptjs";
import { db, logAdminAction } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { changePasswordSchema, deleteAccountSchema, loginSchema, profileSchema, registerSchema } from "../validation/schemas.js";
import { sendError } from "../utils/http.js";
import {
  clearLoginFailures,
  loginRateLimit,
  recordLoginFailure,
} from "../middleware/loginRateLimit.js";
import { deleteFunnelEvents, recordFunnelEvent } from "../services/funnelEvents.js";
import { enqueueMediaCleanup, processMediaCleanupJob } from "../services/mediaCleanup.js";
import smsAuthRoutes from "./auth-sms.js";
import { signUserToken } from "../services/sessionTokens.js";
import { ensureUserInitialState } from "../services/userInitialization.js";
import { getRateLimitClientIp, sharedRateLimit } from "../middleware/sharedRateLimit.js";

const router = Router();
router.use("/sms", smsAuthRoutes);

const registrationWindowMs = Math.max(1_000, Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000);
const registrationIpRateLimit = sharedRateLimit({
  namespace: "registration-ip",
  limit: Math.max(1, Number(process.env.REGISTER_RATE_LIMIT) || 12),
  windowMs: registrationWindowMs,
  key: getRateLimitClientIp,
  message: "注册请求过于频繁，请稍后重试",
  code: "REGISTER_RATE_LIMITED",
});
const registrationGlobalRateLimit = sharedRateLimit({
  namespace: "registration-global",
  limit: Math.max(1, Number(process.env.REGISTER_GLOBAL_RATE_LIMIT) || 500),
  windowMs: registrationWindowMs,
  key: () => "all",
  message: "注册服务当前请求过多，请稍后重试",
  code: "REGISTER_RATE_LIMITED",
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^1[3-9]\d{9}$/;

function parseLoginIdentifier(value: unknown) {
  const identifier = String(value || "").trim().toLowerCase();
  if (emailPattern.test(identifier)) return { email: identifier, phone: null };
  if (phonePattern.test(identifier)) return { email: null, phone: identifier };
  return null;
}

// POST /api/v1/auth/register
router.post("/register", registrationIpRateLimit, registrationGlobalRateLimit, validateBody(registerSchema), async (req, res) => {
  try {
    const { identifier, username, password } = req.body;
    const loginIdentifier = parseLoginIdentifier(identifier);
    if (!loginIdentifier) return sendError(res, 400, "请输入有效的邮箱或手机号", "INVALID_IDENTIFIER");
    if (loginIdentifier.phone) {
      return sendError(res, 400, "手机号注册必须先完成短信验证", "PHONE_VERIFICATION_REQUIRED");
    }

    // Check existing
    const existing = db.prepare("SELECT id FROM users WHERE email = ? OR phone = ?").get(loginIdentifier.email, loginIdentifier.phone);
    if (existing) {
      return sendError(res, 409, "该邮箱或手机号已注册", "IDENTIFIER_EXISTS");
    }
    const usernameTaken = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username);
    if (usernameTaken) return sendError(res, 409, "该用户名已被使用", "USERNAME_EXISTS");

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    const userId = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (username, email, phone, password_hash, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `).run(username, loginIdentifier.email, loginIdentifier.phone, passwordHash, null);
      const createdUserId = Number(result.lastInsertRowid);
      ensureUserInitialState(createdUserId);
      return createdUserId;
    })();
    const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target FROM users WHERE id = ?").get(userId);

    const token = signUserToken(userId);
    recordFunnelEvent(userId, "account_registered");

    return res.status(201).json({ token, user });
  } catch (error) {
    console.error("Register error:", error);
    return sendError(res, 500, "注册失败", "REGISTER_FAILED");
  }
});

// POST /api/v1/auth/login
router.post("/login", loginRateLimit, validateBody(loginSchema), async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const rawIdentifier = String(identifier || "").trim().toLowerCase();
    const loginIdentifier = parseLoginIdentifier(rawIdentifier);
    const isAdminUsername = rawIdentifier === "admin";
    if ((!loginIdentifier && !isAdminUsername) || !password) {
      recordLoginFailure(req);
      return sendError(res, 400, "请输入管理员账号，或注册时的邮箱/手机号", "INVALID_IDENTIFIER");
    }

    const loginUserSelect = `
      SELECT id, username, email, phone, password_hash, avatar_url, bio, role,
        must_change_password, daily_calories_target, created_at, is_disabled,
        is_verified_expert, last_login_at, last_login_ip
      FROM users
    `;
    const user: any = isAdminUsername
      ? db.prepare(`${loginUserSelect} WHERE username = ? AND role = 'admin'`).get(rawIdentifier)
      : db.prepare(`${loginUserSelect} WHERE email = ? OR phone = ?`).get(
          loginIdentifier?.email,
          loginIdentifier?.phone,
        );
    if (!user) {
      recordLoginFailure(req);
      return sendError(res, 401, "账号、邮箱、手机号或密码错误", "INVALID_CREDENTIALS");
    }

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) {
      recordLoginFailure(req);
      return sendError(res, 401, "账号、邮箱、手机号或密码错误", "INVALID_CREDENTIALS");
    }
    if (user.is_disabled === 1) {
      return sendError(res, 403, "账号已被停用", "ACCOUNT_DISABLED");
    }

    ensureUserInitialState(user.id);

    clearLoginFailures(rawIdentifier);
    // Express resolves req.ip according to the configured trust-proxy hop count.
    // Never read X-Forwarded-For directly: without a trusted proxy boundary it
    // is attacker-controlled and would poison login/security audit records.
    const clientIp = getRateLimitClientIp(req);
    const nowIso = new Date().toISOString();
    db.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?").run(nowIso, clientIp, user.id);

    const token = signUserToken(user.id);
    if (user.role !== "admin") recordFunnelEvent(user.id, "login_succeeded");
    if (user.role === "admin") {
      logAdminAction({
        adminUserId: user.id,
        action: "auth.login",
        resourceType: "session",
        resourceId: user.id,
        summary: "管理员登录成功",
        ipAddress: clientIp,
        userAgent: req.get("user-agent"),
      });
    }

    const { password_hash, ...userInfo } = user;
    userInfo.last_login_at = nowIso;
    userInfo.last_login_ip = clientIp;
    res.json({ token, user: userInfo });
  } catch (error) {
    console.error("Login error:", error);
    return sendError(res, 500, "登录失败", "LOGIN_FAILED");
  }
});

// GET /api/v1/auth/me
router.get("/me", authMiddleware, (req: AuthRequest, res) => {
  const user = db.prepare("SELECT id, username, email, phone, phone_verified_at, avatar_url, bio, daily_calories_target, created_at, role, must_change_password, last_login_at, last_login_ip FROM users WHERE id = ?").get(req.userId);
  if (!user) return sendError(res, 404, "用户不存在", "USER_NOT_FOUND");
  return res.json(user);
});

// POST /api/v1/auth/change-password
router.post("/change-password", authMiddleware, validateBody(changePasswordSchema), (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "当前密码和新密码不能为空" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "新密码长度不能少于 6 位" });
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return res.status(400).json({ error: "新密码必须同时包含字母和数字" });
    }

    const user = db.prepare("SELECT username, role, password_hash FROM users WHERE id = ?").get(req.userId) as
      | { username: string; role: string; password_hash: string }
      | undefined;
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: "当前密码不正确" });
    }
    if (bcrypt.compareSync(newPassword, user.password_hash)) {
      return res.status(400).json({ error: "新密码不能与当前密码相同" });
    }

    const passwordHash = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(12));
    db.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = 0, session_version = session_version + 1
      WHERE id = ?
    `).run(passwordHash, req.userId);
    if (user.role === "admin" && req.userId) {
      logAdminAction({
        adminUserId: req.userId,
        action: "auth.password.change",
        resourceType: "user",
        resourceId: req.userId,
        summary: `管理员 ${user.username} 修改密码`,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
    }

    return res.json({ success: true, message: "密码修改成功" });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ error: "修改密码失败" });
  }
});

// PUT /api/v1/auth/profile
router.put("/profile", authMiddleware, validateBody(profileSchema), (req: AuthRequest, res) => {
  try {
    const { username, avatar_url, bio, daily_calories_target } = req.body;
    if (username) {
      const existing = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?").get(username, req.userId);
      if (existing) return sendError(res, 409, "该用户名已被使用", "USERNAME_EXISTS");
    }

    db.prepare(`
      UPDATE users
      SET username = COALESCE(?, username),
          avatar_url = COALESCE(?, avatar_url),
          bio = COALESCE(?, bio),
          daily_calories_target = COALESCE(?, daily_calories_target)
      WHERE id = ?
    `).run(username, avatar_url, bio, daily_calories_target, req.userId);

    const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target, role FROM users WHERE id = ?").get(req.userId);
    return res.json(user);
  } catch (error) {
    console.error("Profile update error:", error);
    return sendError(res, 500, "更新资料失败", "PROFILE_UPDATE_FAILED");
  }
});

router.get("/ai-data", authMiddleware, (req: AuthRequest, res) => {
  const messages = db.prepare(`
    SELECT session_id, role, content, source, status, response_time_ms,
           payload_json, created_at
    FROM ai_chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC
  `).all(req.userId);
  const scanJobs = db.prepare(`
    SELECT id, status, result_json, error_message, created_at, updated_at
    FROM inventory_scan_jobs WHERE user_id = ? ORDER BY created_at ASC
  `).all(req.userId);
  const agentRuns = db.prepare("SELECT * FROM agent_runs WHERE user_id = ? ORDER BY created_at ASC").all(req.userId);
  const agentEvents = db.prepare("SELECT e.* FROM agent_run_events e JOIN agent_runs r ON r.id = e.run_id WHERE r.user_id = ? ORDER BY e.created_at ASC, e.sequence ASC").all(req.userId);
  const agentActions = db.prepare("SELECT a.* FROM agent_actions a JOIN agent_runs r ON r.id = a.run_id WHERE r.user_id = ? ORDER BY a.created_at ASC").all(req.userId);
  const agentMediaReferences = db.prepare("SELECT id, run_id, kind, mime_type, created_at FROM agent_run_media WHERE user_id = ? ORDER BY created_at ASC").all(req.userId);
  const checkpointTableExists = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'").get());
  const checkpoints = checkpointTableExists ? db.prepare(`SELECT c.thread_id, c.checkpoint_ns, c.checkpoint_id, c.parent_checkpoint_id, c.type,
    CAST(c.checkpoint AS TEXT) AS checkpoint_json, CAST(c.metadata AS TEXT) AS metadata_json
    FROM checkpoints c JOIN agent_runs r ON r.checkpoint_thread_id = c.thread_id WHERE r.user_id = ? ORDER BY c.checkpoint_id ASC`).all(req.userId) : [];
  const checkpointWrites = checkpointTableExists ? db.prepare(`SELECT w.thread_id, w.checkpoint_ns, w.checkpoint_id, w.task_id, w.idx, w.channel, w.type,
    CAST(w.value AS TEXT) AS value_json FROM writes w JOIN agent_runs r ON r.checkpoint_thread_id = w.thread_id
    WHERE r.user_id = ? ORDER BY w.checkpoint_id ASC, w.idx ASC`).all(req.userId) : [];
  return res.json({ exported_at: new Date().toISOString(), messages, scan_jobs: scanJobs, agent_runs: agentRuns, agent_events: agentEvents, agent_actions: agentActions, agent_media_references: agentMediaReferences, agent_checkpoints: checkpoints, agent_checkpoint_writes: checkpointWrites });
});

router.delete("/ai-data", authMiddleware, (req: AuthRequest, res) => {
  const deleted = db.transaction(() => ({
    messages: db.prepare("DELETE FROM ai_chat_messages WHERE user_id = ?").run(req.userId).changes,
    scan_jobs: db.prepare("DELETE FROM inventory_scan_jobs WHERE user_id = ?").run(req.userId).changes,
    usage_logs: db.prepare("DELETE FROM ai_usage_logs WHERE user_id = ?").run(req.userId).changes,
    write_confirmations: db.prepare("DELETE FROM ai_write_confirmations WHERE user_id = ?").run(req.userId).changes,
    chat_session_deletions: db.prepare("DELETE FROM ai_chat_session_deletions WHERE user_id = ?").run(req.userId).changes,
    agent_runs: deleteUserAgentData(req.userId!),
  }))();
  return res.json({ success: true, deleted });
});

// DELETE /api/v1/auth/account - permanently delete the signed-in user's data.
router.delete("/account", authMiddleware, validateBody(deleteAccountSchema), async (req: AuthRequest, res) => {
  try {
    const user = db.prepare("SELECT role, password_hash FROM users WHERE id = ?").get(req.userId) as
      | { role: string; password_hash: string }
      | undefined;
    if (!user) return sendError(res, 404, "用户不存在", "USER_NOT_FOUND");
    if (user.role === "admin") {
      return sendError(res, 403, "管理员账号不能通过客户端注销", "ADMIN_ACCOUNT_DELETE_FORBIDDEN");
    }
    if (!bcrypt.compareSync(req.body.password, user.password_hash)) {
      return sendError(res, 400, "当前密码不正确", "INVALID_PASSWORD");
    }

    const postMedia = db.prepare("SELECT image_url, image_urls FROM community_posts WHERE user_id = ?").all(req.userId) as Array<{ image_url: string | null; image_urls: string | null }>;
    const commentMedia = db.prepare("SELECT image_url FROM community_comments WHERE user_id = ?").all(req.userId) as Array<{ image_url: string | null }>;
    const mediaUrls = [
      ...postMedia.flatMap((post) => [post.image_url, ...parseStoredUrlList(post.image_urls)]),
      ...commentMedia.map((comment) => comment.image_url),
    ];
    const result = db.transaction(() => {
      prepareHouseholdsForAccountDeletion(req.userId!);
      deleteFunnelEvents(req.userId!);
      const cleanupJobId = enqueueMediaCleanup(req.userId!, mediaUrls);
      const deleted = db.prepare("DELETE FROM users WHERE id = ?").run(req.userId);
      return { deleted, cleanupJobId };
    })();
    if (!result.deleted.changes) return sendError(res, 404, "用户不存在", "USER_NOT_FOUND");
    if (result.cleanupJobId) {
      try {
        await processMediaCleanupJob(result.cleanupJobId);
      } catch (error) {
        console.error(`Media cleanup job ${result.cleanupJobId} will be retried:`, error);
      }
    }
    return res.json({ success: true, message: "账号及关联数据已永久删除" });
  } catch (error) {
    console.error("Delete account error:", error);
    return sendError(res, 500, "账号删除失败", "ACCOUNT_DELETE_FAILED");
  }
});

function parseStoredUrlList(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function prepareHouseholdsForAccountDeletion(userId: number) {
  const ownedHouseholds = db.prepare(`
    SELECT h.id
    FROM households h
    WHERE h.owner_id = ?
    ORDER BY h.id
  `).all(userId) as Array<{ id: number }>;

  for (const household of ownedHouseholds) {
    const successor = db.prepare(`
      SELECT hm.user_id
      FROM household_members hm
      WHERE hm.household_id = ? AND hm.user_id <> ?
      ORDER BY hm.joined_at ASC, hm.id ASC
      LIMIT 1
    `).get(household.id, userId) as { user_id: number } | undefined;

    if (!successor) {
      db.prepare("DELETE FROM households WHERE id = ?").run(household.id);
      continue;
    }

    db.prepare("UPDATE households SET owner_id = ?, version = version + 1 WHERE id = ?")
      .run(successor.user_id, household.id);
    db.prepare("UPDATE household_members SET role = CASE WHEN user_id = ? THEN 'owner' ELSE 'member' END WHERE household_id = ?")
      .run(successor.user_id, household.id);
  }

  const retainedHouseholds = db.prepare(`
    SELECT hm.household_id, h.owner_id AS replacement_user_id
    FROM household_members hm
    JOIN households h ON h.id = hm.household_id
    WHERE hm.user_id = ?
  `).all(userId) as Array<{ household_id: number; replacement_user_id: number }>;

  for (const household of retainedHouseholds) {
    const { household_id: householdId, replacement_user_id: replacementUserId } = household;
    db.prepare("UPDATE household_inventory_items SET created_by_user_id = ? WHERE household_id = ? AND created_by_user_id = ?")
      .run(replacementUserId, householdId, userId);
    db.prepare("UPDATE household_activity_logs SET operator_user_id = ? WHERE household_id = ? AND operator_user_id = ?")
      .run(replacementUserId, householdId, userId);
    db.prepare("UPDATE household_shopping_items SET created_by_user_id = ? WHERE household_id = ? AND created_by_user_id = ?")
      .run(replacementUserId, householdId, userId);
    db.prepare("UPDATE household_shopping_items SET updated_by_user_id = ? WHERE household_id = ? AND updated_by_user_id = ?")
      .run(replacementUserId, householdId, userId);
    db.prepare("UPDATE household_shopping_intake_batches SET user_id = ? WHERE household_id = ? AND user_id = ?")
      .run(replacementUserId, householdId, userId);
    db.prepare(`
      UPDATE inventory_outcome_events
      SET idempotency_key = 'deleted-account:' || ? || ':' || id
      WHERE household_id = ? AND created_by_user_id = ?
    `).run(userId, householdId, userId);
    db.prepare("UPDATE inventory_outcome_events SET created_by_user_id = ? WHERE household_id = ? AND created_by_user_id = ?")
      .run(replacementUserId, householdId, userId);
    db.prepare("UPDATE inventory_outcome_events SET updated_by_user_id = ? WHERE household_id = ? AND updated_by_user_id = ?")
      .run(replacementUserId, householdId, userId);
    db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?")
      .run(householdId, userId);
  }
}

export default router;
