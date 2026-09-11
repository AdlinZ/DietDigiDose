import assert from "node:assert/strict";
import { test } from "node:test";
import { projectCoreLoops, type CoreLoopDataset } from "../src/modules/adminConsole/coreLoopProjection.js";
import { evaluateCoreLoop } from "../src/modules/adminConsole/coreLoopMetric.js";
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
