import { createHmac } from "node:crypto";
import { JWT_SECRET } from "../config/security.js";
import { db } from "../storage/db.js";

export type FunnelEventName = "account_registered" | "login_succeeded" | "inventory_added" | "cooking_completed";

function actorHashFor(userId: number) {
  return createHmac("sha256", JWT_SECRET).update(`user:${userId}`).digest("hex");
}

export function recordFunnelEvent(userId: number, eventName: FunnelEventName) {
  // Only a keyed, one-way pseudonym is stored. No food, health, message, IP or login identifier is attached.
  try {
    const actorHash = actorHashFor(userId);
    db.prepare("INSERT INTO funnel_events (event_name, actor_hash) VALUES (?, ?)").run(eventName, actorHash);
  } catch (error) {
    console.warn("[Funnel Event Error]", error instanceof Error ? error.message : String(error));
  }
}

export function deleteFunnelEvents(userId: number) {
  db.prepare("DELETE FROM funnel_events WHERE actor_hash = ?").run(actorHashFor(userId));
}
