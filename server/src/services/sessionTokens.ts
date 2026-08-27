import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/security.js";
import { db } from "../storage/db.js";

export type SessionTokenClaims = {
  userId: number;
  sessionVersion: number;
};

export function currentSessionVersion(userId: number) {
  const row = db.prepare("SELECT session_version FROM users WHERE id = ?").get(userId) as
    | { session_version: number }
    | undefined;
  return row ? Math.max(1, Number(row.session_version) || 1) : null;
}

export function signUserToken(userId: number) {
  const sessionVersion = currentSessionVersion(userId);
  if (sessionVersion === null) throw new Error("USER_NOT_FOUND");
  return jwt.sign({ userId, sessionVersion }, JWT_SECRET, { expiresIn: "30d" });
}
