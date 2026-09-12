import assert from "node:assert/strict";
import { processMaintenanceJobs } from "../src/modules/planMaintenance/process.js";
import type { MaintenanceQueueRepository } from "../src/modules/planMaintenance/queue.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";

export async function verifyMaintenanceFlow(repository: MaintenanceQueueRepository,userId: number,query: (sql: string,args?: unknown[]) => Promise<Row[]>) {
  await query("DELETE FROM plan_maintenance_jobs"); await query("DELETE FROM plan_maintenance_events");
  const ingredients = (food: string) => JSON.stringify([{ name: food,amount: "1个" }]);
  const recipe = async (title: string,food: string) => Number((await query("INSERT INTO recipes(title,ingredients_json,steps_json,status,serving_size,prep_time,cook_time) VALUES(?,?,'[]','approved',1,1,5) RETURNING id",[title,ingredients(food)]))[0].id);
  const original = await recipe("验收原餐","维护验收原料甲XYZ");
  const alternative = await recipe("验收替换餐","维护验收原料乙XYZ");
  const fixed = await recipe("验收确认餐","维护验收原料丙XYZ");
  const stock = async (food: string,quantity: number) => Number((await query("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,expiration_date) VALUES(?,?,'其他',?,?,'piece','2035-09-20') RETURNING id",[userId,food,`${quantity}个`,quantity]))[0].id);
  const changedStock = await stock("维护验收原料甲XYZ",0);
  await stock("维护验收原料乙XYZ",1); await stock("维护验收原料丙XYZ",1);
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,constraints_json) VALUES('flow-plan',?,'完整链路','2035-09-12','2035-09-18',?)",[userId,JSON.stringify({ executionItems: { "flow-target": { servings: 1 },"flow-fixed": { servings: 1 } } })]);
  for (const [id,recipeId,food,confirmed] of [["flow-target",original,"维护验收原料甲XYZ",null],["flow-fixed",fixed,"维护验收原料丙XYZ","2035-09-11T00:00:00Z"]] as const) {
    await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,confirmed_at) VALUES(?,'flow-plan',?,'2035-09-12','午餐',?,?,?,?)",[id,userId,id,recipeId,ingredients(food),confirmed]);
  }
  await query("INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,created_at) VALUES('flow-event',?,'inventory_changed','flow-stock-change',?,'2035-09-12T00:00:00Z')",[userId,String(changedStock)]);
  const before = (await query("SELECT * FROM meal_plan_items WHERE id='flow-fixed'"))[0];
  const now = () => new Date("2035-09-12T01:00:00Z");
  assert.equal(await repository.enqueueEvents(now()),1);
  const context = { runId: "flow",taskName: "plan-maintenance-process" as const,leaseOwnerId: "flow",signal: new AbortController().signal,assertActive: async () => {} };
  const result = await processMaintenanceJobs(repository,context,10,now);
  assert.equal(result.succeeded,1); assert.equal(result.failed,0);
  const after = (await query("SELECT * FROM meal_plan_items WHERE id='flow-fixed'"))[0];
  assert.deepEqual(after,before);
  const target = (await query("SELECT recipe_id,version FROM meal_plan_items WHERE id='flow-target'"))[0];
  assert.equal(Number(target.recipe_id),alternative); assert.equal(Number(target.version),2);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0].count),1);
  assert.ok((await query("SELECT processed_at FROM plan_maintenance_events WHERE id='flow-event'"))[0].processed_at);
  assert.equal(await repository.enqueueEvents(now()),0);
  assert.equal((await processMaintenanceJobs(repository,context,10,now)).processed,0);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0].count),1);
}
