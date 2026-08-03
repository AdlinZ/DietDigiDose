import { Router } from "express";
import { db } from "../../storage/db.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { adminExpertSchema, adminRoleSchema } from "../../validation/schemas.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { auditAdminAction as audit } from "./shared.js";

const router = Router();
router.param("id", positiveIntegerParam);

// 2. 获取用户列表
router.get("/users", (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, nickname, avatar_url, role, is_verified_expert, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "获取用户列表失败" });
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

export function createAdminUsersRouter() {
  return router;
}

