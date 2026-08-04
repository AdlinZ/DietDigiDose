import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, optionalAuthMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { communityCommentSchema, communityPostSchema } from "../validation/schemas.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";

const router = Router();
router.param("id", positiveIntegerParam);
router.param("postId", positiveIntegerParam);
router.param("commentId", positiveIntegerParam);
router.use(optionalAuthMiddleware);

function getAuthenticatedUser(req: AuthRequest): { userId: number; user: any } | null {
  if (!req.userId) return null;
  const user = db.prepare("SELECT id, username, avatar_url, role, is_verified_expert FROM users WHERE id = ?").get(req.userId);
  return user ? { userId: req.userId, user } : null;
}

function postSelect(userId: number | null) {
  return `
    SELECT
      p.*,
      COALESCE(u.is_verified_expert, 0) AS author_is_expert,
      (SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id = p.id) AS actual_comment_count,
      EXISTS(SELECT 1 FROM community_post_likes l WHERE l.post_id = p.id AND l.user_id = ${userId ?? -1}) AS is_liked,
      (SELECT COUNT(*) FROM community_event_participants ep WHERE ep.post_id = p.id) AS participant_count,
      EXISTS(SELECT 1 FROM community_event_participants ep WHERE ep.post_id = p.id AND ep.user_id = ${userId ?? -1}) AS is_joined
    FROM community_posts p
    LEFT JOIN users u ON u.id = p.user_id
  `;
}

function serializePost(post: any) {
  if (!post) return post;
  const { actual_comment_count: actualCommentCount, ...serializedPost } = post;
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
    author_is_expert: Boolean(post.author_is_expert),
    comment_count: Number(actualCommentCount ?? post.comment_count) || 0,
  };
}

/**
 * A deliberately small, explainable ranker.  It gives a new community member a
 * useful feed without needing a separate recommendation service or opaque model.
 */
function recommendPosts(posts: any[], userId: number | null) {
  const likedCategories = new Map<string, number>();
  let healthGoal = "healthy";
  let dietaryPreference = "";

  if (userId) {
    const liked = db.prepare(`
      SELECT p.category, COUNT(*) AS count
      FROM community_post_likes l
      JOIN community_posts p ON p.id = l.post_id
      WHERE l.user_id = ? AND p.deleted_at IS NULL
      GROUP BY p.category
    `).all(userId) as Array<{ category: string; count: number }>;
    liked.forEach((item) => likedCategories.set(item.category || "寻味", item.count));
    const profile = db.prepare("SELECT health_goal, dietary_preference FROM user_health_profiles WHERE user_id = ?").get(userId) as any;
    healthGoal = profile?.health_goal || healthGoal;
    dietaryPreference = profile?.dietary_preference || "";
  }

  const goalKeywords: Record<string, string[]> = {
    lose_weight: ["减脂", "低卡", "轻食", "控糖", "高纤"],
    reduce_fat: ["减脂", "低卡", "轻食", "控糖", "高纤"],
    gain_muscle: ["增肌", "高蛋白", "力量", "鸡胸", "牛肉"],
    maintain: ["均衡", "家常", "营养", "早餐"],
    healthy: ["营养", "健康", "蔬菜", "低糖", "均衡"],
  };
  const keywords = goalKeywords[healthGoal] || goalKeywords.healthy;
  const preferences = dietaryPreference.split(/[、,，/\s]+/).filter((value: string) => value.length > 1 && value !== "无特别偏好");
  const now = Date.now();

  const ranked = posts.map((post) => {
    const text = `${post.content || ""} ${post.category || ""}`.toLowerCase();
    const reasons: string[] = [];
    let score = Math.log1p(Number(post.likes_count) || 0) * 5 + Math.log1p(Number(post.comment_count) || 0) * 3;
    const createdAt = new Date(String(post.created_at).replace(" ", "T") + (String(post.created_at).includes("Z") ? "" : "Z")).getTime();
    const ageHours = Number.isFinite(createdAt) ? Math.max(0, (now - createdAt) / 3_600_000) : 72;
    score += Math.max(0, 18 - ageHours * 0.35);
    if (ageHours < 24) reasons.push("新鲜发布");
    if ((likedCategories.get(post.category || "寻味") || 0) > 0) {
      score += 24;
      reasons.push("符合你的点赞偏好");
    }
    if (keywords.some((keyword) => text.includes(keyword))) {
      score += 20;
      reasons.push("贴合你的健康目标");
    }
    if (preferences.some((preference: string) => text.includes(preference.toLowerCase()))) {
      score += 16;
      reasons.push("符合饮食偏好");
    }
    if ((post.likes_count || 0) >= 100) reasons.push("社区热议");
    return { ...post, recommendation_score: Math.round(score * 10) / 10, recommendation_reason: reasons[0] || "社区热议" };
  }).sort((a, b) => b.recommendation_score - a.recommendation_score || b.id - a.id);

  // Avoid placing three posts from one category together when other choices exist.
  const result: any[] = [];
  const remaining = [...ranked];
  while (remaining.length) {
    const previousCategories = result.slice(-2).map((item) => item.category);
    const index = remaining.findIndex((item) => !previousCategories.every((category) => category === item.category));
    result.push(remaining.splice(index === -1 ? 0 : index, 1)[0]);
  }
  return result;
}

// GET /api/v1/community/users?query=xxx
// 提及选择器只需要最少的公开资料，避免把用户完整资料暴露给评论端。
router.get("/users", authMiddleware, (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const query = String(req.query.query || "").trim();
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
  const users = db.prepare(`
    SELECT id, username, avatar_url
    FROM users
    WHERE id != ? AND username LIKE ? ESCAPE '\\'
    ORDER BY id DESC
    LIMIT 12
  `).all(auth.userId, pattern);
  res.json(users);
});

// GET /api/v1/community/posts
router.get("/posts", (req: AuthRequest, res) => {
  const { category, sort } = req.query;
  const userId = req.userId ?? null;
  let posts;
  if (category) {
    posts = db.prepare(`
      ${postSelect(userId)} WHERE p.category = ? AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `).all(category);
  } else {
    posts = db.prepare(`
      ${postSelect(userId)} WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `).all();
  }

  const serialized = posts.map(serializePost);
  res.json(sort === "recommended" ? recommendPosts(serialized, userId) : serialized);
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

// POST /api/v1/community/posts
router.post("/posts", authMiddleware, validateBody(communityPostSchema), (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) {
    return res.status(401).json({ error: "未登录" });
  }

  const { content, image_url, image_urls, category, event_start_at, event_end_at } = req.body;
  const imageUrls = Array.isArray(image_urls)
    ? image_urls.filter((item): item is string => typeof item === "string").slice(0, 9)
    : [];
  if (typeof image_url === "string" && !imageUrls.length) imageUrls.push(image_url);
  const normalizedContent = String(content || "").trim();
  if (!normalizedContent && !imageUrls.length) {
    return res.status(400).json({ error: "动态内容或图片不能为空" });
  }
  const normalizedCategory = ["寻味", "榜单", "活动", "问答"].includes(category) ? category : "寻味";
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
      user_id, username, nickname, avatar_url, category, content, image_url, image_urls,
      event_start_at, event_end_at, question_status, likes_count
    )
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    auth.userId,
    auth.user.username,
    auth.user.avatar_url,
    normalizedCategory,
    normalizedContent,
    imageUrls[0] || null,
    imageUrls.length ? JSON.stringify(imageUrls) : null,
    eventStartAt,
    eventEndAt,
    normalizedCategory === "问答" ? "open" : null,
  );

  const newPost = db.prepare("SELECT * FROM community_posts WHERE id = ?").get(result.lastInsertRowid);
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
    WHERE c.post_id = ?
    ORDER BY is_accepted DESC, c.likes_count DESC, c.created_at DESC
  `).all(userId, req.params.id);
  res.json(comments.map((comment: any) => ({
    ...comment,
    is_liked: Boolean(comment.is_liked),
    is_expert_answer: Boolean(comment.is_expert_answer),
    is_accepted: Boolean(comment.is_accepted),
  })));
});

router.post("/posts/:id/comments", authMiddleware, validateBody(communityCommentSchema), (req: AuthRequest, res) => {
  const auth = getAuthenticatedUser(req);
  if (!auth) return res.status(401).json({ error: "未登录" });
  const content = String(req.body.content || "").trim();
  const imageUrl = typeof req.body.image_url === "string" ? req.body.image_url : null;
  if (!content && !imageUrl) return res.status(400).json({ error: "评论内容或图片不能为空" });
  const post = db.prepare("SELECT id FROM community_posts WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!post) return res.status(404).json({ error: "帖子不存在" });
  const result = db.prepare(`INSERT INTO community_comments (post_id, user_id, username, nickname, avatar_url, content, image_url) VALUES (?, ?, ?, NULL, ?, ?, ?)`)
    .run(req.params.id, auth.userId, auth.user.username, auth.user.avatar_url, content, imageUrl);
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
  const comment = db.prepare("SELECT id FROM community_comments WHERE id = ?").get(req.params.id);
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
