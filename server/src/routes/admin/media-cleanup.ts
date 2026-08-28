import { Router } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import {
  MEDIA_CLEANUP_STALE_MINUTES,
  processMediaCleanupJob,
  sanitizeMediaCleanupError,
  type MediaCleanupJob,
} from "../../services/mediaCleanup.js";
import { db } from "../../storage/db.js";
import { auditAdminAction } from "./shared.js";

const filterStatuses = ["all", "attention", "pending", "processing", "completed", "failing", "stale"] as const;
type FilterStatus = typeof filterStatuses[number];

type MediaCleanupJobRow = MediaCleanupJob & {
  age_seconds: number;
  is_stale: number;
};

function parseUrlCount(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").length : 0;
  } catch {
    return 0;
  }
}

function publicJob(row: MediaCleanupJobRow) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    urlCount: parseUrlCount(row.urls_json),
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error ? sanitizeMediaCleanupError(row.last_error) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    claimedAt: row.claimed_at,
    ageSeconds: Math.max(0, Number(row.age_seconds) || 0),
    stale: Boolean(row.is_stale),
    eligibleForRetry: row.status === "pending" || Boolean(row.is_stale),
  };
}

function getJobRow(jobId: number) {
  return db.prepare(`
    SELECT *,
      ROUND((julianday('now') - julianday(created_at)) * 86400) AS age_seconds,
      CASE WHEN status = 'processing'
        AND COALESCE(claimed_at, updated_at) <= datetime('now', ?)
        THEN 1 ELSE 0 END AS is_stale
    FROM media_cleanup_jobs WHERE id = ?
  `).get(`-${MEDIA_CLEANUP_STALE_MINUTES} minutes`, jobId) as MediaCleanupJobRow | undefined;
}

export function createAdminMediaCleanupRouter() {
  const router = Router();
  router.param("id", positiveIntegerParam);

  router.get("/media-cleanup-jobs", (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
      const requestedStatus = typeof req.query.status === "string" ? req.query.status : "all";
      const status: FilterStatus = filterStatuses.includes(requestedStatus as FilterStatus)
        ? requestedStatus as FilterStatus
        : "all";
      const olderThanHours = Math.min(24 * 365, Math.max(0, Number(req.query.olderThanHours) || 0));
      const staleModifier = `-${MEDIA_CLEANUP_STALE_MINUTES} minutes`;
      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (status === "pending" || status === "processing" || status === "completed") {
        conditions.push("status = ?");
        params.push(status);
      } else if (status === "attention") {
        conditions.push("status IN ('pending', 'processing')");
      } else if (status === "failing") {
        conditions.push("status = 'pending' AND attempts >= 3");
      } else if (status === "stale") {
        conditions.push("status = 'processing' AND COALESCE(claimed_at, updated_at) <= datetime('now', ?)");
        params.push(staleModifier);
      }
      if (olderThanHours > 0) {
        conditions.push("created_at <= datetime('now', ?)");
        params.push(`-${olderThanHours} hours`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const total = (db.prepare(`SELECT COUNT(*) AS count FROM media_cleanup_jobs ${where}`).get(...params) as { count: number }).count;
      const rows = db.prepare(`
        SELECT *,
          ROUND((julianday('now') - julianday(created_at)) * 86400) AS age_seconds,
          CASE WHEN status = 'processing'
            AND COALESCE(claimed_at, updated_at) <= datetime('now', ?)
            THEN 1 ELSE 0 END AS is_stale
        FROM media_cleanup_jobs
        ${where}
        ORDER BY
          CASE
            WHEN status = 'processing' AND COALESCE(claimed_at, updated_at) <= datetime('now', ?) THEN 0
            WHEN status = 'pending' AND attempts >= 3 THEN 1
            WHEN status = 'pending' THEN 2
            WHEN status = 'processing' THEN 3
            ELSE 4
          END,
          created_at ASC,
          id ASC
        LIMIT ? OFFSET ?
      `).all(staleModifier, ...params, staleModifier, pageSize, (page - 1) * pageSize) as MediaCleanupJobRow[];
      const summary = db.prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'pending' AND attempts >= 3 THEN 1 ELSE 0 END) AS failing,
          SUM(CASE WHEN status = 'processing'
            AND COALESCE(claimed_at, updated_at) <= datetime('now', ?)
            THEN 1 ELSE 0 END) AS stale
        FROM media_cleanup_jobs
      `).get(staleModifier) as Record<string, number | null>;
      return res.json({
        items: rows.map(publicJob),
        total,
        page,
        pageSize,
        status,
        olderThanHours,
        staleAfterMinutes: MEDIA_CLEANUP_STALE_MINUTES,
        summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value) || 0])),
      });
    } catch (error) {
      console.error("[Admin Media Cleanup List Error]", error);
      return res.status(500).json({ error: "获取媒体清理任务失败", code: "MEDIA_CLEANUP_LIST_FAILED" });
    }
  });

  router.post("/media-cleanup-jobs/:id/retry", async (req: AuthRequest, res) => {
    const jobId = Number(req.params.id);
    const before = getJobRow(jobId);
    if (!before) return res.status(404).json({ error: "媒体清理任务不存在", code: "MEDIA_CLEANUP_JOB_NOT_FOUND" });
    if (before.status === "completed") {
      return res.status(409).json({ error: "已完成的媒体清理任务无需重试", code: "MEDIA_CLEANUP_ALREADY_COMPLETED" });
    }
    if (before.status === "processing" && !before.is_stale) {
      return res.status(409).json({ error: "媒体清理任务正在执行，请稍后再试", code: "MEDIA_CLEANUP_JOB_BUSY" });
    }

    try {
      const processed = await processMediaCleanupJob(jobId);
      if (!processed) {
        return res.status(409).json({ error: "媒体清理任务已被其他执行器接管", code: "MEDIA_CLEANUP_JOB_CLAIMED" });
      }
      const after = getJobRow(jobId)!;
      auditAdminAction(req, {
        action: "media_cleanup.retry",
        resourceType: "media_cleanup_job",
        resourceId: jobId,
        summary: `人工重试媒体清理任务 #${jobId} 成功`,
        details: { outcome: "completed", attempts: after.attempts, urlCount: parseUrlCount(after.urls_json) },
      });
      return res.json({ success: true, job: publicJob(after) });
    } catch (error) {
      const message = sanitizeMediaCleanupError(error);
      const after = getJobRow(jobId);
      auditAdminAction(req, {
        action: "media_cleanup.retry",
        resourceType: "media_cleanup_job",
        resourceId: jobId,
        summary: `人工重试媒体清理任务 #${jobId} 失败`,
        details: { outcome: "failed", attempts: after?.attempts ?? before.attempts + 1, error: message },
      });
      return res.status(502).json({ error: "媒体清理重试失败", code: "MEDIA_CLEANUP_RETRY_FAILED", details: message });
    }
  });

  return router;
}
