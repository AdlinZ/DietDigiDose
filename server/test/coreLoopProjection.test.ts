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

test("verified household dining core loop credits producing cook who eats without inflating other members", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-1",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: true, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: true }],
    servings: 1,
  };
  input.shared = [
    // Cook eats
    { ...shared, diet_record_id: 101, diner_user_id: 1, intake_at: "2026-09-12 12:00:00" },
    // Family member 2 eats
    { ...shared, diet_record_id: 102, diner_user_id: 2, intake_at: "2026-09-12 12:30:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].actorKey, "user:1");
  assert.equal(facts[0].producerKey, "user:1");
  assert.equal(facts[0].householdKey, "household:1");
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "included");

  const summary = summarizeCoreLoopWeek(facts, {
    date: "2026-09-12",
    targetEnvironment: "staging",
    coverageStart: "2026-09-01T00:00:00Z",
    now: "2026-09-20T00:00:00Z",
  });
  assert.equal(summary.status, "complete");
  assert.equal(summary.verifiedUsers, 1);
  assert.equal(summary.verifiedLoops, 1);
  assert.equal(summary.users, 1);
  assert.equal(summary.unknown, 0);
});

test("household meal eaten only by non-cook does not count as a loop or unresolved unknown", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-2",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: true, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: true }],
    servings: 1,
  };
  input.shared = [
    // Only non-cook (user 2) eats
    { ...shared, diet_record_id: 103, diner_user_id: 2, intake_at: "2026-09-12 12:00:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(facts.length, 1);
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "no_surviving_intake");

  const summary = summarizeCoreLoopWeek(facts, {
    date: "2026-09-12",
    targetEnvironment: "staging",
    coverageStart: "2026-09-01T00:00:00Z",
    now: "2026-09-20T00:00:00Z",
  });
  assert.equal(summary.status, "complete");
  assert.equal(summary.verifiedUsers, 0);
  assert.equal(summary.verifiedLoops, 0);
  assert.equal(summary.unknown, 0);
});

test("cook eating with unconfirmed stock or unverified deductions marks week partial", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-3",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    // Stock is NOT confirmed
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: false, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: false }],
    servings: 1,
  };
  input.shared = [
    { ...shared, diet_record_id: 104, diner_user_id: 1, intake_at: "2026-09-12 12:00:00" },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "stock_evidence_missing");

  const summary = summarizeCoreLoopWeek(facts, {
    date: "2026-09-12",
    targetEnvironment: "staging",
    coverageStart: "2026-09-01T00:00:00Z",
    now: "2026-09-13T00:00:00Z",
  });
  assert.equal(summary.status, "partial");
  assert.equal(summary.unknown, 1);
  assert.equal(summary.users, null);
  assert.equal(summary.verifiedLoops, 0);
});

test("cook intake correction moves or drops household dining completion", () => {
  const input = dataset(); input.productions = []; input.intakes = []; input.logs = [];
  const shared = {
    id: "household-batch-4",
    household_id: 1,
    created_by_user_id: 1,
    kind: "real",
    recipe_id: 7,
    metric_environment: "staging",
    produced_at: "2026-09-12 10:00:00",
    selection_evidence: {
      version: 1,
      requestId: "req-1",
      recipeId: 7,
      selectedAt: "2026-09-12 09:00:00",
      inventory: { version: 1, allocations: [{ itemId: 11 }] },
    },
    stock: [{ itemId: 11, confirmedAt: "2026-09-11 08:00:00", confirmed: true, scope: "household", ownerKey: "household:1" }],
    deductions: [{ itemId: 11, before: 5, after: 3, amount: 2, verified: true }],
    servings: 1,
  };
  input.shared = [
    // Cook's intake is corrected
    { ...shared, diet_record_id: 105, diner_user_id: 1, intake_at: "2026-09-12 12:00:00", corrected: true },
  ];
  const facts = projectCoreLoops(input);
  assert.equal(evaluateCoreLoop(facts[0], "staging").reason, "no_surviving_intake");
});

test("decodes persisted household evidence from real inventory_json, request_json and settings environment", () => {
  const input = dataset();
  input.productions = [];
  input.intakes = [];
  input.logs = [];
  input.settings = { environment: "staging", enabled: 1 };

  const persistedSharedRow = {
    id: "batch-persisted-123",
    household_id: 2,
    created_by_user_id: 5,
    idempotency_key: "idem-batch-123",
    kind: "real",
    recipe_id: 18,
    produced_at: "2026-09-12 10:00:00",
    diet_record_id: 201,
    diner_user_id: 5,
    servings: 2,
    intake_at: "2026-09-12 12:00:00",
    request_json: JSON.stringify({
      idempotencyKey: "idem-batch-123",
      membershipId: 10,
      foodName: "番茄炒蛋",
      producedServings: 2,
      inventory: [{ itemId: 42, version: 1, amount: 3, unit: "个" }],
    }),
    inventory_json: JSON.stringify([
      { itemId: 42, foodName: "鸡蛋", before: 10, after: 7, amount: 3, unit: "个" },
    ]),
    dining_json: null,
  };

  input.shared = [persistedSharedRow];
  const facts = projectCoreLoops(input);
  assert.equal(facts.length, 1);
  const fact = facts[0];
  assert.equal(fact.productionId, "household:batch-persisted-123");
  assert.equal(fact.actorKey, "user:5");
  assert.equal(fact.producerKey, "user:5");
  assert.equal(fact.householdKey, "household:2");
  assert.equal(fact.environment, "staging");
  assert.equal(fact.recipeId, 18);
  assert.ok(fact.selection);
  assert.equal(fact.selection?.recipeId, 18);
  assert.deepEqual(fact.selection?.matchedItemIds, [42]);
  assert.equal(fact.stock.length, 1);
  assert.equal(fact.stock[0].itemId, 42);
  assert.equal(fact.stock[0].ownerKey, "household:2");
  assert.equal(fact.stock[0].confirmed, true);
  assert.equal(fact.deductions.length, 1);
  assert.equal(fact.deductions[0].itemId, 42);
  assert.equal(fact.deductions[0].before, 10);
  assert.equal(fact.deductions[0].after, 7);
  assert.equal(fact.deductions[0].amount, 3);
  assert.equal(fact.deductions[0].verified, true);
  assert.equal(evaluateCoreLoop(fact, "staging").reason, "included");
});

