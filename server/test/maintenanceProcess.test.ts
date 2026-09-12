import { test } from "node:test";
import assert from "node:assert/strict";
import { processMaintenanceJobs } from "../src/modules/planMaintenance/process.js";
import { inputSnapshot, maintenanceInputTables, maintenanceRuleTables } from "../src/modules/planMaintenance/inputSnapshot.js";
import type { MaintenanceQueueRepository, MaintenanceApplication } from "../src/modules/planMaintenance/queue.js";
import type { WorkerTaskContext } from "../src/modules/worker/types.js";

function fixture() {
  const controller = new AbortController();
  const context: WorkerTaskContext = { runId: "run",taskName: "plan-maintenance-process",leaseOwnerId: "run",signal: controller.signal,assertActive: async () => { controller.signal.throwIfAborted(); } };
  const data = Object.fromEntries([...maintenanceInputTables,...maintenanceRuleTables,"recipes","maintenance_events"].map(table => [table,[]]));
  const snapshot = inputSnapshot(1,[],data);
  let claims = 0; let commits = 0; let failures = 0;
  let application: MaintenanceApplication = { kind: "completed",changes: [] };
  let diagnostics: unknown;
  const repository: MaintenanceQueueRepository = {
    publishResults: async () => 0,enqueueDaily: async () => 0,enqueueEvents: async () => 0,scope: async () => null,candidateRecipeIds: async () => [],
    claim: async () => ++claims === 1 ? { id: "job",userId: 1,attempt: 1,leaseToken: "token",eventIds: [] } : null,
    inputs: async () => snapshot,
    applyChanges: async (_job,_changes,_snapshot,result) => { commits++; diagnostics = result; return application; },
    fail: async () => { failures++; return true; },
  };
  return { repository,context,controller,snapshot,setApplication: (value: MaintenanceApplication) => { application = value; },counts: () => ({ commits,failures }),diagnostics: () => diagnostics };
}

test("processor persists zero-cost diagnostics using the account local date", async () => {
  const f = fixture();
  f.snapshot.data.plan_maintenance_settings = [{ time_zone: "America/Los_Angeles" }];
  const result = await processMaintenanceJobs(f.repository,f.context,10,() => new Date("2026-09-12T01:00:00Z"));
  assert.equal(result.succeeded,1);
  assert.ok((f.diagnostics() as { evaluationDurationMs: number }).evaluationDurationMs >= 0);
  assert.equal((f.diagnostics() as { fromDate: string }).fromDate,"2026-09-11");
  assert.equal((f.diagnostics() as { cost: number }).cost,0);
});

test("input conflicts retry while lost leases do not mutate another attempt", async () => {
  for (const kind of ["input_conflict","lease_lost"] as const) {
    const f = fixture(); f.setApplication({ kind });
    const result = await processMaintenanceJobs(f.repository,f.context);
    assert.equal(result.failed,1); assert.equal(result.succeeded,0);
    assert.equal(f.counts().failures,kind === "input_conflict" ? 1 : 0);
  }
});

test("cancellation during evaluation prevents commit and late failure writes", async () => {
  const f = fixture();
  f.repository.inputs = async () => { f.controller.abort(new Error("timeout")); return f.snapshot; };
  await assert.rejects(processMaintenanceJobs(f.repository,f.context),/timeout/);
  assert.deepEqual(f.counts(),{ commits: 0,failures: 0 });
});

test("evaluation errors use the durable bounded retry path", async () => {
  const f = fixture(); f.repository.candidateRecipeIds = async () => { throw new Error("database unavailable"); };
  const result = await processMaintenanceJobs(f.repository,f.context);
  assert.equal(result.failed,1); assert.deepEqual(f.counts(),{ commits: 0,failures: 1 });
});
