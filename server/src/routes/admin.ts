import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";
import { createAdminAIConfigRouter } from "./admin/ai-config.js";
import { createAdminUsersRouter } from "./admin/users.js";
import { createAdminCommunityRouter } from "./admin/community.js";
import { createAdminRecipesRouter } from "./admin/recipes.js";
import { createAdminAssetsRouter } from "./admin/assets.js";
import { auditAdminAction as audit } from "./admin/shared.js";

const router = Router();
router.param("id", positiveIntegerParam);

// 所有 admin 路由都需要登录 + admin 角色
router.use(authMiddleware);
router.use(requireAdmin);
router.use(createAdminAIConfigRouter());
router.use(createAdminUsersRouter());
router.use(createAdminCommunityRouter());
router.use(createAdminRecipesRouter());
router.use(createAdminAssetsRouter());

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
        COALESCE(ROUND(SUM(estimated_cost_usd), 6), 0) AS estimatedCostUsd,
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

    const failures = db.prepare(`
      SELECT endpoint, model, failure_reason AS failureReason, latency_ms AS latencyMs, created_at AS createdAt
      FROM ai_usage_logs
      ${whereClause ? `${whereClause} AND success = 0` : "WHERE success = 0"}
      ORDER BY created_at DESC
      LIMIT 20
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
      failures,
      users,
    });
  } catch (error) {
    console.error("[Admin AI Usage Error]", error);
    res.status(500).json({ error: "获取模型用量统计失败" });
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


export default router;
