import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCoreLoops, type CoreLoopDataset } from "../src/modules/adminConsole/coreLoopProjection.js";
import { evaluateCoreLoop, summarizeCoreLoopWeek } from "../src/modules/adminConsole/coreLoopMetric.js";
function dataset(): CoreLoopDataset {
  return { settings: {},legacy: [],shared: [],productions: [{ id: "meal",user_id: 1,kind: "real",recipe_id: 7,idempotency_key: "make",produced_at: new Date("2026-09-12T00:00:01Z"),
    result_json: { health_data: "must-not-copy",metric_environment: "staging",selection_evidence: { version: 1,requestId: "request",recipeId: 7,selectedAt: "2026-09-12T00:00:00Z",inventory: { version: 1,allocations: [{ itemId: 11 }] } },
      inventory_consumption_changes: [{ item_id: 11,quantity_before: 0.5,quantity_after: 0.4,consumed_value: 0.10000000000000003 }] } }],
    logs: [{ user_id: 1,inventory_item_id: 11,action: "created",source: "manual",created_at: "2026-09-11 23:59:00" },
      { user_id: 1,inventory_item_id: 11,action: "consume_partial",source: "cooking",idempotency_key: "cooking:make:11:0",quantity_before: "0.5",quantity_after: "0.4",delta_value: "-0.1" }],
    intakes: [{ prepared_meal_id: "meal",user_id: 1,servings: 1,created_at: "2026-09-12 00:00:02",diet_record_id: 4,record_exists: true,corrected: false }] };
}
test("projection normalizes driver times and decimals and retains only minimal linked evidence", () => {
  const facts = projectCoreLoops(dataset());
  assert.equal(evaluateCoreLoop(facts[0],"staging").reason,"included");
  assert.equal(facts[0].actorKey,"user:1");
  assert(!JSON.stringify(facts).includes("must-not-copy"));
});
test("unrelated logs, account mismatches and corrected intake never complete the chain", () => {
  const wrongKey = dataset(); wrongKey.logs[1].idempotency_key = "cooking:other:11:0";
  assert.equal(evaluateCoreLoop(projectCoreLoops(wrongKey)[0],"staging").reason,"deduction_evidence_missing");
  const wrongUser = dataset(); wrongUser.logs[1].user_id = 2;
  assert.equal(evaluateCoreLoop(projectCoreLoops(wrongUser)[0],"staging").reason,"deduction_evidence_missing");
  const corrected = dataset(); corrected.intakes[0].corrected = true;
  assert.equal(evaluateCoreLoop(projectCoreLoops(corrected)[0],"staging").reason,"no_surviving_intake");
});
test("only persisted manual acceptance confirms assisted intake; automatic and legacy AI remain unknown", () => {
  for (const [source,acceptance,expected] of [
    ["ai","manual","included"], ["manual","manual","included"],
    ["ai","automatic","stock_evidence_missing"], ["manual","automatic","stock_evidence_missing"],
    ["ai",null,"stock_evidence_missing"], ["ai","unrecognized","stock_evidence_missing"],
  ] as const) {
    const input = dataset(); Object.assign(input.logs[0],{ source,acceptance });
    assert.equal(evaluateCoreLoop(projectCoreLoops(input)[0],"staging").reason,expected,`${source}/${acceptance}`);
  }
});
test("split household intakes retain all evidence but count one unresolved production", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = { id: "batch",created_by_user_id: 1,kind: "real",produced_at: "2026-09-11 10:00:00",servings: 1 };
  input.shared = [
    { ...shared,diet_record_id: 21,intake_at: "2026-09-11 12:00:00" },
    { ...shared,diet_record_id: 22,intake_at: "2026-09-12 12:00:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(facts.length,1);
  assert.deepEqual(facts[0].intake.map(item => item.recordId),["21","22"]);
  const summary = summarizeCoreLoopWeek(facts,{ date: "2026-09-12",targetEnvironment: "staging",coverageStart: "2026-09-01T00:00:00Z",now: "2026-09-13T00:00:00Z" });
  assert.equal(summary.unknown,1);
  assert.equal(summary.verifiedLoops,0);
  assert.equal(summary.users,null);
  input.shared.push({ ...shared,id: "another-batch",diet_record_id: 23,intake_at: "2026-09-12 13:00:00" });
  assert.equal(projectCoreLoops(input).length,2);
});
