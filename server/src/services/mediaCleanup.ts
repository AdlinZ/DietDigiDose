import { db } from "../storage/db.js";
import { deleteStoredMediaUrls } from "./mediaStorage.js";

type MediaCleanupJob = {
  id: number;
  owner_user_id: number;
  urls_json: string;
  status: "pending" | "processing" | "completed";
};

export function enqueueMediaCleanup(userId: number, urls: Array<string | null | undefined>) {
  const storedUrls = [...new Set(urls.filter((url): url is string => typeof url === "string" && url.length > 0))];
  if (!storedUrls.length) return null;
  const result = db.prepare(`
    INSERT INTO media_cleanup_jobs (owner_user_id, urls_json)
    VALUES (?, ?)
  `).run(userId, JSON.stringify(storedUrls));
  return Number(result.lastInsertRowid);
}

export async function processMediaCleanupJob(jobId: number) {
  const job = db.prepare(`
    SELECT id, owner_user_id, urls_json, status
    FROM media_cleanup_jobs WHERE id = ?
  `).get(jobId) as MediaCleanupJob | undefined;
  if (!job || job.status === "completed") return false;

  const parsed: unknown = JSON.parse(job.urls_json);
  if (!Array.isArray(parsed) || parsed.some((url) => typeof url !== "string")) {
    throw new Error(`媒体清理任务 ${jobId} 的 URL 数据无效`);
  }

  db.prepare(`
    UPDATE media_cleanup_jobs
    SET status = 'processing', attempts = attempts + 1, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(jobId);
  try {
    await deleteStoredMediaUrls(job.owner_user_id, parsed);
    db.prepare(`
      UPDATE media_cleanup_jobs
      SET status = 'completed', last_error = NULL, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(jobId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE media_cleanup_jobs
      SET status = 'pending', last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(message.slice(0, 1000), jobId);
    throw error;
  }
}

export async function processPendingMediaCleanupJobs(limit = 25) {
  const jobs = db.prepare(`
    SELECT id FROM media_cleanup_jobs
    WHERE status IN ('pending', 'processing')
    ORDER BY created_at ASC, id ASC LIMIT ?
  `).all(Math.max(1, Math.min(limit, 100))) as Array<{ id: number }>;
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
