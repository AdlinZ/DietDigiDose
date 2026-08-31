export type WorkerTaskName = "notifications" | "media-cleanup";
export type WorkerRunStatus = "running" | "completed" | "failed";

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

export type WorkerRunQuery = {
  taskName?: WorkerTaskName;
  status?: WorkerRunStatus;
  page: number;
  pageSize: number;
};

export type WorkerRunsPage = {
  items: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
};
