import { Router } from "express";
import { db } from "../../storage/db.js";
import { sendError } from "../../utils/http.js";

const taskNames = new Set(["notifications", "media-cleanup"]);
const statuses = new Set(["running", "completed", "failed"]);

export function createAdminWorkerRunsRouter() {
  const router = Router();

  router.get("/worker-runs", (req, res) => {
    const taskName = typeof req.query.task === "string" ? req.query.task.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    if (taskName && !taskNames.has(taskName)) return sendError(res, 400, "后台任务类型无效", "INVALID_WORKER_TASK");
    if (status && !statuses.has(status)) return sendError(res, 400, "后台任务状态无效", "INVALID_WORKER_STATUS");

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 20));
    const filters: string[] = [];
    const params: string[] = [];
    if (taskName) { filters.push("task_name = ?"); params.push(taskName); }
    if (status) { filters.push("status = ?"); params.push(status); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM worker_task_runs ${where}`)
      .get(...params) as { count: number }).count;
    const items = db.prepare(`
      SELECT id, task_name AS taskName, worker_id AS workerId, status,
        started_at AS startedAt, finished_at AS finishedAt, duration_ms AS durationMs,
        processed_count AS processed, succeeded_count AS succeeded, failed_count AS failed,
        result_json AS resultJson, error_message AS errorMessage
      FROM worker_task_runs ${where}
      ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown> & { resultJson: string | null }>;
    const leases = db.prepare(`SELECT task_name AS taskName, owner_id AS ownerId,
      lease_expires_at AS leaseExpiresAt, updated_at AS updatedAt
      FROM worker_task_leases ORDER BY task_name`).all();

    return res.json({
      items: items.map(({ resultJson, ...item }) => ({
        ...item,
        result: resultJson ? JSON.parse(resultJson) : {},
      })),
      leases,
      total,
      page,
      pageSize,
    });
  });

  return router;
}
