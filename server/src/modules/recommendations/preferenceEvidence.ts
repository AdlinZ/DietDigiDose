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
    if (event.event_type !== "skip" || facts.reason !== "dislike" || facts.scope !== "long_term" || facts.withdrawn === true || facts.learningPaused === true) continue;
    if (!Number.isFinite(at) || at > now || now-at > horizonMs) continue;
    const recipeId = Number(event.recipe_id);
    const identity = String(event.idempotency_key ?? event.id ?? "");
    if (!Number.isInteger(recipeId) || recipeId <= 0 || !identity) continue;
    const records = evidence.get(recipeId) ?? new Set<string>();
    records.add(identity); evidence.set(recipeId,records);
  }
  return [...evidence].filter(([,records]) => records.size >= 3).map(([recipeId]) => recipeId).sort((a,b) => a-b);
}

export type LearningData = { settings: Row | null; events: Row[]; recipes: Row[] };
export function learningOverrides(settings: Row | null): Record<string,{ value: "neutral" | "dislike"; updatedAt: string }> {
  return metadata(settings?.overrides_json) as Record<string,{ value: "neutral" | "dislike"; updatedAt: string }>;
}
export function effectiveDislikeRecipeIds(data: LearningData): number[] {
  const ids = new Set(data.settings?.enabled === false || data.settings?.enabled === 0 ? [] : repeatedDislikeRecipeIds(data.events));
  for (const [key,override] of Object.entries(learningOverrides(data.settings))) {
    if (override.value === "dislike") ids.add(Number(key)); else ids.delete(Number(key));
  }
  return [...ids];
}
export function formatLearningState(data: LearningData): import("@dietdigidose/contracts").PreferenceLearningState {
  const overrides = learningOverrides(data.settings);
  return { version: Number(data.settings?.version ?? 1),enabled: data.settings?.enabled !== false && data.settings?.enabled !== 0,ruleVersion: PREFERENCE_EVIDENCE_VERSION,
    items: effectiveDislikeRecipeIds(data).map(recipeId => {
      const override = overrides[String(recipeId)];
      const evidence = data.events.filter(event => Number(event.recipe_id) === recipeId && metadata(event.metadata_json).reason === "dislike" && metadata(event.metadata_json).scope === "long_term" && metadata(event.metadata_json).withdrawn !== true && metadata(event.metadata_json).learningPaused !== true && timestamp(event.created_at) <= Date.now() && Date.now()-timestamp(event.created_at) <= horizonMs).map(event => ({ id: String(event.id),at: new Date(timestamp(event.created_at)).toISOString(),reason: "明确长期不喜欢" }));
      return { recipeId,title: String(data.recipes.find(recipe => Number(recipe.id) === recipeId)?.title ?? "已不可用菜谱"),origin: override ? "explicit" as const : "inferred" as const,
        explanation: override ? "你明确设置为不喜欢" : "近30天至少三次明确长期不喜欢，仅降低排序，不排除菜谱",updatedAt: override?.updatedAt ?? evidence.map(item => item.at).sort().at(-1) ?? "",evidence: override ? [] : evidence };
    }) };
}
