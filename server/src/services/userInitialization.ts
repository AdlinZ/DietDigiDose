import type Database from "better-sqlite3";
import { db } from "../storage/db.js";

/** Ensures account-level defaults exist without requiring a device-local onboarding state. */
export function ensureUserInitialState(userId: number, database: Database.Database = db) {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("INVALID_USER_ID");
  database.prepare(`
    INSERT OR IGNORE INTO user_health_profiles (user_id)
    VALUES (?)
  `).run(userId);
}
