import os from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { initializeSqliteWorker } from "./composition/sqliteRuntime.js";
import { checkExpoPushReceipts, sendExpiringInventoryNotifications } from "./services/notifications.js";
import { processPendingMediaCleanupJobs } from "./modules/mediaCleanup/index.js";
import { runManagedWorkerTask, type WorkerTaskName, type WorkerTaskRunResult } from "./modules/worker/index.js";
import { logger } from "./utils/logger.js";

const supportedTasks: WorkerTaskName[] = ["notifications", "media-cleanup"];

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function selectedTasks() {
  const taskArgument = process.argv.find((argument) => argument.startsWith("--task="))?.slice("--task=".length);
  const configured = taskArgument || process.env.WORKER_TASKS || supportedTasks.join(",");
  const tasks = configured.split(",").map((task) => task.trim()).filter(Boolean);
  for (const task of tasks) {
    if (!supportedTasks.includes(task as WorkerTaskName)) {
      throw new Error(`Unsupported worker task: ${task}. Expected ${supportedTasks.join(", ")}`);
    }
  }
  if (!tasks.length) throw new Error("WORKER_TASKS must select at least one task");
  return [...new Set(tasks)] as WorkerTaskName[];
}

export async function runWorkerCycle(workerId: string, tasks = selectedTasks()) {
  const leaseMs = numberFromEnv("WORKER_LEASE_MS", 10 * 60_000);
  const timeoutMs = numberFromEnv("WORKER_TASK_TIMEOUT_MS", 5 * 60_000);
  const results: WorkerTaskRunResult[] = [];
  for (const taskName of tasks) {
    const run = taskName === "notifications"
      ? async () => {
          const receipts = await checkExpoPushReceipts();
          const notifications = await sendExpiringInventoryNotifications();
          return {
            processed: receipts.checked + notifications.recipients,
            succeeded: receipts.checked + notifications.recipients - notifications.failedRecipients,
            failed: notifications.failedRecipients,
            details: {
              receiptsChecked: receipts.checked,
              pushRecipients: notifications.recipients,
              pushMessages: notifications.messages,
              failedRecipients: notifications.failedRecipients,
            },
          };
        }
      : async () => {
          const cleanup = await processPendingMediaCleanupJobs(numberFromEnv("MEDIA_CLEANUP_BATCH_SIZE", 25));
          return {
            processed: cleanup.checked,
            succeeded: cleanup.completed,
            failed: cleanup.failed,
            details: cleanup,
          };
        };
    results.push(await runManagedWorkerTask({ taskName, workerId, leaseMs, timeoutMs, run }));
  }
  return results;
}

async function main() {
  initializeSqliteWorker();
  const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const once = process.argv.includes("--once");
  const intervalMs = numberFromEnv("WORKER_INTERVAL_MS", 60 * 60_000);
  let stopping = false;
  let running = false;

  const stop = (signal: string) => {
    stopping = true;
    logger.info("worker.stopping", { workerId, signal });
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  logger.info("worker.started", { workerId, tasks: selectedTasks(), once, intervalMs });
  do {
    if (!running) {
      running = true;
      try {
        await runWorkerCycle(workerId);
      } finally {
        running = false;
      }
    }
    if (once || stopping) break;
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        process.off("SIGINT", finish);
        process.off("SIGTERM", finish);
      };
      const finish = () => {
        clearTimeout(timer);
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, intervalMs);
      process.once("SIGINT", finish);
      process.once("SIGTERM", finish);
    });
  } while (!stopping);
  logger.info("worker.stopped", { workerId });
}

const isEntryPoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isEntryPoint) {
  main().catch((error) => {
    logger.error("worker.crashed", { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}
