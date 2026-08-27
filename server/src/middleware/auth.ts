import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/security.js";
import { db } from "../storage/db.js";
import { sendError } from "../utils/http.js";
import type { SessionTokenClaims } from "../services/sessionTokens.js";

export interface AuthRequest extends Request {
  userId?: number;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendError(res, 401, "未登录，请先登录", "AUTH_REQUIRED");
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionTokenClaims;
    const user = db.prepare("SELECT is_disabled, session_version FROM users WHERE id = ?").get(decoded.userId) as
      | { is_disabled?: number; session_version: number }
      | undefined;
    if (!user) return sendError(res, 401, "用户不存在", "USER_NOT_FOUND");
    if (user.is_disabled === 1) return sendError(res, 403, "账号已被停用", "ACCOUNT_DISABLED");
    if (!Number.isInteger(decoded.sessionVersion) || decoded.sessionVersion !== user.session_version) {
      return sendError(res, 401, "登录会话已失效，请重新登录", "SESSION_REVOKED");
    }
    req.userId = decoded.userId;
    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return sendError(res, 401, "Token 已过期，请重新登录", "TOKEN_EXPIRED");
    }
    return sendError(res, 401, "无效的 Token", "INVALID_TOKEN");
  }
}

export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    req.userId = undefined;
    return next();
  }
  if (!authHeader.startsWith("Bearer ")) {
    return sendError(res, 401, "无效的认证格式", "INVALID_AUTH_HEADER");
  }
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as SessionTokenClaims;
    const user = db.prepare("SELECT is_disabled, session_version FROM users WHERE id = ?").get(decoded.userId) as
      | { is_disabled?: number; session_version: number }
      | undefined;
    if (!user) return sendError(res, 401, "用户不存在", "USER_NOT_FOUND");
    if (user.is_disabled === 1) return sendError(res, 403, "账号已被停用", "ACCOUNT_DISABLED");
    if (!Number.isInteger(decoded.sessionVersion) || decoded.sessionVersion !== user.session_version) {
      return sendError(res, 401, "登录会话已失效，请重新登录", "SESSION_REVOKED");
    }
    req.userId = decoded.userId;
    return next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return sendError(res, 401, "Token 已过期，请重新登录", "TOKEN_EXPIRED");
    }
    return sendError(res, 401, "无效的 Token", "INVALID_TOKEN");
  }
}
