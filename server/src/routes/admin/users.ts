import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../../storage/db.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { adminExpertSchema, adminRoleSchema, adminUserCredentialsSchema, adminUserStatusSchema } from "../../validation/schemas.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { auditAdminAction as audit } from "./shared.js";

const router = Router();
router.param("id", positiveIntegerParam);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^1[3-9]\d{9}$/;

// 2. 获取用户列表
router.get("/users", (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, email, phone, nickname, avatar_url, role, is_verified_expert, COALESCE(is_disabled, 0) as is_disabled, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "获取用户列表失败" });
  }
});

// 修改普通用户的登录账号，或由管理员重置其密码。密码明文永不返回或写入审计日志。
router.put("/users/:id/credentials", validateBody(adminUserCredentialsSchema), (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    const target = db.prepare("SELECT id, username, email, phone, role FROM users WHERE id = ?").get(userId) as
      | { id: number; username: string; email: string | null; phone: string | null; role: string }
      | undefined;
    if (!target) return res.status(404).json({ error: "未找到该用户" });
    if (target.role === "admin") {
      return res.status(403).json({ error: "管理员账号请通过修改密码页自行维护" });
    }

    const { identifier, newPassword } = req.body;
    let nextIdentifier: { username: string; email: string | null; phone: string | null } | undefined;
    if (identifier !== undefined) {
      const normalized = identifier.trim().toLowerCase();
      if (emailPattern.test(normalized)) {
        nextIdentifier = { username: normalized, email: normalized, phone: null };
      } else if (phonePattern.test(normalized)) {
        nextIdentifier = { username: normalized, email: null, phone: normalized };
      } else {
        return res.status(400).json({ error: "账号必须是有效的邮箱或中国大陆手机号" });
      }
      const existing = db.prepare("SELECT id FROM users WHERE (username = ? OR email = ? OR phone = ?) AND id != ?")
        .get(nextIdentifier.username, nextIdentifier.email, nextIdentifier.phone, userId);
      if (existing) return res.status(409).json({ error: "该邮箱或手机号已被其他账号使用" });
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    if (nextIdentifier) {
      updates.push("username = ?", "email = ?", "phone = ?");
      params.push(nextIdentifier.username, nextIdentifier.email, nextIdentifier.phone);
    }
    if (newPassword !== undefined) {
      updates.push("password_hash = ?", "must_change_password = 0");
      params.push(bcrypt.hashSync(newPassword, bcrypt.genSaltSync(12)));
    }
    params.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    audit(req, {
      action: "user.credentials.update",
      resourceType: "user",
      resourceId: userId,
      summary: `更新用户 ${target.username} 的登录信息`,
      details: { identifierUpdated: Boolean(nextIdentifier), passwordReset: newPassword !== undefined },
    });
    const user = db.prepare("SELECT id, username, email, phone FROM users WHERE id = ?").get(userId);
    return res.json({ success: true, user });
  } catch (error) {
    console.error("[Admin User Credentials Update Error]", error);
    return res.status(500).json({ error: "更新用户登录信息失败" });
  }
});

// 3. 修改用户角色
router.put("/users/:id/role", validateBody(adminRoleSchema), (req: AuthRequest, res) => {
  try {
    const { role } = req.body;
    const userId = Number(req.params.id);
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: "无效的角色类型" });
    }

    // 不允许取消自己的 admin 权限（防止误操作导致没有管理员）
    if (Number(userId) === (req as any).userId && role !== 'admin') {
      return res.status(400).json({ error: "不能取消自身的管理员权限" });
    }

    const previous = db.prepare("SELECT username, role FROM users WHERE id = ?").get(userId) as
      | { username: string; role: string }
      | undefined;
    const stmt = db.prepare(`UPDATE users SET role = ? WHERE id = ?`);
    const info = stmt.run(role, userId);
    
    if (info.changes > 0) {
      audit(req, {
        action: "user.role.update",
        resourceType: "user",
        resourceId: userId,
        summary: `修改用户 ${previous?.username || userId} 的角色`,
        details: { before: previous?.role, after: role },
      });
      res.json({ success: true, message: "角色更新成功" });
    } else {
      res.status(404).json({ error: "未找到该用户" });
    }
  } catch (error) {
    res.status(500).json({ error: "更新用户角色失败" });
  }
});

router.put("/users/:id/expert", validateBody(adminExpertSchema), (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    const isVerifiedExpert = req.body.is_verified_expert === true || req.body.is_verified_expert === 1;
    const previous = db.prepare("SELECT username, is_verified_expert FROM users WHERE id = ?").get(userId) as
      | { username: string; is_verified_expert: number }
      | undefined;
    if (!previous) return res.status(404).json({ error: "未找到该用户" });
    db.prepare("UPDATE users SET is_verified_expert = ? WHERE id = ?").run(isVerifiedExpert ? 1 : 0, userId);
    audit(req, {
      action: "user.expert.update",
      resourceType: "user",
      resourceId: userId,
      summary: `${isVerifiedExpert ? "认证" : "取消认证"}专业用户 ${previous.username}`,
      details: { before: Boolean(previous.is_verified_expert), after: isVerifiedExpert },
    });
    return res.json({ success: true, is_verified_expert: isVerifiedExpert });
  } catch {
    return res.status(500).json({ error: "更新专业认证失败" });
  }
});

router.put("/users/:id/status", validateBody(adminUserStatusSchema), (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    const isDisabled = req.body.is_disabled ? 1 : 0;

    // 不允许停用自己的账号
    if (Number(userId) === (req as any).userId && isDisabled) {
      return res.status(400).json({ error: "不能停用当前的管理员账号" });
    }

    const previous = db.prepare("SELECT username, is_disabled FROM users WHERE id = ?").get(userId) as
      | { username: string; is_disabled: number }
      | undefined;
    if (!previous) return res.status(404).json({ error: "未找到该用户" });

    db.prepare("UPDATE users SET is_disabled = ? WHERE id = ?").run(isDisabled, userId);
    audit(req, {
      action: isDisabled ? "user.disable" : "user.enable",
      resourceType: "user",
      resourceId: userId,
      summary: `${isDisabled ? "停用" : "启用"}用户 ${previous.username}`,
      details: { before: Boolean(previous.is_disabled), after: Boolean(isDisabled) },
    });
    return res.json({ success: true, is_disabled: isDisabled });
  } catch (error) {
    console.error("[Admin User Status Update Error]", error);
    return res.status(500).json({ error: "更新用户状态失败" });
  }
});

export function createAdminUsersRouter() {
  return router;
}
