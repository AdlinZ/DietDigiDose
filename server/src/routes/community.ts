import { Router } from "express";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Reader, type Response } from "maxmind";
import { db } from "../storage/db.js";
import { authMiddleware, optionalAuthMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { communityCommentSchema, communityPostSchema } from "../validation/schemas.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";
import { getUserLevel, getUserLevelRule } from "../services/userLevel.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";
import { isStoredMediaUrlForUser } from "../services/mediaStorage.js";
import { currentDateKey } from "../utils/date.js";
import {
  recommendCommunityPosts,
  type CommunityRecommendationProfile,
} from "../services/communityRecommendation.js";
import { getRateLimitClientIp, sharedRateLimit } from "../middleware/sharedRateLimit.js";

const router = Router();
const RECOMMENDATION_CANDIDATE_LIMIT = 240;
const DEFAULT_PUBLIC_POST_LIMIT = 12;
const MAX_PUBLIC_POST_LIMIT = 30;
const shareRateLimit = sharedRateLimit({
  namespace: "community-share-ip",
  limit: Math.max(1, Number(process.env.COMMUNITY_SHARE_RATE_LIMIT) || 20),
  windowMs: Math.max(1_000, Number(process.env.COMMUNITY_SHARE_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000),
  key: getRateLimitClientIp,
  message: "分享请求过于频繁，请稍后重试",
  code: "COMMUNITY_SHARE_RATE_LIMITED",
});
router.param("id", positiveIntegerParam);
router.param("postId", positiveIntegerParam);
router.param("commentId", positiveIntegerParam);
router.param("userId", positiveIntegerParam);
router.use(optionalAuthMiddleware);

const COUNTRY_NAMES = new Intl.DisplayNames(["zh-CN"], { type: "region" });
type CountryLookup = Response & {
  country_code?: string;
  country?: { iso_code?: string };
  city?: { names?: Record<string, string> };
};

let geoIpReader: Reader<CountryLookup> | null = null;
const require = createRequire(import.meta.url);

function initializeGeoIpReader() {
  const databasePath = process.env.GEOIP_DATABASE_PATH?.trim()
    || require.resolve("@ip-location-db/geolite2-country-mmdb/geolite2-country.mmdb");
  try {
    geoIpReader = new Reader<CountryLookup>(readFileSync(databasePath));
  } catch (error) {
    console.warn("GeoIP database unavailable", error);
  }
}

initializeGeoIpReader();

function getRequestLocation(req: AuthRequest) {
  // Only trust country headers when a configured edge proxy strips the incoming
  // client values and writes its own. Direct clients can forge these headers.
  if (process.env.TRUST_GEO_HEADERS === "1") {
    const region = String(req.get("cf-ipcountry") || req.get("x-vercel-ip-country") || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(region) && region !== "XX" && region !== "T1") {
      return COUNTRY_NAMES.of(region) || region;
    }
  }
  const ip = String(req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (/^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) {
    return "本地网络";
  }
  const lookup = geoIpReader?.get(ip);
  const countryCode = lookup?.country_code || lookup?.country?.iso_code;
  if (countryCode) {
    const country = COUNTRY_NAMES.of(countryCode) || countryCode;
    const city = lookup.city?.names?.["zh-CN"] || lookup.city?.names?.en;
    return city ? `${country} · ${city}` : country;
  }
  return null;
}

function getAuthenticatedUser(req: AuthRequest): { userId: number; user: any } | null {
  if (!req.userId) return null;
  const user = db.prepare("SELECT id, username, avatar_url, role, is_verified_expert FROM users WHERE id = ?").get(req.userId);
  return user ? { userId: req.userId, user } : null;
}

function postSelect(userId: number | null) {
  return `
    SELECT
      p.*,
      COALESCE(u.username, '食友' || p.user_id) AS username,
      COALESCE(u.is_verified_expert, 0) AS author_is_expert,
      (SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id = p.id) AS actual_comment_count,
      EXISTS(SELECT 1 FROM community_post_likes l WHERE l.post_id = p.id AND l.user_id = ${userId ?? -1}) AS is_liked,
      (SELECT COUNT(*) FROM community_event_participants ep WHERE ep.post_id = p.id) AS participant_count,
      EXISTS(SELECT 1 FROM community_event_participants ep WHERE ep.post_id = p.id AND ep.user_id = ${userId ?? -1}) AS is_joined
      , EXISTS(SELECT 1 FROM user_follows uf WHERE uf.follower_id = ${userId ?? -1} AND uf.following_id = p.user_id) AS author_is_followed
      , lr.id AS linked_recipe_valid_id
      , lr.title AS linked_recipe_title
      , lr.image_url AS linked_recipe_image_url
      , lr.cook_time AS linked_recipe_cook_time
      , lr.difficulty AS linked_recipe_difficulty
      , lr.calories AS linked_recipe_calories
    FROM community_posts p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN recipes lr ON lr.id = p.linked_recipe_id
      AND lr.deleted_at IS NULL
      AND lr.status = 'approved'
      AND COALESCE(lr.quality_status, 'trusted') <> 'needs_review'
  `;
}

function serializePost(post: any) {
  if (!post) return post;
  const {
    actual_comment_count: actualCommentCount,
    nickname: _legacyNickname,
    linked_recipe_valid_id: linkedRecipeValidId,
    linked_recipe_title: linkedRecipeTitle,
    linked_recipe_image_url: linkedRecipeImageUrl,
    linked_recipe_cook_time: linkedRecipeCookTime,
    linked_recipe_difficulty: linkedRecipeDifficulty,
    linked_recipe_calories: linkedRecipeCalories,
    ...serializedPost
  } = post;
  let imageUrls: string[] = [];
  try {
    const parsed = typeof post.image_urls === "string" ? JSON.parse(post.image_urls) : post.image_urls;
    if (Array.isArray(parsed)) imageUrls = parsed.filter((item) => typeof item === "string");
  } catch {
    imageUrls = [];
  }
  if (!imageUrls.length && post.image_url) imageUrls = [post.image_url];
  return {
    ...serializedPost,
    image_url: post.image_url || imageUrls[0] || null,
    image_urls: imageUrls,
    is_liked: Boolean(post.is_liked),
    is_joined: Boolean(post.is_joined),
    author_is_followed: Boolean(post.author_is_followed),
    author_is_expert: Boolean(post.author_is_expert),
    comment_count: Number(actualCommentCount ?? post.comment_count) || 0,
    linked_recipe: linkedRecipeValidId ? {
      id: Number(linkedRecipeValidId),
      title: String(linkedRecipeTitle),
      image_url: linkedRecipeImageUrl ? String(linkedRecipeImageUrl) : null,
      cook_time: Number(linkedRecipeCookTime) || 0,
      difficulty: String(linkedRecipeDifficulty || "难度未知"),
      calories: Number(linkedRecipeCalories) || 0,
    } : null,
    linked_recipe_unavailable: Boolean(post.linked_recipe_id && !linkedRecipeValidId),
  };
}

function parseStringList(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") return [item.name];
      return [];
    });
  } catch {
    return value.split(/[、,，/;；\s]+/).filter(Boolean);
  }
}

function getRecommendationProfile(userId: number | null): CommunityRecommendationProfile {
  if (!userId) return { userId: null, healthGoal: "healthy", likedPosts: [], restrictedTerms: [] };
  const health = db.prepare(`
    SELECT health_goal, dietary_preference, allergies_json, dietary_restrictions_json, disliked_foods
    FROM user_health_profiles WHERE user_id = ?
  `).get(userId) as {
    health_goal?: string | null;
    dietary_preference?: string | null;
    allergies_json?: string | null;
    dietary_restrictions_json?: string | null;
    disliked_foods?: string | null;
  } | undefined;
  const likedPosts = db.prepare(`
    SELECT p.user_id, p.content
    FROM community_post_likes l
    JOIN community_posts p ON p.id = l.post_id
    WHERE l.user_id = ? AND p.deleted_at IS NULL
    ORDER BY l.created_at DESC
    LIMIT 80
  `).all(userId) as Array<{ user_id: number; content: string }>;

  return {
    userId,
    healthGoal: health?.health_goal || "healthy",
    dietaryPreference: health?.dietary_preference || "",
    likedPosts,
    restrictedTerms: [
      ...parseStringList(health?.allergies_json),
      ...parseStringList(health?.dietary_restrictions_json),
      ...String(health?.disliked_foods || "").split(/[、,，/;；\s]+/),
    ].filter(Boolean),
  };
}

// GET /api/v1/community/users?query=xxx
// 全局搜索与提及选择器只返回公开主页摘要，避免暴露登录标识和联系方式。
router.get("/users", (req: AuthRequest, res) => {
  const query = String(req.query.query || "").trim();
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
  const users = req.userId
    ? db.prepare(`
        SELECT id, username, avatar_url, bio
        FROM users
        WHERE id != ? AND username LIKE ? ESCAPE '\\' AND is_disabled = 0
        ORDER BY id DESC
        LIMIT 12
      `).all(req.userId, pattern)
    : db.prepare(`
        SELECT id, username, avatar_url, bio
        FROM users
        WHERE username LIKE ? ESCAPE '\\' AND is_disabled = 0
        ORDER BY id DESC
        LIMIT 12
      `).all(pattern);
  res.json(users);
});

router.get("/following", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const users = db.prepare(`
    SELECT u.id, u.username, u.avatar_url, uf.created_at
    FROM user_follows uf JOIN users u ON u.id = uf.following_id
    WHERE uf.follower_id = ? ORDER BY uf.created_at DESC
  `).all(auth.userId);
  res.json(users);
});

router.get("/level", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  res.json(getUserLevel(auth.userId));
});

router.get("/check-in", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const date = currentDateKey();
  const checkedIn = Boolean(db.prepare("SELECT 1 FROM user_daily_check_ins WHERE user_id = ? AND check_in_date = ?").get(auth.userId, date));
  res.json({ checkedIn, date, xpReward: getUserLevelRule().xp.dailyCheckIn });
});

router.post("/check-in", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const date = currentDateKey();
  const result = db.prepare("INSERT OR IGNORE INTO user_daily_check_ins (user_id, check_in_date) VALUES (?, ?)").run(auth.userId, date);
  const created = result.changes === 1;
  res.status(created ? 201 : 200).json({
    checkedIn: true,
    alreadyCheckedIn: !created,
    date,
    awardedXp: created ? getUserLevelRule().xp.dailyCheckIn : 0,
    level: getUserLevel(auth.userId),
  });
});

router.post("/users/:userId/follow", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const followingId = Number(req.params.userId);
  if (followingId === auth.userId) return res.status(400).json({ error: "不能关注自己" });
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(followingId);
  if (!target) return res.status(404).json({ error: "用户不存在" });
  const exists = db.prepare("SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = ?").get(auth.userId, followingId);
  if (exists) db.prepare("DELETE FROM user_follows WHERE follower_id = ? AND following_id = ?").run(auth.userId, followingId);
  else db.prepare("INSERT INTO user_follows (follower_id, following_id) VALUES (?, ?)").run(auth.userId, followingId);
  const followingCount = (db.prepare("SELECT COUNT(*) AS count FROM user_follows WHERE follower_id = ?").get(auth.userId) as { count: number }).count;
  res.json({ is_following: !exists, following_count: followingCount });
});

router.get("/users/:userId/profile", (req: AuthRequest, res) => {
  const viewerId = req.userId ?? -1;
  const profileUserId = Number(req.params.userId);
  const user = db.prepare(`
    SELECT u.id, u.username, u.avatar_url, u.bio,
      (SELECT COUNT(*) FROM user_follows WHERE following_id = u.id) AS followers_count,
      (SELECT COUNT(*) FROM user_follows WHERE follower_id = u.id) AS following_count,
      (SELECT COUNT(*) FROM community_posts WHERE user_id = u.id AND deleted_at IS NULL) AS posts_count,
      EXISTS(SELECT 1 FROM user_follows WHERE follower_id = ? AND following_id = u.id) AS is_following
    FROM users u WHERE u.id = ?
  `).get(viewerId, profileUserId) as any;
  if (!user) return res.status(404).json({ error: "用户不存在" });
  // 个人主页只需要动态摘要；绝不能把编辑器存储的 data URI 或多图原文
  // 一并塞进 profile JSON，否则单张图片就可能让页面响应膨胀到数 MB。
  const posts = db.prepare(`
    SELECT p.id, p.category, p.content,
      CASE WHEN p.image_url LIKE 'data:%' THEN NULL ELSE p.image_url END AS image_url,
      p.likes_count, p.created_at
    FROM community_posts p
    WHERE p.user_id = ? AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC LIMIT 20
  `).all(profileUserId);
  res.json({ ...user, is_following: Boolean(user.is_following), level: getUserLevel(profileUserId), posts });
});

// GET /api/v1/community/posts
router.get("/posts", (req: AuthRequest, res) => {
  const { category, sort } = req.query;
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 80) : "";
  const cursorMode = req.query.pageSize !== undefined || req.query.cursor !== undefined;
  const pageSize = Math.min(MAX_PUBLIC_POST_LIMIT, Math.max(1, Number(req.query.pageSize) || DEFAULT_PUBLIC_POST_LIMIT));
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_PUBLIC_POST_LIMIT)
    : DEFAULT_PUBLIC_POST_LIMIT;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const userId = req.userId ?? null;
  const requestedMode = sort === "recommended" ? "recommended" : "latest";
  const rawCursor = req.query.cursor;
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) {
    return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
  }
  const cursorId = cursor ? Number(cursor.id) : null;
  const cursorCategory = typeof cursor?.category === "string" ? cursor.category : "";
  const validCursorVersion = requestedMode === "recommended"
    ? cursor?.v === 2 || cursor?.v === 3 || cursor?.v === 4
    : cursor?.v === 2;
  if (cursor && (
    !validCursorVersion
    || cursor.mode !== requestedMode
    || cursorCategory !== (typeof category === "string" ? category : "")
    || !Number.isInteger(cursorId)
    || cursorId! <= 0
  )) {
    return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
  }
  const cursorCreatedAt = typeof cursor?.createdAt === "string" ? cursor.createdAt : "";
  if (cursor && requestedMode === "latest" && !cursorCreatedAt) {
    return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
  }
  const snapshotNow = requestedMode === "recommended" && cursor ? Number(cursor.at) : Date.now();
  if (requestedMode === "recommended" && !Number.isFinite(snapshotNow)) {
    return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
  }
  const encodedSnapshotMaxId = cursor ? Number(cursor.maxId) : null;
  if (cursor?.v === 4 && (!Number.isInteger(encodedSnapshotMaxId) || encodedSnapshotMaxId! < 0)) {
    return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
  }
  const snapshotMaxId = requestedMode === "recommended"
    ? (cursor?.v === 4
      ? encodedSnapshotMaxId!
      : Number((db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM community_posts").get() as { id: number }).id))
    : null;
  const filters = ["p.deleted_at IS NULL"];
  const filterParams: Array<string | number> = [];
  if (typeof category === "string" && category) {
    filters.push("p.category = ?");
    filterParams.push(category);
  }
  if (search) {
    filters.push("(p.content LIKE ? OR p.category LIKE ? OR u.username LIKE ? OR lr.title LIKE ?)");
    const pattern = `%${search}%`;
    filterParams.push(pattern, pattern, pattern, pattern);
  }
  if (requestedMode === "latest" && cursor) {
    filters.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
    filterParams.push(cursorCreatedAt, cursorCreatedAt, cursorId!);
  }
  if (requestedMode === "recommended") {
    filters.push("p.id <= ?");
    filterParams.push(snapshotMaxId!);
  }

  let sqlLimit = limit;
  let sqlOffset = 0;
  if (requestedMode === "recommended") {
    sqlLimit = RECOMMENDATION_CANDIDATE_LIMIT;
  } else if (cursorMode) {
    sqlLimit = pageSize + 1;
  } else {
    sqlLimit = limit;
    sqlOffset = offset;
  }
  const posts = db.prepare(`
    ${postSelect(userId)} WHERE ${filters.join(" AND ")}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(...filterParams, sqlLimit, sqlOffset);
  res.set("X-Pagination-Candidates", String(posts.length));

  const serialized = posts.map(serializePost);
  if (cursorMode) {
    let ordered = requestedMode === "recommended"
      ? recommendCommunityPosts(serialized, getRecommendationProfile(userId), snapshotNow)
      : serialized;
    if (cursor && requestedMode === "recommended") {
      const cursorIndex = ordered.findIndex((post) => post.id === cursorId);
      if (cursorIndex === -1) return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
      ordered = ordered.slice(cursorIndex + 1);
    }
    const items = ordered.slice(0, pageSize);
    const last = items.at(-1);
    const nextCursor = items.length === pageSize && last && ordered.length > pageSize
      ? encodeCursor(requestedMode === "latest"
        ? { v: 2, mode: requestedMode, category: typeof category === "string" ? category : "", createdAt: last.created_at, id: last.id }
        : { v: 4, mode: requestedMode, category: typeof category === "string" ? category : "", at: snapshotNow, maxId: snapshotMaxId, id: last.id })
      : null;
    return res.json({
      items,
      nextCursor,
    });
  }
  const ordered = requestedMode === "recommended"
    ? recommendCommunityPosts(serialized, getRecommendationProfile(userId))
    : serialized;
  res.json(requestedMode === "latest" ? ordered : ordered.slice(offset, offset + limit));
});

// GET /api/v1/community/posts/:id
router.get("/posts/:id", (req: AuthRequest, res) => {
  const userId = req.userId ?? null;
  const post = db.prepare(`${postSelect(userId)} WHERE p.id = ? AND p.deleted_at IS NULL`).get(req.params.id) as any;
  if (!post) {
    return res.status(404).json({ error: "帖子不存在" });
  }
  db.prepare("UPDATE community_posts SET views_count = views_count + 1 WHERE id = ?").run(req.params.id);
  res.json({ ...serializePost(post), views_count: (post.views_count || 0) + 1, is_liked: Boolean(post.is_liked) });
});

router.post("/posts/:id/share", shareRateLimit, (req: AuthRequest, res) => {
  const post = db.prepare("SELECT id FROM community_posts WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  const callerUserId = req.userId ?? null;
  const share = db.transaction(() => {
    db.prepare("DELETE FROM community_share_codes WHERE datetime(expires_at) <= CURRENT_TIMESTAMP").run();
    const existing = db.prepare(`
      SELECT code, expires_at
      FROM community_share_codes
      WHERE post_id = ?
        AND ((created_by = ?) OR (created_by IS NULL AND ? IS NULL))
        AND datetime(expires_at) > CURRENT_TIMESTAMP
      ORDER BY datetime(expires_at) DESC
      LIMIT 1
    `).get(req.params.id, callerUserId, callerUserId) as { code: string; expires_at: string } | undefined;
    if (existing) return { ...existing, created: false };

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomBytes(5).toString("hex").toUpperCase();
      try {
        db.prepare("INSERT INTO community_share_codes (code, post_id, created_by, expires_at) VALUES (?, ?, ?, ?)")
          .run(code, req.params.id, callerUserId, expiresAt);
        return { code, expires_at: expiresAt, created: true };
      } catch {
        // Retry the extremely unlikely random-code collision.
      }
    }
    return null;
  })();
  if (!share) return res.status(503).json({ error: "分享码生成失败，请稍后重试" });
  const baseUrl = String(process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  res.status(share.created ? 201 : 200).json({
    code: share.code,
    url: `${baseUrl}/share/posts/${share.code}`,
    app_url: `dietdigidose://post-detail?id=${req.params.id}&shareCode=${share.code}`,
    expires_at: share.expires_at,
  });
});

router.get("/shares/:code", (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const share = db.prepare(`
    SELECT s.post_id, s.expires_at
    FROM community_share_codes s
    JOIN community_posts p ON p.id = s.post_id
    WHERE s.code = ? AND s.expires_at > CURRENT_TIMESTAMP AND p.deleted_at IS NULL
  `).get(code) as { post_id: number; expires_at: string } | undefined;
  if (!share) return res.status(404).json({ error: "分享码无效或已过期" });
  res.json({ post_id: share.post_id, expires_at: share.expires_at });
});

// POST /api/v1/community/posts
router.post("/posts", authMiddleware, validateBody(communityPostSchema), (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) {
    return res.status(401).json({ error: "未登录" });
  }

  const { content, image_url, image_urls, category, event_start_at, event_end_at, linked_recipe_id } = req.body;
  const imageUrls = Array.isArray(image_urls)
    ? image_urls.filter((item): item is string => typeof item === "string").slice(0, 9)
    : [];
  if (typeof image_url === "string" && !imageUrls.length) imageUrls.push(image_url);
  const normalizedContent = String(content || "").trim();
  if (!normalizedContent && !imageUrls.length && !linked_recipe_id) {
    return res.status(400).json({ error: "动态内容、图片或关联菜谱不能为空" });
  }
  if (imageUrls.some((url) => !isStoredMediaUrlForUser(url, auth.userId))) {
    return res.status(400).json({ error: "图片必须先通过当前账号上传" });
  }
  const normalizedCategory = ["寻味", "榜单", "活动", "问答"].includes(category) ? category : "寻味";
  let linkedRecipeId: number | null = null;
  if (linked_recipe_id) {
    const linkedRecipe = db.prepare(`
      SELECT id FROM recipes
      WHERE id = ? AND deleted_at IS NULL AND status = 'approved'
        AND COALESCE(quality_status, 'trusted') <> 'needs_review'
    `).get(linked_recipe_id) as { id: number } | undefined;
    if (!linkedRecipe) {
      return res.status(400).json({ error: "关联菜谱不存在、尚未公开或需要复核", code: "LINKED_RECIPE_NOT_PUBLIC" });
    }
    linkedRecipeId = linkedRecipe.id;
  }
  let eventStartAt: string | null = null;
  let eventEndAt: string | null = null;
  if (normalizedCategory === "活动") {
    eventStartAt = String(event_start_at || "").trim();
    eventEndAt = String(event_end_at || "").trim();
    const startTime = new Date(eventStartAt).getTime();
    const endTime = new Date(eventEndAt).getTime();
    if (!eventStartAt || !eventEndAt || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return res.status(400).json({ error: "活动需要填写有效的开始和结束日期" });
    }
    if (endTime < startTime) return res.status(400).json({ error: "活动结束日期不能早于开始日期" });
  }
  const result = db.prepare(`
    INSERT INTO community_posts (
      user_id, username, avatar_url, category, content, image_url, image_urls,
      event_start_at, event_end_at, question_status, ip_location, linked_recipe_id, likes_count
    )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    auth.userId,
    auth.user.username || `食友${auth.userId}`,
    auth.user.avatar_url,
    normalizedCategory,
    normalizedContent,
    imageUrls[0] || null,
    imageUrls.length ? JSON.stringify(imageUrls) : null,
    eventStartAt,
    eventEndAt,
    normalizedCategory === "问答" ? "open" : null,
    getRequestLocation(req),
    linkedRecipeId,
  );

  const newPost = db.prepare(`${postSelect(auth.userId)} WHERE p.id = ?`).get(result.lastInsertRowid);
  res.status(201).json(serializePost(newPost));
});

// POST /api/v1/community/posts/:id/join - 参加或退出活动
router.post("/posts/:id/join", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const post = db.prepare(`
    SELECT id, category, event_end_at
    FROM community_posts
    WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.id) as { id: number; category: string; event_end_at: string | null } | undefined;
  if (!post || post.category !== "活动") return res.status(404).json({ error: "活动不存在" });

  const joined = db.prepare(
    "SELECT 1 FROM community_event_participants WHERE post_id = ? AND user_id = ?"
  ).get(post.id, auth.userId);
  if (!joined && post.event_end_at && new Date(post.event_end_at).getTime() < Date.now()) {
    return res.status(400).json({ error: "活动已结束" });
  }

  if (joined) {
    db.prepare("DELETE FROM community_event_participants WHERE post_id = ? AND user_id = ?")
      .run(post.id, auth.userId);
  } else {
    db.prepare("INSERT INTO community_event_participants (post_id, user_id) VALUES (?, ?)")
      .run(post.id, auth.userId);
  }
  const participantCount = (db.prepare(
    "SELECT COUNT(*) AS count FROM community_event_participants WHERE post_id = ?"
  ).get(post.id) as { count: number }).count;
  return res.json({ is_joined: !joined, participant_count: participantCount });
});

// POST /api/v1/community/posts/:id/like
router.post("/posts/:id/like", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) {
    return res.status(401).json({ error: "未登录" });
  }

  const postId = req.params.id;
  const post = db.prepare("SELECT id FROM community_posts WHERE id = ? AND deleted_at IS NULL").get(postId);
  if (!post) {
    return res.status(404).json({ error: "帖子不存在" });
  }
  const liked = db.prepare("SELECT 1 FROM community_post_likes WHERE post_id = ? AND user_id = ?").get(postId, auth.userId);
  const transaction = db.transaction(() => {
    if (liked) {
      db.prepare("DELETE FROM community_post_likes WHERE post_id = ? AND user_id = ?").run(postId, auth.userId);
      db.prepare("UPDATE community_posts SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?").run(postId);
      return false;
    }
    db.prepare("INSERT INTO community_post_likes (post_id, user_id) VALUES (?, ?)").run(postId, auth.userId);
    db.prepare("UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = ?").run(postId);
    return true;
  });
  const isLiked = transaction();
  const updated = db.prepare("SELECT likes_count FROM community_posts WHERE id = ?").get(postId);
  res.json({ ...(updated as object), is_liked: isLiked });
});

router.get("/posts/:id/comments", (req: AuthRequest, res) => {
  const userId = req.userId ?? -1;
  const comments = db.prepare(`
    SELECT
      c.*,
      COALESCE(u.is_verified_expert, 0) AS is_expert_answer,
      CASE WHEN p.accepted_comment_id = c.id THEN 1 ELSE 0 END AS is_accepted,
      EXISTS(SELECT 1 FROM community_comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?) AS is_liked
    FROM community_comments c
    JOIN community_posts p ON p.id = c.post_id
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? AND p.deleted_at IS NULL
    ORDER BY is_accepted DESC, c.likes_count DESC, c.created_at DESC
  `).all(userId, req.params.id);
  res.json(comments.map((comment: any) => {
    const { nickname: _legacyNickname, ...publicComment } = comment;
    return {
      ...publicComment,
      is_liked: Boolean(comment.is_liked),
      is_expert_answer: Boolean(comment.is_expert_answer),
      is_accepted: Boolean(comment.is_accepted),
    };
  }));
});

router.post("/posts/:id/comments", authMiddleware, validateBody(communityCommentSchema), (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const content = String(req.body.content || "").trim();
  const imageUrl = typeof req.body.image_url === "string" ? req.body.image_url : null;
  if (!content && !imageUrl) return res.status(400).json({ error: "评论内容或图片不能为空" });
  if (imageUrl && !isStoredMediaUrlForUser(imageUrl, auth.userId)) {
    return res.status(400).json({ error: "图片必须先通过当前账号上传" });
  }
  const post = db.prepare("SELECT id FROM community_posts WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  const publicName = auth.user.username || `食友${auth.userId}`;
  const result = db.prepare(`INSERT INTO community_comments (post_id, user_id, username, avatar_url, content, image_url) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.params.id, auth.userId, publicName, auth.user.avatar_url, content, imageUrl);
  db.prepare("UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = ?").run(req.params.id);
  const comment = db.prepare("SELECT * FROM community_comments WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({
    ...(comment as object),
    is_liked: false,
    is_expert_answer: Boolean(auth.user.is_verified_expert),
    is_accepted: false,
  });
});

// POST /api/v1/community/posts/:postId/comments/:commentId/accept - 提问者采纳回答
router.post("/posts/:postId/comments/:commentId/accept", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const post = db.prepare(`
    SELECT id, user_id, category, accepted_comment_id
    FROM community_posts
    WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.postId) as { id: number; user_id: number; category: string; accepted_comment_id: number | null } | undefined;
  if (!post || post.category !== "问答") return res.status(404).json({ error: "问题不存在" });
  if (post.user_id !== auth.userId) return res.status(403).json({ error: "只有提问者可以采纳回答" });
  const comment = db.prepare("SELECT id FROM community_comments WHERE id = ? AND post_id = ?")
    .get(req.params.commentId, post.id);
  if (!comment) return res.status(404).json({ error: "回答不存在" });

  const acceptedCommentId = post.accepted_comment_id === Number(req.params.commentId)
    ? null
    : Number(req.params.commentId);
  db.prepare(`
    UPDATE community_posts
    SET accepted_comment_id = ?, question_status = ?
    WHERE id = ?
  `).run(acceptedCommentId, acceptedCommentId ? "resolved" : "open", post.id);
  return res.json({
    accepted_comment_id: acceptedCommentId,
    question_status: acceptedCommentId ? "resolved" : "open",
  });
});

router.post("/comments/:id/like", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const comment = db.prepare(`
    SELECT c.id
    FROM community_comments c
    JOIN community_posts p ON p.id = c.post_id
    WHERE c.id = ? AND p.deleted_at IS NULL
  `).get(req.params.id);
  if (!comment) return res.status(404).json({ error: "评论不存在" });
  const liked = db.prepare("SELECT 1 FROM community_comment_likes WHERE comment_id = ? AND user_id = ?").get(req.params.id, auth.userId);
  const transaction = db.transaction(() => {
    if (liked) {
      db.prepare("DELETE FROM community_comment_likes WHERE comment_id = ? AND user_id = ?").run(req.params.id, auth.userId);
      db.prepare("UPDATE community_comments SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?").run(req.params.id);
      return false;
    }
    db.prepare("INSERT INTO community_comment_likes (comment_id, user_id) VALUES (?, ?)").run(req.params.id, auth.userId);
    db.prepare("UPDATE community_comments SET likes_count = likes_count + 1 WHERE id = ?").run(req.params.id);
    return true;
  });
  const isLiked = transaction();
  const updated = db.prepare("SELECT likes_count FROM community_comments WHERE id = ?").get(req.params.id);
  res.json({ ...(updated as object), is_liked: isLiked });
});

export default router;
