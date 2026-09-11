import type { Row } from "./types.js";

export const PREFERENCE_EVIDENCE_VERSION = "internal-evidence-v1";
const horizonMs = 30 * 24 * 60 * 60 * 1000;
const timestamp = (value: unknown) => value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value.includes("T") ? value : `${value.replace(" ","T")}Z`) : NaN;
const metadata = (value: unknown): Row => {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {}; }
  catch { return {}; }
};

/** Old unlabelled skips and transient circumstances are not taste evidence. */
export function repeatedDislikeRecipeIds(events: Row[], now = Date.now()): number[] {
  const evidence = new Map<number,Set<string>>();
  for (const event of events) {
    const facts = metadata(event.metadata_json);
    const at = timestamp(event.created_at);
    if (event.event_type !== "skip" || facts.reason !== "dislike" || facts.scope !== "long_term" || facts.withdrawn === true) continue;
    if (!Number.isFinite(at) || at > now || now-at > horizonMs) continue;
    const recipeId = Number(event.recipe_id);
    const identity = String(event.idempotency_key ?? event.id ?? "");
    if (!Number.isInteger(recipeId) || recipeId <= 0 || !identity) continue;
    const records = evidence.get(recipeId) ?? new Set<string>();
    records.add(identity); evidence.set(recipeId,records);
  }
  return [...evidence].filter(([,records]) => records.size >= 3).map(([recipeId]) => recipeId).sort((a,b) => a-b);
}
