import { db } from "../../storage/db.js";
import { buildAdminWorkerRunsRouter } from "./route.js";
import { WorkerRuntime } from "./service.js";
import { SqliteWorkerRepository } from "./sqliteRepository.js";
import type { WorkerTaskContext, WorkerTaskName, WorkerTaskResult } from "./types.js";

const repository = new SqliteWorkerRepository(db);
const runtime = new WorkerRuntime(repository);

export type { WorkerTaskContext, WorkerTaskName, WorkerTaskResult, WorkerTaskRunResult } from "./types.js";
export const createAdminWorkerRunsRouter = () => buildAdminWorkerRunsRouter(repository);
export const acquireWorkerTaskLease = (taskName: WorkerTaskName, workerId: string, leaseMs: number) =>
  runtime.acquireLease(taskName, workerId, leaseMs);
export const releaseWorkerTaskLease = (taskName: WorkerTaskName, workerId: string) =>
  runtime.releaseLease(taskName, workerId);
export const runManagedWorkerTask = (options: {
  taskName: WorkerTaskName;
  workerId: string;
  leaseMs?: number;
  timeoutMs?: number;
  run: (context: WorkerTaskContext) => Promise<WorkerTaskResult>;
}) => runtime.run(options);
