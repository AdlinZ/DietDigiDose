import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WorkerRepository } from "../src/modules/worker/repository.js";
import { WorkerRuntime } from "../src/modules/worker/service.js";
import type { WorkerRunQuery, WorkerTaskResult } from "../src/modules/worker/types.js";

function fakeRepository(overrides: Partial<WorkerRepository> = {}) {
  const events: string[] = [];
  const repository: WorkerRepository = {
    acquireLease: async () => { events.push("acquire"); return true; },
    releaseLease: async () => { events.push("release"); return true; },
    createRun: async () => { events.push("create"); },
    completeRun: async (_id, status) => { events.push(`complete:${status}`); },
    failRun: async () => { events.push("fail"); },
    listRuns: async (query: WorkerRunQuery) => ({ items: [], leases: [], total: 0, ...query }),
    ...overrides,
  };
  return { repository, events };
}

describe("worker module", () => {
  test("skips execution while another owner holds the lease", async () => {
    let executed = false;
    const { repository, events } = fakeRepository({ acquireLease: async () => false });
    const runtime = new WorkerRuntime(repository);
    const result = await runtime.run({
      taskName: "notifications",
      workerId: "worker-b",
      run: async () => {
        executed = true;
        return { processed: 0, succeeded: 0, failed: 0 };
      },
    });
    assert.deepEqual(result, { acquired: false });
    assert.equal(executed, false);
    assert.deepEqual(events, []);
  });

  test("persists successful outcomes and always releases the lease", async () => {
    const { repository, events } = fakeRepository();
    const runtime = new WorkerRuntime(repository);
    const taskResult: WorkerTaskResult = { processed: 3, succeeded: 3, failed: 0, details: { source: "test" } };
    const result = await runtime.run({
      taskName: "media-cleanup",
      workerId: "worker-a",
      run: async () => taskResult,
    });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.result, taskResult);
    assert.deepEqual(events, ["acquire", "create", "complete:completed", "release"]);
  });

  test("sanitizes thrown failures, persists them, and releases the lease", async () => {
    const { repository, events } = fakeRepository();
    const runtime = new WorkerRuntime(repository);
    const result = await runtime.run({
      taskName: "media-cleanup",
      workerId: "worker-a",
      run: async () => { throw new Error("provider\nfailed"); },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.error, "provider failed");
    assert.deepEqual(events, ["acquire", "create", "fail", "release"]);
  });
});
