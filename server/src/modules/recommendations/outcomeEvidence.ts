import type { Row } from "./types.js";
import type { PreferenceOutcome } from "@dietdigidose/contracts";
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value).includes("T") ? String(value) : `${String(value).replace(" ","T")}Z`;

/** These are observations, not guesses about taste or why a meal was left over. */
export function formatOutcomeEvidence(production: Row[], events: Row[]): PreferenceOutcome[] {
  const facts = new Map<string,PreferenceOutcome>();
  for (const row of production) {
    const id = `production:${row.id}`;
    facts.set(id,{ id,recipeId: row.recipe_id == null ? null : Number(row.recipe_id),title: String(row.food_name),kind: "production",at: iso(row.produced_at),servings: Number(row.produced_servings),valid: true,explanation: "已制作，不等于已食用；实际用时未采集" });
  }
  for (const row of events) {
    if (row.event_type !== "eat" && row.event_type !== "discard") continue;
    const id = `prepared-event:${row.id}`;
    const corrected = row.correction_mode != null;
    const missingIntake = row.event_type === "eat" && row.diet_record_id == null;
    facts.set(id,{ id,recipeId: row.recipe_id == null ? null : Number(row.recipe_id),title: String(row.food_name),kind: row.event_type,
      at: iso(row.created_at),servings: Number(row.servings),valid: !corrected && !missingIntake,
      explanation: corrected ? row.correction_mode === "undo_eating" ? "食用已撤销，不再作为学习证据" : "摄入记录已删除，不再作为学习证据" : missingIntake ? "缺少关联摄入记录，不作为学习证据" : row.event_type === "discard" ? "已丢弃；原因未知，不能据此推断不喜欢或份量过大" : "实际食用已确认；单次食用不等于长期喜欢",
      ...(corrected ? { correctionId: String(row.correction_id),correctedAt: iso(row.corrected_at) } : {}),
    });
  }
  return [...facts.values()].sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
