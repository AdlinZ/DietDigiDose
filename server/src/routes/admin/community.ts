import { Router } from "express";
import { db } from "../../storage/db.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { adminEventSchema, adminQuestionSchema } from "../../validation/schemas.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { auditAdminAction as audit, deletedFilter } from "./shared.js";

const router = Router();
router.param("id", positiveIntegerParam);

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

router.put("/community/:id/event", validateBody(adminEventSchema), (req: AuthRequest, res) => {
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

router.put("/community/:id/question", validateBody(adminQuestionSchema), (req: AuthRequest, res) => {
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

export function createAdminCommunityRouter() {
  return router;
}

