import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, logAdminAction } from "../storage/db.js";
import { JWT_SECRET } from "../config/security.js";
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
import { deleteStoredMediaUrls } from "../services/mediaStorage.js";

const router = Router();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^1[3-9]\d{9}$/;

function parseLoginIdentifier(value: unknown) {
  const identifier = String(value || "").trim().toLowerCase();
  if (emailPattern.test(identifier)) return { email: identifier, phone: null };
  if (phonePattern.test(identifier)) return { email: null, phone: identifier };
  return null;
}

// POST /api/v1/auth/register
router.post("/register", validateBody(registerSchema), async (req, res) => {
  try {
    const { identifier, username, password } = req.body;
    const loginIdentifier = parseLoginIdentifier(identifier);
    if (!loginIdentifier) return sendError(res, 400, "请输入有效的邮箱或手机号", "INVALID_IDENTIFIER");

    // Check existing
    const existing = db.prepare("SELECT id FROM users WHERE email = ? OR phone = ?").get(loginIdentifier.email, loginIdentifier.phone);
    if (existing) {
      return sendError(res, 409, "该邮箱或手机号已注册", "IDENTIFIER_EXISTS");
    }
    const usernameTaken = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username);
    if (usernameTaken) return sendError(res, 409, "该用户名已被使用", "USERNAME_EXISTS");

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    const result = db.prepare(`
      INSERT INTO users (username, email, phone, password_hash, avatar_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, loginIdentifier.email, loginIdentifier.phone, passwordHash, null);

    const userId = Number(result.lastInsertRowid);
    const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target FROM users WHERE id = ?").get(userId);

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
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

    clearLoginFailures(rawIdentifier);
    const clientIp = (req.headers["x-forwarded-for"] as string || req.ip || req.socket.remoteAddress || "").split(",")[0].trim();
    const nowIso = new Date().toISOString();
    db.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?").run(nowIso, clientIp, user.id);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
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
  const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target, created_at, role, must_change_password, last_login_at, last_login_ip FROM users WHERE id = ?").get(req.userId);
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
      SET password_hash = ?, must_change_password = 0
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
    SELECT session_id, role, content, created_at
    FROM ai_chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC
  `).all(req.userId);
  const scanJobs = db.prepare(`
    SELECT id, status, result_json, error_message, created_at, updated_at
    FROM inventory_scan_jobs WHERE user_id = ? ORDER BY created_at ASC
  `).all(req.userId);
  return res.json({ exported_at: new Date().toISOString(), messages, scan_jobs: scanJobs });
});

router.delete("/ai-data", authMiddleware, (req: AuthRequest, res) => {
  const deleted = db.transaction(() => ({
    messages: db.prepare("DELETE FROM ai_chat_messages WHERE user_id = ?").run(req.userId).changes,
    scan_jobs: db.prepare("DELETE FROM inventory_scan_jobs WHERE user_id = ?").run(req.userId).changes,
    usage_logs: db.prepare("DELETE FROM ai_usage_logs WHERE user_id = ?").run(req.userId).changes,
    write_confirmations: db.prepare("DELETE FROM ai_write_confirmations WHERE user_id = ?").run(req.userId).changes,
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
    await deleteStoredMediaUrls(req.userId!, mediaUrls);

    const result = db.transaction(() => {
      deleteFunnelEvents(req.userId!);
      return db.prepare("DELETE FROM users WHERE id = ?").run(req.userId);
    })();
    if (!result.changes) return sendError(res, 404, "用户不存在", "USER_NOT_FOUND");
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

export default router;
