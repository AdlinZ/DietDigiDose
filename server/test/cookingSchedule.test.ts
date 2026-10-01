import assert from "node:assert/strict";
import { test } from "node:test";
import { cookingScheduleSchema, recipeExecutionProfileSchema } from "@dietdigidose/contracts";
import { scheduleCooking } from "../src/modules/recommendations/schedule.js";

import { executionFixture as profile } from "./helpers/recipeExecution.js";
const recipe = { title: "测试菜", cook_time: 10, prep_time: 5, serving_size: 2, execution_profile: profile };
const entry = { targetMealId: "dinner", recipeId: 1, servings: 2, recipe };
const device = { id: 7, catalog_id: 1, name: "测试锅", attributes_json: { capacityMl: 1000 } };

test("dependencies, cleanup and device capacity determine actual batch time", () => {
  const single = cookingScheduleSchema.parse(scheduleCooking([entry], [device]));
  assert.equal(single.elapsedMinutes, 17);
  assert.equal(single.tasks[2].phase, "cleanup");
  const small = cookingScheduleSchema.parse(scheduleCooking([{ ...entry, servings: 3 }], [{ ...device, attributes_json: JSON.stringify({ capacityMl: 750 }) }]));
  assert.deepEqual(small.batches.map(batch => batch.servings), [1.5, 1.5]);
  assert.equal(small.elapsedMinutes, 34);
  assert.equal(small.tasks[3].startMinute, 17, "next batch waits for device cleanup");
  for (const attributes_json of [null, "{", {}]) {
    const unknown = scheduleCooking([entry], [{ ...device, attributes_json }]);
    assert.equal(unknown.complete, false); assert.equal(unknown.elapsedMinutes, null);
    assert(unknown.missing[0].startsWith("device_or_capacity:"));
  }
});

test("different devices overlap passive cooking while one person's work never overlaps", () => {
  const other = { ...entry, targetMealId: "other", recipeId: 2, recipe: { ...recipe,
    execution_profile: { ...profile, tools: [{ ...profile.tools[0], catalogId: 2 }] } } };
  const parallel = cookingScheduleSchema.parse(scheduleCooking([entry, other], [device, { ...device, id: 8, catalog_id: 2 }]));
  assert.equal(parallel.sequentialMinutes, 34);
  assert.equal(parallel.elapsedMinutes, 22);
  const shared = cookingScheduleSchema.parse(scheduleCooking([entry, { ...entry, targetMealId: "other" }], [device]));
  assert.equal(shared.elapsedMinutes, 34);
  const active = { ...recipe, execution_profile: { ...profile, tasks: profile.tasks.map(task => ({ ...task, active: true })) } };
  assert.equal(cookingScheduleSchema.parse(scheduleCooking([{ ...entry, recipe: active }, other], [device, { ...device, id: 8, catalog_id: 2 }])).elapsedMinutes, 24);
});

test("unreviewed durations and excessive batch counts cannot manufacture a feasible time", () => {
  const missing = scheduleCooking([{ ...entry, recipe: { ...recipe, execution_profile: null, prep_time: null } }], [device]);
  assert.equal(missing.elapsedMinutes, null); assert.equal(missing.sequentialMinutes, 10);
  const tiny = scheduleCooking([entry], [{ ...device, attributes_json: { capacityMl: 0.001 } }]);
  assert.equal(tiny.complete, false); assert.equal(tiny.tasks.length, 0); assert(tiny.conflicts.length);
});

test("review and saved-schedule validation reject cycles, omitted cleanup and double booking", () => {
  assert.equal(recipeExecutionProfileSchema.safeParse(profile).success, true);
  for (const tasks of [profile.tasks.slice(0, 2), profile.tasks.map(task => task.id === "prepare" ? { ...task, dependsOn: ["clean"] } : task),
    profile.tasks.map(task => task.id === "cook" ? { ...task, tools: ["unlisted"] } : task)]) {
    assert.equal(recipeExecutionProfileSchema.safeParse({ ...profile, tasks }).success, false);
  }
  const schedule = scheduleCooking([entry], [device]);
  assert.equal(cookingScheduleSchema.safeParse({ ...schedule, elapsedMinutes: 15, tasks: schedule.tasks.slice(0, 2) }).success, false);
  schedule.tasks[2].startMinute = 5; schedule.tasks[2].endMinute = 7;
  assert.equal(cookingScheduleSchema.safeParse(schedule).success, false);
});
