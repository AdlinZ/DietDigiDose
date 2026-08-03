import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/security.js";
import { sendError } from "../utils/http.js";

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
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
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
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as { userId: number };
    req.userId = decoded.userId;
    return next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return sendError(res, 401, "Token 已过期，请重新登录", "TOKEN_EXPIRED");
    }
    return sendError(res, 401, "无效的 Token", "INVALID_TOKEN");
  }
}
