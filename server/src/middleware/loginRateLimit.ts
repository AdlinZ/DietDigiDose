import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "../storage/db.js";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 20;

function normalizeIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function accountKey(username: unknown) {
  return hashKey("login-account", String(username || "").trim().toLowerCase());
}

function requestIdentifier(req: Request) {
  return req.body?.identifier ?? req.body?.username;
}

function ipKey(req: Request) {
  return hashKey("login-ip", normalizeIp(req));
}

function hashKey(namespace: string, value: string) {
  return `${namespace}:${createHash("sha256").update(value).digest("hex")}`;
}

type AttemptBucket = { request_count: number; window_started_at: number; blocked_until: number };

function getActiveBucket(key: string, now: number) {
  const bucket = db.prepare(`
    SELECT request_count, window_started_at, blocked_until FROM rate_limit_buckets WHERE bucket_key = ?
  `).get(key) as AttemptBucket | undefined;
  if (!bucket) return null;
  if (bucket.blocked_until > now) return bucket;
  if (now - bucket.window_started_at >= WINDOW_MS) {
    db.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = ?").run(key);
    return null;
  }
  return bucket;
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const buckets = [
    getActiveBucket(accountKey(requestIdentifier(req)), now),
    getActiveBucket(ipKey(req), now),
  ].filter(Boolean) as AttemptBucket[];
  const blocked = buckets.find((bucket) => bucket.blocked_until > now);

  if (!blocked) return next();

  const retryAfterSeconds = Math.max(1, Math.ceil((blocked.blocked_until - now) / 1000));
  res.setHeader("Retry-After", retryAfterSeconds);
  return res.status(429).json({
    error: "登录尝试过于频繁，请稍后再试",
    code: "LOGIN_RATE_LIMITED",
    retryAfterSeconds,
  });
}

function recordAttempt(key: string, limit: number, now: number) {
  const current = getActiveBucket(key, now) || {
    request_count: 0,
    window_started_at: now,
    blocked_until: 0,
  };
  current.request_count += 1;
  if (current.request_count >= limit) {
    current.blocked_until = now + BLOCK_MS;
  }
  db.prepare(`
    INSERT INTO rate_limit_buckets (bucket_key, request_count, window_started_at, blocked_until, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_key) DO UPDATE SET
      request_count = excluded.request_count,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, current.request_count, current.window_started_at, current.blocked_until);
}

export function recordLoginFailure(req: Request) {
  const now = Date.now();
  recordAttempt(accountKey(requestIdentifier(req)), ACCOUNT_LIMIT, now);
  recordAttempt(ipKey(req), IP_LIMIT, now);
}

export function clearLoginFailures(username: unknown) {
  db.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key = ?").run(accountKey(username));
}
