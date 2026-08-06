import { db } from "../storage/db.js";

export type UserLevel = {
  level: number;
  title: string;
  xp: number;
  baseXp: number;
  adjustmentXp: number;
  nextXp: number | null;
  progress: number;
};

const LEVELS = [
  { level: 1, title: "健康新芽", requiredXp: 0 },
  { level: 2, title: "轻食探索者", requiredXp: 150 },
  { level: 3, title: "健康达人", requiredXp: 450 },
  { level: 4, title: "营养生活家", requiredXp: 900 },
  { level: 5, title: "食光大师", requiredXp: 1800 },
] as const;

/** Levels are derived from meaningful activity, so there is no mutable XP balance to corrupt. */
export function getUserLevel(userId: number): UserLevel {
  const dietDates = (db.prepare("SELECT DISTINCT recorded_at FROM diet_records WHERE user_id = ?").all(userId) as Array<{ recorded_at: string }>)
    .map((row) => row.recorded_at);
  const dietRecordCount = (db.prepare("SELECT COUNT(*) AS count FROM diet_records WHERE user_id = ?").get(userId) as { count: number }).count;
  const favoriteCount = (db.prepare("SELECT COUNT(*) AS count FROM recipe_favorites WHERE user_id = ?").get(userId) as { count: number }).count;
  const postCount = (db.prepare("SELECT COUNT(*) AS count FROM community_posts WHERE user_id = ? AND deleted_at IS NULL").get(userId) as { count: number }).count;
  const followerCount = (db.prepare("SELECT COUNT(*) AS count FROM user_follows WHERE following_id = ?").get(userId) as { count: number }).count;
  const recorded = new Set(dietDates);
  let streak = 0;
  const day = new Date();
  while (recorded.has(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`)) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  const baseXp = dietRecordCount * 10 + streak * 15 + favoriteCount * 5 + postCount * 30 + followerCount * 20;
  const adjustmentXp = (db.prepare("SELECT COALESCE(SUM(xp_delta), 0) AS xp FROM user_level_adjustments WHERE user_id = ?").get(userId) as { xp: number }).xp;
  const xp = Math.max(0, baseXp + adjustmentXp);
  const current = [...LEVELS].reverse().find((item) => xp >= item.requiredXp) ?? LEVELS[0];
  const next = LEVELS.find((item) => item.level === current.level + 1) ?? null;
  return {
    level: current.level,
    title: current.title,
    xp,
    baseXp,
    adjustmentXp,
    nextXp: next?.requiredXp ?? null,
    progress: next ? Math.min(100, Math.round(((xp - current.requiredXp) / (next.requiredXp - current.requiredXp)) * 100)) : 100,
  };
}
