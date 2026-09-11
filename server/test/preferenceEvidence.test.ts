import assert from "node:assert/strict";
import { test } from "node:test";
import { repeatedDislikeRecipeIds } from "../src/modules/recommendations/preferenceEvidence.js";
const now = Date.parse("2026-09-12T12:00:00Z");
const event = (id: string,reason = "dislike",scope = "long_term") => ({ id,recipe_id: 1,event_type: "skip",metadata_json: { reason,scope },idempotency_key: id,created_at: "2026-09-12 10:00:00" });
test("requires three distinct recent long-term dislike signals", () => {
  assert.deepEqual(repeatedDislikeRecipeIds([event("a")],now),[]);
  assert.deepEqual(repeatedDislikeRecipeIds([event("a"),event("a"),event("a")],now),[]);
  assert.deepEqual(repeatedDislikeRecipeIds([event("a"),event("b"),event("c")],now),[1]);
});
test("no time, excess portions, session choices and unlabeled history do not imply dislike", () => {
  for (const reason of ["no_time","too_much","", "dislike"]) {
    const events = ["a","b","c"].map(id => event(id,reason,reason === "dislike" ? "session" : "long_term"));
    assert.deepEqual(repeatedDislikeRecipeIds(events,now),[]);
  }
});
test("expired, withdrawn, future and malformed evidence cannot strengthen a preference", () => {
  const base = [event("a"),event("b")];
  for (const invalid of [{ ...event("c"),created_at: "2026-08-01 10:00:00" },{ ...event("c"),created_at: "2099-09-12" },{ ...event("c"),metadata_json: { reason: "dislike",scope: "long_term",withdrawn: true } },{ ...event("c"),metadata_json: "not json" }]) {
    assert.deepEqual(repeatedDislikeRecipeIds([...base,invalid],now),[]);
  }
  assert.deepEqual(repeatedDislikeRecipeIds([...base,{ ...event("c"),created_at: new Date("2026-09-12T10:00:00Z"),metadata_json: JSON.stringify(event("c").metadata_json) }],now),[1]);
});
