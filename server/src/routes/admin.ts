import { Router } from "express";
import { db, getSystemSetting, logAdminAction, setSystemSetting } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { getAIConfig, chatCompletion, testAIConnection } from "../services/aiService.js";

const router = Router();

function audit(
  req: AuthRequest,
  event: {
    action: string;
    resourceType: string;
    resourceId?: string | number | null;
    summary: string;
    details?: Record<string, unknown>;
  },
) {
  if (!req.userId) return;
  logAdminAction({
    adminUserId: req.userId,
    ...event,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

function deletedFilter(status: unknown, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  if (status === "deleted") return `${prefix}deleted_at IS NOT NULL`;
  if (status === "all") return "1=1";
  return `${prefix}deleted_at IS NULL`;
}

// 所有 admin 路由都需要登录 + admin 角色
router.use(authMiddleware);
router.use(requireAdmin);

// 1. 获取统计数据
router.get("/stats", (req, res) => {
  try {
    const usersCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
    const postsCount = (db.prepare('SELECT COUNT(*) as count FROM community_posts WHERE deleted_at IS NULL').get() as any).count;
    const recipesCount = (db.prepare('SELECT COUNT(*) as count FROM recipes WHERE deleted_at IS NULL').get() as any).count;
    const inventoryCount = (db.prepare('SELECT COUNT(*) as count FROM inventory_items').get() as any).count;
    const kitchenwareCount = (db.prepare('SELECT COUNT(*) as count FROM kitchenware_items WHERE deleted_at IS NULL').get() as any).count;

    res.json({
      users: usersCount,
      posts: postsCount,
      recipes: recipesCount,
      inventory: inventoryCount,
      kitchenware: kitchenwareCount,
    });
  } catch (error) {
    res.status(500).json({ error: "获取统计失败" });
  }
});

// 2. 获取用户列表
router.get("/users", (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, nickname, avatar_url, role, is_verified_expert, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "获取用户列表失败" });
  }
});

// 管理员操作审计日志
router.get("/audit-logs", (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 20));
    const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
    const resourceType = typeof req.query.resourceType === "string" ? req.query.resourceType.trim() : "";
    const filters: string[] = [];
    const params: string[] = [];

    if (action) {
      filters.push("l.action = ?");
      params.push(action);
    }
    if (resourceType) {
      filters.push("l.resource_type = ?");
      params.push(resourceType);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = (db.prepare(`
      SELECT COUNT(*) AS count
      FROM admin_audit_logs l
      ${where}
    `).get(...params) as { count: number }).count;
    const items = db.prepare(`
      SELECT
        l.id,
        l.admin_user_id AS adminUserId,
        COALESCE(u.nickname, u.username, '已删除管理员') AS adminName,
        l.action,
        l.resource_type AS resourceType,
        l.resource_id AS resourceId,
        l.summary,
        l.details_json AS detailsJson,
        l.ip_address AS ipAddress,
        l.user_agent AS userAgent,
        l.created_at AS createdAt
      FROM admin_audit_logs l
      LEFT JOIN users u ON u.id = l.admin_user_id
      ${where}
      ORDER BY l.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);

    res.json({ items, total, page, pageSize });
  } catch (error) {
    console.error("[Admin Audit Logs Error]", error);
    res.status(500).json({ error: "获取审计日志失败" });
  }
});

// AI 食材图片识别任务：用于排查卡住、失败和高频重复提交，不暴露图片原文。
router.get("/inventory-scan-jobs", (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const userQuery = typeof req.query.user === "string" ? req.query.user.trim() : "";
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (["queued", "processing", "completed", "failed"].includes(status)) {
      conditions.push("j.status = ?");
      params.push(status);
    }
    if (userQuery) {
      conditions.push("(u.username LIKE ? OR COALESCE(u.nickname, '') LIKE ? OR CAST(u.id AS TEXT) LIKE ?)");
      const pattern = `%${userQuery}%`;
      params.push(pattern, pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT j.id, j.status, j.result_json AS resultJson, j.error_message AS errorMessage,
             j.created_at AS createdAt, j.updated_at AS updatedAt,
             u.id AS userId, u.username, u.nickname
      FROM inventory_scan_jobs j
      JOIN users u ON u.id = j.user_id
      ${where}
      ORDER BY j.created_at DESC
      LIMIT 100
    `).all(...params) as Array<Record<string, unknown>>;
    const items = rows.map((row) => {
      let itemCount = 0;
      try { itemCount = JSON.parse(String(row.resultJson || "[]")).length || 0; } catch { /* keep zero */ }
      const { resultJson: _resultJson, ...job } = row;
      return { ...job, itemCount };
    });
    res.json({ items });
  } catch (error) {
    console.error("[Admin Inventory Scan Jobs Error]", error);
    res.status(500).json({ error: "获取图片识别任务失败" });
  }
});

router.get("/inventory-scan-jobs/:jobId", (req, res) => {
  try {
    const job = db.prepare(`
      SELECT j.id, j.status, j.result_json AS resultJson, j.error_message AS errorMessage,
             j.created_at AS createdAt, j.updated_at AS updatedAt,
             u.id AS userId, u.username, u.nickname
      FROM inventory_scan_jobs j
      JOIN users u ON u.id = j.user_id
      WHERE j.id = ?
    `).get(req.params.jobId) as Record<string, unknown> | undefined;
    if (!job) return res.status(404).json({ error: "识别任务不存在" });
    let items: unknown[] = [];
    try { items = JSON.parse(String(job.resultJson || "[]")); } catch { /* malformed historic result */ }
    const { resultJson: _resultJson, ...detail } = job;
    return res.json({ ...detail, items });
  } catch (error) {
    console.error("[Admin Inventory Scan Job Detail Error]", error);
    return res.status(500).json({ error: "获取识别任务详情失败" });
  }
});

// AI 对话审计：会话列表与逐轮详情。仅管理员可访问，方便处理用户反馈和模型质量问题。
router.get("/chat-conversations", (req, res) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    const where = query ? "WHERE u.username LIKE ? OR COALESCE(u.nickname, '') LIKE ? OR CAST(u.id AS TEXT) LIKE ?" : "";
    const params = query ? [`%${query}%`, `%${query}%`, `%${query}%`] : [];
    const items = db.prepare(`
      SELECT m.user_id AS userId, m.session_id AS sessionId,
             u.username, u.nickname,
             SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS turnCount,
             COUNT(*) AS messageCount,
             MAX(m.created_at) AS updatedAt,
             (
               SELECT content FROM ai_chat_messages last_user
               WHERE last_user.user_id = m.user_id AND last_user.session_id = m.session_id AND last_user.role = 'user'
               ORDER BY last_user.id DESC LIMIT 1
             ) AS lastUserMessage
      FROM ai_chat_messages m
      JOIN users u ON u.id = m.user_id
      ${where}
      GROUP BY m.user_id, m.session_id
      ORDER BY MAX(m.id) DESC
      LIMIT 100
    `).all(...params);
    return res.json({ items });
  } catch (error) {
    console.error("[Admin AI Conversations Error]", error);
    return res.status(500).json({ error: "获取 AI 对话记录失败" });
  }
});

router.get("/chat-conversations/:userId/:sessionId", (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || !req.params.sessionId) return res.status(400).json({ error: "会话参数无效" });
    const user = db.prepare("SELECT id, username, nickname FROM users WHERE id = ?").get(userId) as { id: number; username: string; nickname: string | null } | undefined;
    if (!user) return res.status(404).json({ error: "用户不存在" });
    const messages = db.prepare(`
      SELECT id, role, content, created_at AS createdAt
      FROM ai_chat_messages
      WHERE user_id = ? AND session_id = ?
      ORDER BY id ASC
    `).all(userId, req.params.sessionId);
    if (!messages.length) return res.status(404).json({ error: "对话不存在" });
    return res.json({ user, sessionId: req.params.sessionId, messages });
  } catch (error) {
    console.error("[Admin AI Conversation Detail Error]", error);
    return res.status(500).json({ error: "获取 AI 对话详情失败" });
  }
});

// 软删除资源回收站
router.get("/trash", (req, res) => {
  try {
    const community = db.prepare(`
      SELECT id, content AS title, deleted_at AS deletedAt
      FROM community_posts
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `).all();
    const recipes = db.prepare(`
      SELECT id, title, deleted_at AS deletedAt
      FROM recipes
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `).all();
    const ingredients = db.prepare(`
      SELECT id, name AS title, deleted_at AS deletedAt
      FROM ingredients_library
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `).all();
    const kitchenware = db.prepare(`
      SELECT id, name AS title, deleted_at AS deletedAt
      FROM kitchenware_items
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
    `).all();
    res.json({ community, recipes, ingredients, kitchenware });
  } catch (error) {
    res.status(500).json({ error: "获取回收站失败" });
  }
});

router.post("/trash/:resource/:id/restore", (req: AuthRequest, res) => {
  try {
    const resources: Record<string, { table: string; label: string }> = {
      community: { table: "community_posts", label: "社区帖子" },
      recipes: { table: "recipes", label: "食谱" },
      ingredients: { table: "ingredients_library", label: "食材" },
      kitchenware: { table: "kitchenware_items", label: "厨具" },
    };
    const resourceKey = String(req.params.resource);
    const resource = resources[resourceKey];
    const id = Number(req.params.id);
    if (!resource || !Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "无效的回收站资源" });
    }
    const result = db.prepare(`
      UPDATE ${resource.table}
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = ? AND deleted_at IS NOT NULL
    `).run(id);
    if (!result.changes) {
      return res.status(404).json({ error: "回收站中未找到该记录" });
    }
    audit(req, {
      action: `${resourceKey}.restore`,
      resourceType: resourceKey,
      resourceId: id,
      summary: `恢复${resource.label}`,
    });
    return res.json({ success: true, message: `${resource.label}已恢复` });
  } catch (error) {
    return res.status(500).json({ error: "恢复记录失败" });
  }
});

const AI_USAGE_RANGES: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

// 获取模型用量总览，并可按单个用户筛选
router.get("/ai-usage", (req, res) => {
  try {
    const range = typeof req.query.range === "string" && req.query.range in AI_USAGE_RANGES
      ? req.query.range
      : "30d";
    const rangeDays = AI_USAGE_RANGES[range];
    const requestedUserId = req.query.userId === undefined ? null : Number(req.query.userId);

    if (requestedUserId !== null && (!Number.isInteger(requestedUserId) || requestedUserId <= 0)) {
      return res.status(400).json({ error: "无效的用户 ID" });
    }

    if (requestedUserId !== null) {
      const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(requestedUserId);
      if (!userExists) {
        return res.status(404).json({ error: "用户不存在" });
      }
    }

    const filters: string[] = [];
    const params: Array<number | string> = [];
    if (rangeDays !== null) {
      filters.push("created_at >= datetime('now', ?)");
      params.push(`-${rangeDays} days`);
    }
    if (requestedUserId !== null) {
      filters.push("user_id = ?");
      params.push(requestedUserId);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const summary = db.prepare(`
      SELECT
        COUNT(*) AS requests,
        COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
        COALESCE(SUM(completion_tokens), 0) AS completionTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(ROUND(AVG(latency_ms)), 0) AS avgLatencyMs,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1), 0) AS successRate,
        COUNT(DISTINCT user_id) AS activeUsers
      FROM ai_usage_logs
      ${whereClause}
    `).get(...params);

    const trend = db.prepare(`
      SELECT
        date(created_at) AS date,
        COUNT(*) AS requests,
        COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
        COALESCE(SUM(completion_tokens), 0) AS completionTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens
      FROM ai_usage_logs
      ${whereClause}
      GROUP BY date(created_at)
      ORDER BY date(created_at) ASC
    `).all(...params);

    const models = db.prepare(`
      SELECT
        model,
        COUNT(*) AS requests,
        COALESCE(SUM(total_tokens), 0) AS totalTokens
      FROM ai_usage_logs
      ${whereClause}
      GROUP BY model
      ORDER BY totalTokens DESC, requests DESC
    `).all(...params);

    const endpoints = db.prepare(`
      SELECT
        endpoint,
        COUNT(*) AS requests,
        COALESCE(SUM(total_tokens), 0) AS totalTokens
      FROM ai_usage_logs
      ${whereClause}
      GROUP BY endpoint
      ORDER BY totalTokens DESC, requests DESC
    `).all(...params);

    const joinFilters: string[] = [];
    const userParams: Array<number | string> = [];
    if (rangeDays !== null) {
      joinFilters.push("l.created_at >= datetime('now', ?)");
      userParams.push(`-${rangeDays} days`);
    }
    const users = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.nickname,
        u.avatar_url AS avatarUrl,
        COUNT(l.id) AS requests,
        COALESCE(SUM(l.prompt_tokens), 0) AS promptTokens,
        COALESCE(SUM(l.completion_tokens), 0) AS completionTokens,
        COALESCE(SUM(l.total_tokens), 0) AS totalTokens,
        COALESCE(ROUND(AVG(l.latency_ms)), 0) AS avgLatencyMs,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN l.success = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(l.id), 0), 1), 0) AS successRate,
        MAX(l.created_at) AS lastUsedAt
      FROM users u
      LEFT JOIN ai_usage_logs l
        ON l.user_id = u.id
        ${joinFilters.length ? `AND ${joinFilters.join(" AND ")}` : ""}
      GROUP BY u.id
      ORDER BY totalTokens DESC, requests DESC, u.id ASC
    `).all(...userParams);

    res.json({
      range,
      selectedUserId: requestedUserId,
      summary,
      trend,
      models,
      endpoints,
      users,
    });
  } catch (error) {
    console.error("[Admin AI Usage Error]", error);
    res.status(500).json({ error: "获取模型用量统计失败" });
  }
});

// 3. 修改用户角色
router.put("/users/:id/role", (req: AuthRequest, res) => {
  try {
    const { role } = req.body;
    const userId = Number(req.params.id);
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: "无效的角色类型" });
    }
    
    // 不允许取消自己的 admin 权限（防止误操作导致没有管理员）
    if (Number(userId) === (req as any).userId && role !== 'admin') {
      return res.status(400).json({ error: "不能取消自身的管理员权限" });
    }

    const previous = db.prepare("SELECT username, role FROM users WHERE id = ?").get(userId) as
      | { username: string; role: string }
      | undefined;
    const stmt = db.prepare(`UPDATE users SET role = ? WHERE id = ?`);
    const info = stmt.run(role, userId);
    
    if (info.changes > 0) {
      audit(req, {
        action: "user.role.update",
        resourceType: "user",
        resourceId: userId,
        summary: `修改用户 ${previous?.username || userId} 的角色`,
        details: { before: previous?.role, after: role },
      });
      res.json({ success: true, message: "角色更新成功" });
    } else {
      res.status(404).json({ error: "未找到该用户" });
    }
  } catch (error) {
    res.status(500).json({ error: "更新用户角色失败" });
  }
});

router.put("/users/:id/expert", (req: AuthRequest, res) => {
  try {
    const userId = Number(req.params.id);
    const isVerifiedExpert = req.body.is_verified_expert === true || req.body.is_verified_expert === 1;
    const previous = db.prepare("SELECT username, is_verified_expert FROM users WHERE id = ?").get(userId) as
      | { username: string; is_verified_expert: number }
      | undefined;
    if (!previous) return res.status(404).json({ error: "未找到该用户" });
    db.prepare("UPDATE users SET is_verified_expert = ? WHERE id = ?").run(isVerifiedExpert ? 1 : 0, userId);
    audit(req, {
      action: "user.expert.update",
      resourceType: "user",
      resourceId: userId,
      summary: `${isVerifiedExpert ? "认证" : "取消认证"}专业用户 ${previous.username}`,
      details: { before: Boolean(previous.is_verified_expert), after: isVerifiedExpert },
    });
    return res.json({ success: true, is_verified_expert: isVerifiedExpert });
  } catch {
    return res.status(500).json({ error: "更新专业认证失败" });
  }
});

// 4. 获取社区内容列表
router.get("/community", (req, res) => {
  try {
    const posts = db.prepare(`
      SELECT
        p.*,
        COALESCE(u.is_verified_expert, 0) AS author_is_expert,
        (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id) AS comment_count,
        (SELECT COUNT(*) FROM community_event_participants ep WHERE ep.post_id = p.id) AS participant_count
      FROM community_posts p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE ${deletedFilter(req.query.status, "p")}
      ORDER BY p.created_at DESC
    `).all();
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: "获取社区帖子失败" });
  }
});

// 5. 删除社区内容
router.delete("/community/:id", (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const post = db.prepare("SELECT content FROM community_posts WHERE id = ? AND deleted_at IS NULL").get(postId) as
      | { content: string }
      | undefined;
    const info = db.prepare(`
      UPDATE community_posts
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(req.userId, postId);
    if (info.changes > 0) {
      audit(req, {
        action: "community.delete",
        resourceType: "community",
        resourceId: postId,
        summary: "将社区帖子移入回收站",
        details: { contentPreview: post?.content.slice(0, 80) },
      });
      res.json({ success: true, message: "帖子已移入回收站" });
    } else {
      res.status(404).json({ error: "未找到该帖子" });
    }
  } catch (error) {
    res.status(500).json({ error: "删除帖子失败" });
  }
});

router.get("/community/:id/comments", (req, res) => {
  try {
    const comments = db.prepare(`
      SELECT
        c.id, c.post_id, c.username, c.nickname, c.avatar_url, c.content, c.likes_count, c.created_at,
        COALESCE(u.is_verified_expert, 0) AS is_expert_answer,
        CASE WHEN p.accepted_comment_id = c.id THEN 1 ELSE 0 END AS is_accepted
      FROM community_comments c
      JOIN community_posts p ON p.id = c.post_id
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ?
      ORDER BY is_accepted DESC, c.likes_count DESC, c.created_at DESC
    `).all(Number(req.params.id));
    res.json(comments);
  } catch {
    res.status(500).json({ error: "获取评论失败" });
  }
});

router.delete("/community/comments/:id", (req: AuthRequest, res) => {
  try {
    const comment = db.prepare("SELECT post_id, content FROM community_comments WHERE id = ?").get(Number(req.params.id)) as { post_id: number; content: string } | undefined;
    if (!comment) return res.status(404).json({ error: "评论不存在" });
    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE community_posts
        SET accepted_comment_id = NULL, question_status = 'open'
        WHERE id = ? AND accepted_comment_id = ?
      `).run(comment.post_id, Number(req.params.id));
      db.prepare("DELETE FROM community_comments WHERE id = ?").run(Number(req.params.id));
      db.prepare("UPDATE community_posts SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?").run(comment.post_id);
    });
    transaction();
    audit(req, { action: "community.comment.delete", resourceType: "community_comment", resourceId: String(req.params.id), summary: "删除社区评论", details: { contentPreview: comment.content.slice(0, 80) } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "删除评论失败" });
  }
});

router.put("/community/:id/event", (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const startAt = String(req.body.event_start_at || "").trim();
    const endAt = String(req.body.event_end_at || "").trim();
    const startTime = new Date(startAt).getTime();
    const endTime = new Date(endAt).getTime();
    if (!startAt || !endAt || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return res.status(400).json({ error: "请输入有效的活动开始和结束时间" });
    }
    if (endTime < startTime) return res.status(400).json({ error: "活动结束时间不能早于开始时间" });
    const post = db.prepare("SELECT category, event_start_at, event_end_at FROM community_posts WHERE id = ? AND deleted_at IS NULL")
      .get(postId) as { category: string; event_start_at: string | null; event_end_at: string | null } | undefined;
    if (!post || post.category !== "活动") return res.status(404).json({ error: "活动不存在" });
    db.prepare("UPDATE community_posts SET event_start_at = ?, event_end_at = ? WHERE id = ?")
      .run(startAt, endAt, postId);
    audit(req, {
      action: "community.event.update",
      resourceType: "community",
      resourceId: postId,
      summary: "修改社区活动时间",
      details: { before: { start: post.event_start_at, end: post.event_end_at }, after: { start: startAt, end: endAt } },
    });
    return res.json({ success: true, event_start_at: startAt, event_end_at: endAt });
  } catch {
    return res.status(500).json({ error: "更新活动失败" });
  }
});

router.put("/community/:id/question", (req: AuthRequest, res) => {
  try {
    const postId = Number(req.params.id);
    const status = req.body.question_status === "resolved" ? "resolved" : "open";
    const requestedCommentId = req.body.accepted_comment_id == null ? null : Number(req.body.accepted_comment_id);
    const post = db.prepare("SELECT category, accepted_comment_id, question_status FROM community_posts WHERE id = ? AND deleted_at IS NULL")
      .get(postId) as { category: string; accepted_comment_id: number | null; question_status: string | null } | undefined;
    if (!post || post.category !== "问答") return res.status(404).json({ error: "问题不存在" });
    let acceptedCommentId: number | null = null;
    if (status === "resolved" && requestedCommentId) {
      const comment = db.prepare("SELECT id FROM community_comments WHERE id = ? AND post_id = ?").get(requestedCommentId, postId);
      if (!comment) return res.status(400).json({ error: "采纳回答不属于当前问题" });
      acceptedCommentId = requestedCommentId;
    }
    if (status === "resolved" && !acceptedCommentId) return res.status(400).json({ error: "解决问题前请选择采纳回答" });
    db.prepare("UPDATE community_posts SET question_status = ?, accepted_comment_id = ? WHERE id = ?")
      .run(status, acceptedCommentId, postId);
    audit(req, {
      action: "community.question.update",
      resourceType: "community",
      resourceId: postId,
      summary: status === "resolved" ? "管理员采纳问答回复" : "管理员将问题重新打开",
      details: { before: post, after: { question_status: status, accepted_comment_id: acceptedCommentId } },
    });
    return res.json({ success: true, question_status: status, accepted_comment_id: acceptedCommentId });
  } catch {
    return res.status(500).json({ error: "更新问题状态失败" });
  }
});

// 6. 获取食谱列表
router.get("/recipes", (req, res) => {
  try {
    const filters = [deletedFilter(req.query.deleted, "r")];
    const params: string[] = [];
    if (req.query.source === "official" || req.query.source === "user") {
      filters.push("r.source = ?");
      params.push(req.query.source);
    }
    if (["pending", "approved", "rejected"].includes(String(req.query.reviewStatus))) {
      filters.push("r.status = ?");
      params.push(String(req.query.reviewStatus));
    }
    const recipes = db.prepare(`
      SELECT
        r.*,
        u.username AS author_username,
        u.nickname AS author_nickname,
        u.avatar_url AS author_avatar_url
      FROM recipes r
      LEFT JOIN users u ON u.id = r.author_user_id
      WHERE ${filters.join(" AND ")}
      ORDER BY
        CASE r.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
        r.updated_at DESC,
        r.created_at DESC
    `).all(...params);
    res.json(recipes);
  } catch (error) {
    res.status(500).json({ error: "获取食谱列表失败" });
  }
});

// 7. 添加食谱
router.post("/recipes", (req: AuthRequest, res) => {
  try {
    const { title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json } = req.body;
    
    const stmt = db.prepare(`
      INSERT INTO recipes (
        title, description, image_url, cook_time, difficulty, calories,
        protein, carbs, fat, category, tags, steps_json, ingredients_json,
        source, status, reviewed_by, reviewed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official', 'approved', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const info = stmt.run(
      title,
      description,
      image_url,
      cook_time,
      difficulty,
      calories,
      protein,
      carbs,
      fat,
      category,
      tags,
      steps_json,
      ingredients_json,
      req.userId,
    );
    
    audit(req, {
      action: "recipe.create",
      resourceType: "recipes",
      resourceId: Number(info.lastInsertRowid),
      summary: `创建食谱：${title}`,
    });
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "添加食谱失败" });
  }
});

// 8. 修改食谱
router.put("/recipes/:id", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json } = req.body;
    
    const stmt = db.prepare(`
      UPDATE recipes 
      SET title=?, description=?, image_url=?, cook_time=?, difficulty=?, calories=?, protein=?, carbs=?, fat=?, category=?, tags=?, steps_json=?, ingredients_json=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at IS NULL
    `);
    const info = stmt.run(title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json, id);
    
    if (info.changes > 0) {
      audit(req, {
        action: "recipe.update",
        resourceType: "recipes",
        resourceId: id,
        summary: `更新食谱：${title}`,
      });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "食谱未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "修改食谱失败" });
  }
});

router.post("/recipes/:id/approve", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const recipe = db.prepare(`
      SELECT title, status
      FROM recipes
      WHERE id = ? AND source = 'user' AND deleted_at IS NULL
    `).get(id) as { title: string; status: string } | undefined;
    if (!recipe) return res.status(404).json({ error: "未找到用户投稿" });

    db.prepare(`
      UPDATE recipes
      SET
        status = 'approved',
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP,
        reject_reason = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.userId, id);
    audit(req, {
      action: "recipe_submission.approve",
      resourceType: "recipes",
      resourceId: id,
      summary: `审核通过用户食谱：${recipe.title}`,
      details: { before: recipe.status, after: "approved" },
    });
    return res.json({ success: true, message: "用户食谱已审核通过" });
  } catch (error) {
    return res.status(500).json({ error: "审核食谱失败" });
  }
});

router.post("/recipes/:id/reject", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 2 || reason.length > 300) {
      return res.status(400).json({ error: "请填写 2-300 字的驳回原因" });
    }
    const recipe = db.prepare(`
      SELECT title, status
      FROM recipes
      WHERE id = ? AND source = 'user' AND deleted_at IS NULL
    `).get(id) as { title: string; status: string } | undefined;
    if (!recipe) return res.status(404).json({ error: "未找到用户投稿" });

    db.prepare(`
      UPDATE recipes
      SET
        status = 'rejected',
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP,
        reject_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.userId, reason, id);
    audit(req, {
      action: "recipe_submission.reject",
      resourceType: "recipes",
      resourceId: id,
      summary: `驳回用户食谱：${recipe.title}`,
      details: { before: recipe.status, after: "rejected", reason },
    });
    return res.json({ success: true, message: "用户食谱已驳回" });
  } catch (error) {
    return res.status(500).json({ error: "驳回食谱失败" });
  }
});

// 9. 删除食谱
router.delete("/recipes/:id", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const recipe = db.prepare("SELECT title FROM recipes WHERE id = ? AND deleted_at IS NULL").get(id) as
      | { title: string }
      | undefined;
    const info = db.prepare(`
      UPDATE recipes
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(req.userId, id);
    if (info.changes > 0) {
      audit(req, {
        action: "recipe.delete",
        resourceType: "recipes",
        resourceId: id,
        summary: `将食谱移入回收站：${recipe?.title || id}`,
      });
      res.json({ success: true, message: "食谱已移入回收站" });
    } else {
      res.status(404).json({ error: "食谱未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "删除食谱失败" });
  }
});

// 厨具资产管理
router.get("/kitchenware", (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const filters = ["k.deleted_at IS NULL"];
    const params: string[] = [];
    if (search) {
      filters.push("(k.name LIKE ? OR k.note LIKE ? OR u.username LIKE ? OR u.nickname LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    if (category && category !== "全部") {
      filters.push("k.category = ?");
      params.push(category);
    }
    if (status && status !== "全部") {
      filters.push("k.status = ?");
      params.push(status);
    }
    const items = db.prepare(`
      SELECT
        k.*,
        u.username AS owner_username,
        u.nickname AS owner_nickname
      FROM kitchenware_items k
      JOIN users u ON u.id = k.user_id
      WHERE ${filters.join(" AND ")}
      ORDER BY k.updated_at DESC, k.id DESC
    `).all(...params);
    return res.json(items);
  } catch (error) {
    console.error("[Admin Kitchenware List Error]", error);
    return res.status(500).json({ error: "获取厨具列表失败" });
  }
});

router.put("/kitchenware/:id/status", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").trim();
  const allowedStatuses = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "无效的厨具状态" });
  }
  const item = db.prepare(`
    SELECT name FROM kitchenware_items WHERE id = ? AND deleted_at IS NULL
  `).get(id) as { name: string } | undefined;
  if (!item) return res.status(404).json({ error: "厨具不存在" });

  db.prepare(`
    UPDATE kitchenware_items
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(status, id);
  audit(req, {
    action: "kitchenware.status_update",
    resourceType: "kitchenware",
    resourceId: id,
    summary: `更新厨具状态：${item.name} → ${status}`,
  });
  return res.json({ success: true, message: "厨具状态已更新" });
});

router.delete("/kitchenware/:id", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`
    SELECT name FROM kitchenware_items WHERE id = ? AND deleted_at IS NULL
  `).get(id) as { name: string } | undefined;
  if (!item) return res.status(404).json({ error: "厨具不存在" });

  db.prepare(`
    UPDATE kitchenware_items
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(req.userId, id);
  audit(req, {
    action: "kitchenware.delete",
    resourceType: "kitchenware",
    resourceId: id,
    summary: `将厨具移入回收站：${item.name}`,
  });
  return res.json({ success: true, message: "厨具已移入回收站" });
});

// 10. 获取基础食材库
router.get("/ingredients", (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));
    const params: Array<string | number> = [];
    let where = deletedFilter(req.query.status);
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      where += ' AND (name LIKE ? OR brands LIKE ? OR barcode LIKE ?)';
      const term = `%${req.query.search.trim()}%`;
      params.push(term, term, term);
    }
    if (typeof req.query.category === 'string' && req.query.category !== '全部') {
      where += ' AND category = ?'; params.push(req.query.category);
    }
    if (typeof req.query.source === 'string' && req.query.source !== '全部') {
      where += ' AND source = ?'; params.push(req.query.source);
    }
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM ingredients_library WHERE ${where}`).get(...params) as { count: number }).count;
    const items = db.prepare(`SELECT * FROM ingredients_library WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    res.json({ items, total, page, pageSize });
  } catch (error) {
    res.status(500).json({ error: "获取食材库失败" });
  }
});

// 10.1 管理员添加官方标准食材
router.post("/ingredients", (req: AuthRequest, res) => {
  try {
    const { name, calories_100g, protein_100g, carbs_100g, fat_100g, source } = req.body;
    if (!name || calories_100g === undefined) {
      return res.status(400).json({ error: "食材名称和热量为必填项" });
    }

    const stmt = db.prepare(`
      INSERT INTO ingredients_library (name, calories_100g, protein_100g, carbs_100g, fat_100g, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      name,
      Number(calories_100g) || 0,
      Number(protein_100g) || 0,
      Number(carbs_100g) || 0,
      Number(fat_100g) || 0,
      source || 'official'
    );

    audit(req, {
      action: "ingredient.create",
      resourceType: "ingredients",
      resourceId: Number(info.lastInsertRowid),
      summary: `创建食材：${name}`,
    });
    res.json({ success: true, id: info.lastInsertRowid, message: "食材添加成功" });
  } catch (error) {
    res.status(500).json({ error: "添加食材失败" });
  }
});

// 10.2 管理员删除官方标准食材
router.delete("/ingredients/:id", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const ingredient = db.prepare("SELECT name FROM ingredients_library WHERE id = ? AND deleted_at IS NULL").get(id) as
      | { name: string }
      | undefined;
    const info = db.prepare(`
      UPDATE ingredients_library
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(req.userId, id);
    if (info.changes > 0) {
      audit(req, {
        action: "ingredient.delete",
        resourceType: "ingredients",
        resourceId: id,
        summary: `将食材移入回收站：${ingredient?.name || id}`,
      });
      res.json({ success: true, message: "食材已移入回收站" });
    } else {
      res.status(404).json({ error: "食材未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "删除食材失败" });
  }
});

// 10.3 管理员编辑官方标准食材
router.put("/ingredients/:id", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { name, calories_100g, protein_100g, carbs_100g, fat_100g, category, source } = req.body;
    if (!name || calories_100g === undefined) {
      return res.status(400).json({ error: "食材名称和热量为必填项" });
    }

    const stmt = db.prepare(`
      UPDATE ingredients_library 
      SET name=?, calories_100g=?, protein_100g=?, carbs_100g=?, fat_100g=?, category=?, source=?
      WHERE id=? AND deleted_at IS NULL
    `);
    const info = stmt.run(
      name,
      Number(calories_100g) || 0,
      Number(protein_100g) || 0,
      Number(carbs_100g) || 0,
      Number(fat_100g) || 0,
      category || null,
      source || 'official',
      id
    );

    if (info.changes > 0) {
      audit(req, {
        action: "ingredient.update",
        resourceType: "ingredients",
        resourceId: id,
        summary: `更新食材：${name}`,
      });
      res.json({ success: true, message: "食材更新成功" });
    } else {
      res.status(404).json({ error: "食材未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "更新食材失败" });
  }
});

// 10.4 获取趋势统计（近7天）
router.get("/stats/trends", (req, res) => {
  try {
    const days = 7;
    const trends: { date: string; users: number; records: number; posts: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const dateExpr = `date('now', '-${i} days')`;
      const usersCount = (db.prepare(
        `SELECT COUNT(*) as count FROM users WHERE date(created_at) = ${dateExpr}`
      ).get() as any).count;

      const recordsCount = (db.prepare(
        `SELECT COUNT(*) as count FROM diet_records WHERE date(created_at) = ${dateExpr}`
      ).get() as any).count;

      const postsCount = (db.prepare(
        `SELECT COUNT(*) as count FROM community_posts WHERE deleted_at IS NULL AND date(created_at) = ${dateExpr}`
      ).get() as any).count;

      // Get the actual date string
      const dateStr = (db.prepare(`SELECT ${dateExpr} as d`).get() as any).d;

      trends.push({
        date: dateStr,
        users: usersCount,
        records: recordsCount,
        posts: postsCount,
      });
    }

    res.json(trends);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "获取趋势数据失败" });
  }
});

// 10.5 获取最新动态
router.get("/stats/recent", (req, res) => {
  try {
    const recentUsers = db.prepare(
      'SELECT id, username, nickname, avatar_url, created_at FROM users ORDER BY created_at DESC LIMIT 5'
    ).all();

    const recentPosts = db.prepare(
      'SELECT id, username, nickname, content, image_url, category, created_at FROM community_posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5'
    ).all();

    const pendingFoods = db.prepare(`
      SELECT ucf.id, ucf.name, ucf.calories_100g, ucf.created_at, u.nickname as author_name
      FROM user_custom_foods ucf
      LEFT JOIN users u ON ucf.user_id = u.id
      WHERE ucf.status = 'pending'
      ORDER BY ucf.created_at DESC
      LIMIT 5
    `).all();

    res.json({ recentUsers, recentPosts, pendingFoods });
  } catch (error) {
    res.status(500).json({ error: "获取最新动态失败" });
  }
});

// 11. 获取待审核的自定义食材
router.get("/custom-foods/pending", (req, res) => {
  try {
    const pending = db.prepare(`
      SELECT ucf.*, u.nickname as author_name 
      FROM user_custom_foods ucf
      LEFT JOIN users u ON ucf.user_id = u.id
      WHERE ucf.status = 'pending'
      ORDER BY ucf.created_at DESC
    `).all();
    res.json(pending);
  } catch (error) {
    res.status(500).json({ error: "获取待审核食材失败" });
  }
});

// 12. 审核通过 UGC 食材
router.post("/custom-foods/:id/approve", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const item = db.prepare('SELECT * FROM user_custom_foods WHERE id = ?').get(id) as any;
    if (!item) {
      return res.status(404).json({ error: "记录未找到" });
    }

    db.transaction(() => {
      // 1. Update status
      db.prepare("UPDATE user_custom_foods SET status = 'approved' WHERE id = ?").run(id);
      
      // 2. Insert into library
      db.prepare(`
        INSERT INTO ingredients_library (name, calories_100g, protein_100g, carbs_100g, fat_100g, source)
        VALUES (?, ?, ?, ?, ?, 'ugc')
      `).run(item.name, item.calories_100g, item.protein_100g, item.carbs_100g, item.fat_100g);
    })();

    audit(req, {
      action: "custom_food.approve",
      resourceType: "custom_food",
      resourceId: id,
      summary: `审核通过自定义食材：${item.name}`,
    });
    res.json({ success: true, message: "审核通过并已入库" });
  } catch (error) {
    res.status(500).json({ error: "操作失败" });
  }
});

// 13. 拒绝 UGC 食材
router.post("/custom-foods/:id/reject", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const item = db.prepare("SELECT name FROM user_custom_foods WHERE id = ?").get(id) as
      | { name: string }
      | undefined;
    db.prepare("UPDATE user_custom_foods SET status = 'rejected' WHERE id = ?").run(id);
    audit(req, {
      action: "custom_food.reject",
      resourceType: "custom_food",
      resourceId: id,
      summary: `驳回自定义食材：${item?.name || id}`,
    });
    res.json({ success: true, message: "已拒绝" });
  } catch (error) {
    res.status(500).json({ error: "操作失败" });
  }
});

// 14. 获取 AI 全局配置
router.get("/ai-config", (req, res) => {
  try {
    const config = getAIConfig();
    // 脱敏 Key 返回给前端展示
    const maskedKey = config.apiKey
      ? config.apiKey.length > 8
        ? `${config.apiKey.slice(0, 4)}****${config.apiKey.slice(-4)}`
        : "********"
      : "";

    res.json({
      maskedKey,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      visionModel: config.visionModel,
      isConfiguredFromDB: !!getSystemSetting("AI_API_KEY"),
    });
  } catch (error) {
    res.status(500).json({ error: "获取 AI 配置失败" });
  }
});

// 15. 保存 AI 全局配置
router.put("/ai-config", (req: AuthRequest, res) => {
  try {
    const { apiKey, baseUrl, model, visionModel } = req.body;

    if (typeof apiKey === "string" && apiKey.trim()) setSystemSetting("AI_API_KEY", apiKey.trim());
    if (baseUrl !== undefined) setSystemSetting("AI_BASE_URL", baseUrl.trim());
    if (model !== undefined) setSystemSetting("AI_MODEL", model.trim());
    if (visionModel !== undefined) setSystemSetting("AI_VISION_MODEL", visionModel.trim());

    audit(req, {
      action: "ai_config.update",
      resourceType: "ai_config",
      resourceId: "global",
      summary: "更新 AI 模型服务配置",
      details: {
        apiKeyChanged: typeof apiKey === "string" && !!apiKey.trim(),
        baseUrlChanged: baseUrl !== undefined,
        modelChanged: model !== undefined,
        visionModelChanged: visionModel !== undefined,
      },
    });
    res.json({ success: true, message: "AI 配置更新成功" });
  } catch (error) {
    res.status(500).json({ error: "更新 AI 配置失败" });
  }
});

// 16. 真实测试 AI 连接响应与延迟
router.post("/ai-config/test", async (req, res) => {
  try {
    const { apiKey, baseUrl, model } = req.body;
    const result = await testAIConnection({ apiKey, baseUrl, model });
    res.json({ success: true, reply: result.reply, latencyMs: result.latencyMs });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, details: error.message });
  }
});

export default router;
