import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const rawPath = req.originalUrl.split("?")[0];
    const safePath = rawPath.replace(
      /^\/api\/v1\/webhooks\/aliyun\/sms-delivery\/[^/]+$/,
      "/api/v1/webhooks/aliyun/sms-delivery/:token",
    );
    logger.info("http.request", {
      requestId: String(res.locals.requestId || ""),
      method: req.method,
      path: safePath,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: (req as Request & { userId?: number }).userId,
      ip: req.ip,
    });
  });
  next();
}
