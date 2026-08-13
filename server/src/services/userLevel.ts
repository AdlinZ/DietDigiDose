import { db, getSystemSetting, setSystemSetting } from "../storage/db.js";

export type UserLevel = {
  level: number;
  title: string;
  xp: number;
  baseXp: number;
  adjustmentXp: number;
  nextXp: number | null;
  progress: number;
};

export type UserLevelRule = {
  levels: Array<{ level: number; title: string; requiredXp: number }>;
  xp: {
    dietRecord: number;
    streakDay: number;
    recipeFavorite: number;
    communityPost: number;
    follower: number;
    dailyCheckIn: number;
  };
};

const USER_LEVEL_RULE_SETTING = "USER_LEVEL_RULE";

export const DEFAULT_USER_LEVEL_RULE: UserLevelRule = {
  levels: [
    { level: 1, title: "健康新芽", requiredXp: 0 },
    { level: 2, title: "轻食探索者", requiredXp: 150 },
    { level: 3, title: "健康达人", requiredXp: 450 },
    { level: 4, title: "营养生活家", requiredXp: 900 },
    { level: 5, title: "食光大师", requiredXp: 1800 },
  ],
  xp: {
    dietRecord: 10,
    streakDay: 15,
    recipeFavorite: 5,
    communityPost: 30,
    follower: 20,
    dailyCheckIn: 5,
  },
};

function isValidStoredRule(value: unknown): value is UserLevelRule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UserLevelRule>;
  if (!Array.isArray(candidate.levels) || candidate.levels.length < 2) return false;
  if (!candidate.xp || typeof candidate.xp !== "object") return false;
  const weights = [
    candidate.xp.dietRecord,
    candidate.xp.streakDay,
    candidate.xp.recipeFavorite,
    candidate.xp.communityPost,
    candidate.xp.follower,
    candidate.xp.dailyCheckIn,
  ];
  return candidate.levels.every((item, index) => (
    item?.level === index + 1
    && typeof item.title === "string"
    && Number.isInteger(item.requiredXp)
    && (index === 0 ? item.requiredXp === 0 : item.requiredXp > candidate.levels![index - 1].requiredXp)
  )) && Object.keys(candidate.xp).length === 6 && weights.every((weight) => Number.isInteger(weight) && weight! >= 0);
}

export function getUserLevelRule(): UserLevelRule {
  const stored = getSystemSetting(USER_LEVEL_RULE_SETTING);
  if (!stored) return structuredClone(DEFAULT_USER_LEVEL_RULE);
  try {
    const storedValue: unknown = JSON.parse(stored);
    const parsed = storedValue && typeof storedValue === "object"
      ? {
          ...storedValue,
          xp: {
            ...((storedValue as Partial<UserLevelRule>).xp || {}),
            dailyCheckIn: (storedValue as Partial<UserLevelRule>).xp?.dailyCheckIn ?? DEFAULT_USER_LEVEL_RULE.xp.dailyCheckIn,
          },
        }
      : storedValue;
    return isValidStoredRule(parsed) ? parsed : structuredClone(DEFAULT_USER_LEVEL_RULE);
  } catch {
    return structuredClone(DEFAULT_USER_LEVEL_RULE);
  }
}

export function saveUserLevelRule(rule: UserLevelRule) {
  setSystemSetting(USER_LEVEL_RULE_SETTING, JSON.stringify(rule));
}

/** Levels are derived from meaningful activity, so there is no mutable XP balance to corrupt. */
export function getUserLevel(userId: number): UserLevel {
  const rule = getUserLevelRule();
  const dietDates = (db.prepare("SELECT DISTINCT recorded_at FROM diet_records WHERE user_id = ?").all(userId) as Array<{ recorded_at: string }>)
    .map((row) => row.recorded_at);
  const dietRecordCount = (db.prepare("SELECT COUNT(*) AS count FROM diet_records WHERE user_id = ?").get(userId) as { count: number }).count;
  const favoriteCount = (db.prepare("SELECT COUNT(*) AS count FROM recipe_favorites WHERE user_id = ?").get(userId) as { count: number }).count;
  const postCount = (db.prepare("SELECT COUNT(*) AS count FROM community_posts WHERE user_id = ? AND deleted_at IS NULL").get(userId) as { count: number }).count;
  const followerCount = (db.prepare("SELECT COUNT(*) AS count FROM user_follows WHERE following_id = ?").get(userId) as { count: number }).count;
  const checkInCount = (db.prepare("SELECT COUNT(*) AS count FROM user_daily_check_ins WHERE user_id = ?").get(userId) as { count: number }).count;
  const recorded = new Set(dietDates);
  let streak = 0;
  const day = new Date();
  while (recorded.has(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`)) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  const baseXp = dietRecordCount * rule.xp.dietRecord
    + streak * rule.xp.streakDay
    + favoriteCount * rule.xp.recipeFavorite
    + postCount * rule.xp.communityPost
    + followerCount * rule.xp.follower
    + checkInCount * rule.xp.dailyCheckIn;
  const adjustmentXp = (db.prepare("SELECT COALESCE(SUM(xp_delta), 0) AS xp FROM user_level_adjustments WHERE user_id = ?").get(userId) as { xp: number }).xp;
  const xp = Math.max(0, baseXp + adjustmentXp);
  const current = [...rule.levels].reverse().find((item) => xp >= item.requiredXp) ?? rule.levels[0];
  const next = rule.levels.find((item) => item.level === current.level + 1) ?? null;
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
