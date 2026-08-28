import { randomUUID } from "node:crypto";
import { db } from "../storage/db.js";
import { deleteStoredMediaUrls } from "./mediaStorage.js";

export const MEDIA_CLEANUP_STALE_MINUTES = 30;

export type MediaCleanupJob = {
  id: number;
  owner_user_id: number;
  urls_json: string;
  status: "pending" | "processing" | "completed";
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  claim_token: string | null;
  claimed_at: string | null;
};

export function sanitizeMediaCleanupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"']+/gi, "[已隐藏 URL]")
    .replace(/\/media\/uploads\/[^\s"']+/gi, "[已隐藏媒体路径]")
    .replace(/\/storage\/v1\/object\/[^\s"']+/gi, "[已隐藏对象路径]")
    .replace(/\bcommunity\/\d+\/[^\s"',;]+/gi, "[已隐藏对象键]")
    .replace(/\b(?:service[_ -]?role|api)[_ -]?key\b\s*[:=]\s*[^\s,;]+/gi, "[已隐藏凭据]")
    .slice(0, 500);
}

export function enqueueMediaCleanup(userId: number, urls: Array<string | null | undefined>) {
  const storedUrls = [...new Set(urls.filter((url): url is string => typeof url === "string" && url.length > 0))];
  if (!storedUrls.length) return null;
  const result = db.prepare(`
    INSERT INTO media_cleanup_jobs (owner_user_id, urls_json)
    VALUES (?, ?)
  `).run(userId, JSON.stringify(storedUrls));
  return Number(result.lastInsertRowid);
}

export function claimMediaCleanupJob(jobId: number, staleMinutes = MEDIA_CLEANUP_STALE_MINUTES) {
  const claimToken = randomUUID();
  const staleModifier = `-${Math.max(1, Math.min(Math.floor(staleMinutes), 24 * 60))} minutes`;
  const claimed = db.prepare(`
    UPDATE media_cleanup_jobs
    SET status = 'processing', attempts = attempts + 1, last_error = NULL,
      claim_token = ?, claimed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (
      status = 'pending'
      OR (
        status = 'processing'
        AND COALESCE(claimed_at, updated_at) <= datetime('now', ?)
      )
    )
  `).run(claimToken, jobId, staleModifier);
  if (!claimed.changes) return null;
  return db.prepare(`
    SELECT id, owner_user_id, urls_json, status, attempts, last_error,
      created_at, updated_at, completed_at, claim_token, claimed_at
    FROM media_cleanup_jobs WHERE id = ? AND claim_token = ?
  `).get(jobId, claimToken) as MediaCleanupJob | undefined || null;
}

export async function processMediaCleanupJob(jobId: number) {
  const job = claimMediaCleanupJob(jobId);
  if (!job || !job.claim_token) return false;

  try {
    const parsed: unknown = JSON.parse(job.urls_json);
    if (!Array.isArray(parsed) || parsed.some((url) => typeof url !== "string")) {
      throw new Error(`媒体清理任务 ${jobId} 的 URL 数据无效`);
    }
    await deleteStoredMediaUrls(job.owner_user_id, parsed);
    const completed = db.prepare(`
      UPDATE media_cleanup_jobs
      SET status = 'completed', last_error = NULL, claim_token = NULL, claimed_at = NULL,
        updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing' AND claim_token = ?
    `).run(jobId, job.claim_token);
    return completed.changes > 0;
  } catch (error) {
    const message = sanitizeMediaCleanupError(error);
    db.prepare(`
      UPDATE media_cleanup_jobs
      SET status = 'pending', last_error = ?, claim_token = NULL, claimed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing' AND claim_token = ?
    `).run(message, jobId, job.claim_token);
    throw error;
  }
}

export async function processPendingMediaCleanupJobs(limit = 25) {
  const jobs = db.prepare(`
    SELECT id FROM media_cleanup_jobs
    WHERE status = 'pending'
      OR (
        status = 'processing'
        AND COALESCE(claimed_at, updated_at) <= datetime('now', ?)
      )
    ORDER BY created_at ASC, id ASC LIMIT ?
  `).all(`-${MEDIA_CLEANUP_STALE_MINUTES} minutes`, Math.max(1, Math.min(limit, 100))) as Array<{ id: number }>;
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      if (await processMediaCleanupJob(job.id)) completed += 1;
    } catch (error) {
      failed += 1;
      console.error(`Unable to process media cleanup job ${job.id}:`, error);
    }
  }
  return { checked: jobs.length, completed, failed };
}

export function startMediaCleanupScheduler() {
  const run = () => void processPendingMediaCleanupJobs().catch((error) => {
    console.error("Unable to process pending media cleanup jobs:", error);
  });
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return timer;
}
