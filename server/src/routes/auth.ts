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
    const { identifier, password } = req.body;
    const loginIdentifier = parseLoginIdentifier(identifier);
    if (!loginIdentifier) return sendError(res, 400, "请输入有效的邮箱或手机号", "INVALID_IDENTIFIER");

    // Check existing
    const existing = db.prepare("SELECT id FROM users WHERE email = ? OR phone = ? OR username = ?").get(loginIdentifier.email, loginIdentifier.phone, identifier.trim().toLowerCase());
    if (existing) {
      return sendError(res, 409, "该邮箱或手机号已注册", "IDENTIFIER_EXISTS");
    }

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    const result = db.prepare(`
      INSERT INTO users (username, email, phone, password_hash, avatar_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(identifier.trim().toLowerCase(), loginIdentifier.email, loginIdentifier.phone, passwordHash, null);

    const userId = Number(result.lastInsertRowid);
    const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target FROM users WHERE id = ?").get(userId);

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });

    return res.status(201).json({ token, user });
  } catch (error) {
    console.error("Register error:", error);
    return sendError(res, 500, "注册失败", "REGISTER_FAILED");
  }
});

// POST /api/v1/auth/login
router.post("/login", loginRateLimit, validateBody(loginSchema), async (req, res) => {
  try {
    const { identifier, username, password } = req.body;
    const rawIdentifier = String(identifier || username || "").trim().toLowerCase();
    const loginIdentifier = parseLoginIdentifier(rawIdentifier);
    const isAdminUsername = rawIdentifier === "admin";
    if ((!loginIdentifier && !isAdminUsername) || !password) {
      recordLoginFailure(req);
      return sendError(res, 400, "请输入管理员账号，或注册时的邮箱/手机号", "INVALID_IDENTIFIER");
    }

    const user: any = isAdminUsername
      ? db.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin'").get(rawIdentifier)
      : db.prepare("SELECT * FROM users WHERE email = ? OR phone = ?").get(
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

    clearLoginFailures(rawIdentifier);
    const clientIp = (req.headers["x-forwarded-for"] as string || req.ip || req.socket.remoteAddress || "").split(",")[0].trim();
    const nowIso = new Date().toISOString();
    db.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?").run(nowIso, clientIp, user.id);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
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
    if (typeof newPassword !== "string" || newPassword.length < 12) {
      return res.status(400).json({ error: "新密码长度不能少于 12 位" });
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
    const { avatar_url, bio, daily_calories_target } = req.body;

    db.prepare(`
      UPDATE users
      SET avatar_url = COALESCE(?, avatar_url),
          bio = COALESCE(?, bio),
          daily_calories_target = COALESCE(?, daily_calories_target)
      WHERE id = ?
    `).run(avatar_url, bio, daily_calories_target, req.userId);

    const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target, role FROM users WHERE id = ?").get(req.userId);
    return res.json(user);
  } catch (error) {
    console.error("Profile update error:", error);
    return sendError(res, 500, "更新资料失败", "PROFILE_UPDATE_FAILED");
  }
});

// DELETE /api/v1/auth/account - permanently delete the signed-in user's data.
router.delete("/account", authMiddleware, validateBody(deleteAccountSchema), (req: AuthRequest, res) => {
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

    const result = db.prepare("DELETE FROM users WHERE id = ?").run(req.userId);
    if (!result.changes) return sendError(res, 404, "用户不存在", "USER_NOT_FOUND");
    return res.json({ success: true, message: "账号及关联数据已永久删除" });
  } catch (error) {
    console.error("Delete account error:", error);
    return sendError(res, 500, "账号删除失败", "ACCOUNT_DELETE_FAILED");
  }
});

export default router;
