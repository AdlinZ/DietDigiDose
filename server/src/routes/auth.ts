import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, logAdminAction } from "../storage/db.js";
import { JWT_SECRET } from "../config/security.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
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
router.post("/register", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const loginIdentifier = parseLoginIdentifier(identifier);
    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: "请输入有效的邮箱或手机号，以及密码" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "密码长度不能少于6位" });
    }

    // Check existing
    const existing = db.prepare("SELECT id FROM users WHERE email = ? OR phone = ? OR username = ?").get(loginIdentifier.email, loginIdentifier.phone, identifier.trim().toLowerCase());
    if (existing) {
      return res.status(400).json({ error: "该邮箱或手机号已注册" });
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

    res.json({ token, user });
  } catch (error: any) {
    console.error("Register error:", error);
    res.status(500).json({ error: error.message || "注册失败" });
  }
});

// POST /api/v1/auth/login
router.post("/login", loginRateLimit, async (req, res) => {
  try {
    const { identifier, username, password } = req.body;
    const rawIdentifier = String(identifier || username || "").trim().toLowerCase();
    const loginIdentifier = parseLoginIdentifier(rawIdentifier);
    const isAdminUsername = rawIdentifier === "admin";
    if ((!loginIdentifier && !isAdminUsername) || !password) {
      recordLoginFailure(req);
      return res.status(400).json({ error: "请输入管理员账号，或注册时的邮箱/手机号，以及密码" });
    }

    const user: any = isAdminUsername
      ? db.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin'").get(rawIdentifier)
      : db.prepare("SELECT * FROM users WHERE email = ? OR phone = ?").get(
          loginIdentifier?.email,
          loginIdentifier?.phone,
        );
    if (!user) {
      recordLoginFailure(req);
      return res.status(400).json({ error: "账号、邮箱、手机号或密码错误" });
    }

    const validPassword = bcrypt.compareSync(password, user.password_hash);
    if (!validPassword) {
      recordLoginFailure(req);
      return res.status(400).json({ error: "账号、邮箱、手机号或密码错误" });
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
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ error: error.message || "登录失败" });
  }
});

// GET /api/v1/auth/me
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "未登录" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };

    const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target, created_at, role, must_change_password, last_login_at, last_login_ip FROM users WHERE id = ?").get(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: "用户不存在" });
    }

    res.json(user);
  } catch (error: any) {
    return res.status(401).json({ error: "无效或过期的token" });
  }
});

// POST /api/v1/auth/change-password
router.post("/change-password", authMiddleware, (req: AuthRequest, res) => {
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
router.put("/profile", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "未登录" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };

    const { avatar_url, bio, daily_calories_target } = req.body;

    db.prepare(`
      UPDATE users
      SET avatar_url = COALESCE(?, avatar_url),
          bio = COALESCE(?, bio),
          daily_calories_target = COALESCE(?, daily_calories_target)
      WHERE id = ?
    `).run(avatar_url, bio, daily_calories_target, decoded.userId);

    const user = db.prepare("SELECT id, username, email, phone, avatar_url, bio, daily_calories_target, role FROM users WHERE id = ?").get(decoded.userId);
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "更新资料失败" });
  }
});

export default router;
