import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth.js";
import { db } from "../storage/db.js";

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }

  try {
    const user = db.prepare('SELECT role, must_change_password FROM users WHERE id = ?').get(req.userId) as
      | { role: string; must_change_password: number }
      | undefined;
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: "无权限：需要管理员角色" });
    }
    if (user.must_change_password) {
      return res.status(403).json({
        error: "首次登录必须修改管理员密码",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }
    next();
  } catch (error) {
    console.error("Admin Auth Error:", error);
    return res.status(500).json({ error: "服务器内部错误" });
  }
}
