import assert from "node:assert/strict";
import { test } from "node:test";
import { formatOutcomeEvidence } from "../src/modules/recommendations/outcomeEvidence.js";
const production = { id: "batch",recipe_id: 7,food_name: "蛋羹",produced_servings: 3,produced_at: "2026-09-12 10:00:00" };
const eating = { id: "eat",recipe_id: 7,food_name: "蛋羹",event_type: "eat",servings: 1,created_at: "2026-09-12 12:00:00",diet_record_id: 3 };
test("production is distinct from consumption and duplicate results remain one fact",() => {
  const facts = formatOutcomeEvidence([production,production],[eating,eating]);
  assert.equal(facts.length,2);
  assert.equal(facts.filter(fact => fact.kind === "eat").length,1);
  assert.equal(facts.find(fact => fact.kind === "production")!.servings,3);
});
test("undo and intake deletion revoke consumption evidence; discard does not infer a reason",() => {
  for (const mode of ["undo_eating","delete_intake"]) {
    const fact = formatOutcomeEvidence([],[{ ...eating,correction_id: "correction",correction_mode: mode,corrected_at: "2026-09-12 13:00:00" }])[0];
    assert.equal(fact.valid,false); assert.equal(fact.correctionId,"correction");
  }
  assert.equal(formatOutcomeEvidence([],[{ ...eating,diet_record_id: null }])[0].valid,false);
  const discard = formatOutcomeEvidence([],[{ ...eating,event_type: "discard",diet_record_id: null }])[0];
  assert.equal(discard.valid,true); assert.match(discard.explanation,/原因未知/);
});
