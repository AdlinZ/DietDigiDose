import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { WorkerRepository } from "../src/modules/worker/repository.js";
import { WorkerRuntime } from "../src/modules/worker/service.js";
import type { WorkerRunQuery, WorkerTaskContext, WorkerTaskResult } from "../src/modules/worker/types.js";

function fakeRepository(overrides: Partial<WorkerRepository> = {}) {
  const events: string[] = [];
  const repository: WorkerRepository = {
    ownsLease: async () => true,
    acquireLease: async () => { events.push("acquire"); return true; },
    releaseLease: async () => { events.push("release"); return true; },
    createRun: async () => { events.push("create"); },
    completeRun: async (_id, status) => { events.push(`complete:${status}`); return true; },
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


test("concurrent runs in the same process use different lease owners", async () => {
  let owner: string | undefined;
  const attempts: string[] = [];
  const { repository } = fakeRepository({
    acquireLease: async (_task, id) => {
      attempts.push(id);
      if (owner) return false;
      owner = id;
      return true;
    },
    ownsLease: async (_task, id) => owner === id,
    releaseLease: async (_task, id) => {
      if (owner !== id) return false;
      owner = undefined;
      return true;
    },
  });
  const runtime = new WorkerRuntime(repository);
  const started = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const first = runtime.run({ taskName: "notifications", workerId: "same-process", run: async () => {
    started.resolve();
    await resume.promise;
    return { processed: 1, succeeded: 1, failed: 0 };
  } });
  await started.promise;
  const second = await runtime.run({ taskName: "notifications", workerId: "same-process", run: async () => {
    assert.fail("overlapping run must not execute");
  } });
  resume.resolve();
  assert.equal((await first).status, "completed");
  assert.equal(second.acquired, false);
  assert.notEqual(attempts[0], attempts[1]);
});

test("expired ownership rejects late results and cannot release a replacement lease", async () => {
  let owner = "";
  const { repository, events } = fakeRepository({
    acquireLease: async (_task, id) => { owner = id; return true; },
    ownsLease: async (_task, id) => owner === id,
    releaseLease: async (_task, id) => {
      if (owner !== id) return false;
      owner = "";
      return true;
    },
  });
  let context: WorkerTaskContext | undefined;
  const result = await new WorkerRuntime(repository).run({
    taskName: "notifications", workerId: "worker", run: async (current) => {
      context = current;
      owner = "replacement-attempt";
      await assert.rejects(current.assertActive, /lease lost or expired/);
      return { processed: 1, succeeded: 1, failed: 0 };
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(context?.signal.aborted, true);
  assert.equal(owner, "replacement-attempt");
  assert.deepEqual(events, ["create", "fail"]);
});

test("timeout aborts the task and prevents its late continuation from reporting success", async () => {
  const { repository, events } = fakeRepository();
  const resume = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  let context: WorkerTaskContext | undefined;
  const result = await new WorkerRuntime(repository).run({
    taskName: "notifications", workerId: "worker", timeoutMs: 20, run: async (current) => {
      context = current;
      try {
        await resume.promise;
        await assert.rejects(current.assertActive, /timeout/);
        return { processed: 1, succeeded: 1, failed: 0 };
      } finally { finished.resolve(); }
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /timeout/);
  assert.equal(context?.signal.aborted, true);
  resume.resolve();
  await finished.promise;
  assert.deepEqual(events, ["acquire", "create", "fail", "release"]);
});

test("contexts cannot be reused after a successful run", async () => {
  const { repository } = fakeRepository();
  let context: WorkerTaskContext | undefined;
  await new WorkerRuntime(repository).run({ taskName: "notifications", workerId: "worker", run: async (current) => {
    context = current;
    await current.assertActive();
    return { processed: 0, succeeded: 0, failed: 0 };
  } });
  assert.ok(context);
  assert.equal(context.signal.aborted, true);
  await assert.rejects(context.assertActive, /run finished/);
});


test("a lease lost between checking and recording cannot report completion", async () => {
  const { repository, events } = fakeRepository({ completeRun: async () => false });
  const result = await new WorkerRuntime(repository).run({ taskName: "notifications", workerId: "worker", run: async () => (
    { processed: 1, succeeded: 1, failed: 0 }
  ) });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /before recording result/);
  assert.deepEqual(events, ["acquire", "create", "fail", "release"]);
});
