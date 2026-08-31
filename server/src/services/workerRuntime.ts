import { randomUUID } from "node:crypto";
import { db } from "../storage/db.js";
import { logger } from "../utils/logger.js";

export type WorkerTaskName = "notifications" | "media-cleanup";

export type WorkerTaskResult = {
  processed: number;
  succeeded: number;
  failed: number;
  details?: Record<string, unknown>;
};

export type WorkerTaskRunResult = {
  acquired: boolean;
  runId?: string;
  status?: "completed" | "failed";
  result?: WorkerTaskResult;
  error?: string;
};

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 1_000);
}

export function acquireWorkerTaskLease(taskName: WorkerTaskName, workerId: string, leaseMs: number) {
  const leaseSeconds = Math.ceil(positiveInteger(leaseMs, 10 * 60_000) / 1_000);
  const result = db.prepare(`
    INSERT INTO worker_task_leases (task_name, owner_id, lease_expires_at)
    VALUES (?, ?, datetime('now', ?))
    ON CONFLICT(task_name) DO UPDATE SET
      owner_id = excluded.owner_id,
      lease_expires_at = excluded.lease_expires_at,
      updated_at = CURRENT_TIMESTAMP
    WHERE worker_task_leases.owner_id = excluded.owner_id
      OR worker_task_leases.lease_expires_at <= CURRENT_TIMESTAMP
  `).run(taskName, workerId, `+${leaseSeconds} seconds`);
  return result.changes > 0;
}

export function releaseWorkerTaskLease(taskName: WorkerTaskName, workerId: string) {
  return db.prepare("DELETE FROM worker_task_leases WHERE task_name = ? AND owner_id = ?")
    .run(taskName, workerId).changes > 0;
}

async function notifyWorkerFailure(payload: Record<string, unknown>) {
  const webhookUrl = process.env.ERROR_MONITOR_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "worker.task.failed", timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`monitor returned ${response.status}`);
  } catch (error) {
    logger.warn("error_monitor.delivery_failed", { source: "worker", message: sanitizeError(error) });
  }
}

export async function runManagedWorkerTask(options: {
  taskName: WorkerTaskName;
  workerId: string;
  leaseMs?: number;
  timeoutMs?: number;
  run: () => Promise<WorkerTaskResult>;
}): Promise<WorkerTaskRunResult> {
  const leaseMs = positiveInteger(options.leaseMs ?? 0, 10 * 60_000);
  const timeoutMs = Math.min(leaseMs, positiveInteger(options.timeoutMs ?? 0, 5 * 60_000));
  if (!acquireWorkerTaskLease(options.taskName, options.workerId, leaseMs)) {
    logger.info("worker.task.skipped", { taskName: options.taskName, workerId: options.workerId, reason: "lease_held" });
    return { acquired: false };
  }

  const runId = randomUUID();
  const startedAt = Date.now();
  db.prepare(`INSERT INTO worker_task_runs (id, task_name, worker_id, status)
    VALUES (?, ?, ?, 'running')`).run(runId, options.taskName, options.workerId);
  logger.info("worker.task.started", { taskName: options.taskName, workerId: options.workerId, runId });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`task exceeded ${timeoutMs}ms timeout`)), timeoutMs);
      timeout.unref?.();
    });
    const result = await Promise.race([options.run(), timeoutPromise]);
    const durationMs = Date.now() - startedAt;
    const status = result.failed > 0 ? "failed" : "completed";
    const errorMessage = result.failed > 0 ? `${result.failed} item(s) failed` : null;
    db.prepare(`UPDATE worker_task_runs SET status = ?, finished_at = CURRENT_TIMESTAMP,
      duration_ms = ?, processed_count = ?, succeeded_count = ?, failed_count = ?, result_json = ?,
      error_message = ? WHERE id = ?`).run(
      status,
      durationMs,
      result.processed,
      result.succeeded,
      result.failed,
      JSON.stringify(result.details ?? {}),
      errorMessage,
      runId,
    );
    const payload = {
      taskName: options.taskName,
      workerId: options.workerId,
      runId,
      durationMs,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    };
    if (status === "failed") {
      logger.error("worker.task.failed", { ...payload, message: errorMessage });
      await notifyWorkerFailure({ ...payload, message: errorMessage });
    } else {
      logger.info("worker.task.completed", payload);
    }
    return { acquired: true, runId, status, result, ...(errorMessage ? { error: errorMessage } : {}) };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = sanitizeError(error);
    db.prepare(`UPDATE worker_task_runs SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
      duration_ms = ?, failed_count = 1, error_message = ? WHERE id = ?`)
      .run(durationMs, message, runId);
    const payload = { taskName: options.taskName, workerId: options.workerId, runId, durationMs, message };
    logger.error("worker.task.failed", payload);
    await notifyWorkerFailure(payload);
    return { acquired: true, runId, status: "failed", error: message };
  } finally {
    if (timeout) clearTimeout(timeout);
    releaseWorkerTaskLease(options.taskName, options.workerId);
  }
}
