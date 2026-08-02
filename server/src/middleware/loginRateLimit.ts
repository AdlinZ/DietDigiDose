import type { NextFunction, Request, Response } from "express";

interface AttemptBucket {
  count: number;
  firstAttemptAt: number;
  blockedUntil: number;
}

const attempts = new Map<string, AttemptBucket>();
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 5;
const IP_LIMIT = 20;

function normalizeIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function accountKey(username: unknown) {
  return `account:${String(username || "").trim().toLowerCase()}`;
}

function requestIdentifier(req: Request) {
  return req.body?.identifier ?? req.body?.username;
}

function ipKey(req: Request) {
  return `ip:${normalizeIp(req)}`;
}

function getActiveBucket(key: string, now: number) {
  const bucket = attempts.get(key);
  if (!bucket) return null;
  if (bucket.blockedUntil > now) return bucket;
  if (now - bucket.firstAttemptAt >= WINDOW_MS) {
    attempts.delete(key);
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
  const blocked = buckets.find((bucket) => bucket.blockedUntil > now);

  if (!blocked) return next();

  const retryAfterSeconds = Math.max(1, Math.ceil((blocked.blockedUntil - now) / 1000));
  res.setHeader("Retry-After", retryAfterSeconds);
  return res.status(429).json({
    error: "登录尝试过于频繁，请稍后再试",
    code: "LOGIN_RATE_LIMITED",
    retryAfterSeconds,
  });
}

function recordAttempt(key: string, limit: number, now: number) {
  const current = getActiveBucket(key, now) || {
    count: 0,
    firstAttemptAt: now,
    blockedUntil: 0,
  };
  current.count += 1;
  if (current.count >= limit) {
    current.blockedUntil = now + BLOCK_MS;
  }
  attempts.set(key, current);
}

export function recordLoginFailure(req: Request) {
  const now = Date.now();
  recordAttempt(accountKey(requestIdentifier(req)), ACCOUNT_LIMIT, now);
  recordAttempt(ipKey(req), IP_LIMIT, now);
}

export function clearLoginFailures(username: unknown) {
  attempts.delete(accountKey(username));
}
