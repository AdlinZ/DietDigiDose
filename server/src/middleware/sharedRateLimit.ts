import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "../storage/db.js";

type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
  key: (req: Request) => string;
  message: string;
  code: string;
};

type Bucket = {
  request_count: number;
  window_started_at: number;
  blocked_until: number;
};

export function hashRateLimitKey(namespace: string, value: string) {
  return `${namespace}:${createHash("sha256").update(value).digest("hex")}`;
}

export function getRateLimitClientIp(req: Request) {
  return String(req.ip || req.socket.remoteAddress || "unknown").trim() || "unknown";
}

function consume(bucketKey: string, limit: number, windowMs: number, now: number) {
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT request_count, window_started_at, blocked_until
      FROM rate_limit_buckets WHERE bucket_key = ?
    `).get(bucketKey) as Bucket | undefined;

    if (!row || now - row.window_started_at >= windowMs) {
      db.prepare(`
        INSERT INTO rate_limit_buckets (bucket_key, request_count, window_started_at, blocked_until, updated_at)
        VALUES (?, 1, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(bucket_key) DO UPDATE SET
          request_count = 1,
          window_started_at = excluded.window_started_at,
          blocked_until = 0,
          updated_at = CURRENT_TIMESTAMP
      `).run(bucketKey, now);
      return { blocked: false, retryAfterSeconds: 0 };
    }

    if (row.blocked_until > now || row.request_count >= limit) {
      const blockedUntil = row.blocked_until > now ? row.blocked_until : row.window_started_at + windowMs;
      db.prepare(`UPDATE rate_limit_buckets SET blocked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE bucket_key = ?`)
        .run(blockedUntil, bucketKey);
      return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
    }

    db.prepare(`UPDATE rate_limit_buckets SET request_count = request_count + 1, updated_at = CURRENT_TIMESTAMP WHERE bucket_key = ?`)
      .run(bucketKey);
    return { blocked: false, retryAfterSeconds: 0 };
  })();
}

export function sharedRateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const bucketKey = hashRateLimitKey(options.namespace, options.key(req));
    const status = consume(bucketKey, options.limit, options.windowMs, Date.now());
    if (!status.blocked) return next();
    res.setHeader("Retry-After", status.retryAfterSeconds);
    return res.status(429).json({
      error: options.message,
      code: options.code,
      retryAfterSeconds: status.retryAfterSeconds,
    });
  };
}
