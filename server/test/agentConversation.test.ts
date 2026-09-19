import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { conversationContext } from "../src/services/agent/conversation.js";
import { runtimePolicySchema, thinkingParameters, isTransientModelError } from "../src/modules/aiRuntime/policy.js";

const directory = mkdtempSync(path.join(tmpdir(), "agent-conversation-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.JWT_SECRET = "agent-conversation-test-secret-at-least-32-characters";
process.env.ADMIN_INITIAL_PASSWORD = "AdminPassword1234";
process.env.ENABLE_DEMO_SEED = "0";
let provider: Server;
let appServer: Server;
let db: typeof import("../src/storage/db.js").db;
let runtime: typeof import("../src/services/agent/runtime.js");
let userId: number;
let calls: Array<{ messages: Array<{ content: string }>; [key: string]: unknown }> = [];
let answers: unknown[] = [];
before(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    const answer = answers.shift() as Record<string, unknown> | undefined;
    res.setHeader("content-type", "application/json");
    if (answer?.httpStatus) { res.statusCode = Number(answer.httpStatus); res.end(JSON.stringify({ error: { message: "fixture failure" } })); return; }
    if (calls.at(-1)?.stream) {
      res.setHeader("content-type", "text/event-stream");
      const content = JSON.stringify(answer || { reply: "流式答复。" });
      for (let offset = 0; offset < content.length; offset += 3) {
        res.write(`data: ${JSON.stringify({ id: "mock-stream", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { content: content.slice(offset, offset + 3) }, finish_reason: null }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ id: "mock-stream", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    const toolCall = answer?.toolCall as { name: string; args: unknown } | undefined;
    const message = toolCall
      ? { role: "assistant", content: null, tool_calls: [{ id: `tool-${calls.length}`, type: "function", function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) } }] }
      : { role: "assistant", content: typeof answer === "string" ? answer : JSON.stringify(answer || { goal: "问答", specialists: [], reply: "你好", candidates: [] }) };
    res.end(JSON.stringify({ id: `mock-${calls.length}`, object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message, finish_reason: toolCall ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.AI_API_KEY = "fixture-key";
  process.env.AI_BASE_URL = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  process.env.AI_MODEL = "fixture";
  const { createApp } = await import("../src/app.js");
  db = (await import("../src/storage/db.js")).db;
  const app = await createApp();
  await new Promise<void>((resolve) => { appServer = app.listen(0, "127.0.0.1", () => resolve()); });
  const response = await fetch(`http://127.0.0.1:${(appServer.address() as AddressInfo).port}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "agent-test@example.com", username: "Agent测试", password: "Password1234" }) });
  const result = await response.json() as { user: { id: number } };
  assert.equal(response.status, 201);
  userId = result.user.id;
  runtime = await import("../src/services/agent/runtime.js");
});
after(async () => {
  if (provider) await new Promise<void>((resolve) => provider.close(() => resolve()));
  if (appServer) await new Promise<void>((resolve) => appServer.close(() => resolve()));
  db?.close();
  rmSync(directory, { recursive: true, force: true });
});

test("ordinary chat consumes history and completes with one provider call", async () => {
  calls = [];
  answers = [{ goal: "替换第二份", specialists: [], reply: "第二份改成不辣的版本，第一份保持不变。", candidates: [] }];
  const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "第二份不要辣", messages: [{ role: "assistant", content: "方案 plan-123：第一份番茄面，第二份辣椒炒蛋" }, { role: "user", content: "第二份不要辣" }] }, 10000);
  assert.equal(response.run.status, "completed", JSON.stringify(response.run.error));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].response_format, { type: "json_object" });
  assert.match(JSON.stringify(calls[0].messages), /plan-123/);
  assert.match(response.run.reply!, /第二份/);
});

test("read-only tool round trip reaches its final answer within the shared budget", async () => {
  calls = [];
  answers = [
    { toolCall: { name: "get_user_nutrition_context", args: {} } },
    { goal: "查询库存", specialists: [], reply: "你的库存目前为空。", candidates: [] },
  ];
  const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "查询我的库存，只读取，不修改。" }, 10000);
  assert.equal(response.run.status, "completed", JSON.stringify(db.prepare("SELECT error_message FROM agent_runs WHERE id=?").get(response.run.id)));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages.some(message => (message as { role?: string }).role === "tool"));
  assert.match(response.run.reply!, /库存目前为空/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_actions WHERE run_id=?").get(response.run.id) as { count: number }).count, 0);
});

test("provider ignoring JSON mode still fails closed without accepting plain text", async () => {
  calls = [];
  answers = ["你好，我已经为你保存了记录。"];
  const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "你好，不要保存记录。" }, 10000);
  assert.equal(response.run.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(response.run.reply, undefined);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_actions WHERE run_id=?").get(response.run.id) as { count: number }).count, 0);
});

test("clarification resumes the original run", async () => {
  calls = [];
  answers = [{ goal: "人数", specialists: [], needsInput: "为几个人？" }];
  const created = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "安排备餐" }, 10000);
  assert.equal(created.run.status, "awaiting_input", JSON.stringify(created.run.error));
  answers = [{ goal: "两人备餐", specialists: [], reply: "按两个人安排。" }];
  const resumed = await runtime.resumeSupervisorRun(userId, created.run.id, { input: "两个人" }, 10000);
  assert.equal(resumed.id, created.run.id);
  assert.equal(resumed.status, "completed", JSON.stringify(db.prepare("SELECT error_message FROM agent_runs WHERE id = ?").get(resumed.id)));
  assert.match(JSON.stringify(calls.at(-1)?.messages), /两个人/);
});

test("allergy consultation proceeds but actual unsafe candidates are blocked", async () => {
  db.prepare("UPDATE user_health_profiles SET allergies_json = ? WHERE user_id = ?").run(JSON.stringify([{ name: "花生", severity: "severe" }]), userId);
  for (const prompt of ["花生过敏可以用什么替代", "不要加入花生"]) {
    answers = [{ goal: "咨询", specialists: [], reply: "会遵守你的限制，请核对替代食品的配料和交叉污染信息。" }];
    const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt }, 10000);
    assert.equal(response.run.status, "completed");
    assert.match(response.run.reply!, /会遵守/);
  }
  answers = [{ goal: "早餐", specialists: [], reply: "建议花生酱面包", candidates: [{ name: "面包", ingredients: ["花生酱", "不要加入花生只是无关说明"] }] }];
  const blocked = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "安排早餐" }, 10000);
  assert.equal(blocked.run.status, "completed");
  assert.match(blocked.run.reply!, /不会生成、保存或采购/);
  assert.deepEqual(blocked.run.artifacts, []);
});

test("total budget prevents downstream model calls", async () => {
  const settings = (await import("../src/modules/aiRuntime/runtime.js")).aiRuntimeService();
  const policy = runtimePolicySchema.parse({ maxModelCalls: 1 });
  await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: JSON.stringify(policy) }]);
  calls = [];
  answers = [{ goal: "复杂规划", specialists: ["NutritionPlanningAgent"] }];
  try {
    const result = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "复杂多餐规划" }, 10000);
    assert.equal(result.run.status, "failed");
    assert.equal(calls.length, 1);
  } finally { await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: "" }]); }
});

test("transient retries share the call budget and permission errors do not retry", async () => {
  const settings = (await import("../src/modules/aiRuntime/runtime.js")).aiRuntimeService();
  const policy = runtimePolicySchema.parse({ main: { retries: 1 }, maxModelCalls: 2 });
  await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: JSON.stringify(policy) }]);
  try {
    calls = [];
    answers = [{ httpStatus: 429 }, { goal: "问答", specialists: [], reply: "你好" }];
    const retried = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "你好" }, 10000);
    assert.equal(retried.run.status, "completed", JSON.stringify(retried.run.error));
    assert.equal(calls.length, 2);
    calls = [];
    answers = [{ httpStatus: 401 }];
    const denied = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "你好" }, 10000);
    assert.equal(denied.run.status, "failed");
    assert.equal(calls.length, 1);
  } finally { await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: "" }]); }
});

test("business proposals wait for approval and edits execute once", async () => {
  calls = [];
  answers = [{ goal: "记录喝水", specialists: ["OperationsAgent"] }, { actions: [{ actionType: "record_health_log", summary: "喝水", payload: { waterMl: 300 } }] }];
  const created = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "记录喝水300毫升" }, 10000);
  assert.equal(created.run.status, "awaiting_approval", JSON.stringify({ error: created.run.error, systems: calls.map((call) => call.messages.map((message) => message.content).slice(0, 1)) }));
  const action = created.run.pendingApproval!.actions[0];
  answers = [{ reply: "已记录饮水500毫升。" }];
  const completed = await runtime.resumeSupervisorRun(userId, created.run.id, { decision: "edit", actions: [{ ...action, payload: { ...action.payload, waterMl: 500 } }] }, 10000);
  assert.equal(completed.status, "completed", JSON.stringify(db.prepare("SELECT error_message FROM agent_runs WHERE id = ?").get(completed.id)));
  await assert.rejects(runtime.resumeSupervisorRun(userId, created.run.id, { decision: "approve" }), /当前不等待/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_actions WHERE run_id=? AND status='executed'").get(created.run.id) as { count: number }).count, 1);
});

test("history is bounded and retains latest references", () => {
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content: "旧".repeat(20000) }, { role: "assistant", content: "方案 plan-new" }, { role: "user", content: "第二份不要辣" }] }, 100);
  assert.match(result, /plan-new/);
  assert.match(result, /第二份不要辣/);
  assert.ok(result.length < 400);
});

test("thinking policy serializes only documented parameters and rejects unknown support", () => {
  const policy = runtimePolicySchema.parse({}).main;
  assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V4-Flash", { ...policy, thinking: "off" }), { enable_thinking: false });
  assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V4-Flash", { ...policy, thinking: "max" }), { enable_thinking: true, reasoning_effort: "max" });
  assert.throws(() => thinkingParameters("https://unknown.test/v1", "unknown", { ...policy, thinking: "off" }), /尚未验证/);
  assert.deepEqual(thinkingParameters("https://unknown.test/v1", "unknown", policy), {});
  assert.equal(isTransientModelError({ status: 401 }), false);
  assert.equal(isTransientModelError({ status: 400 }), false);
  assert.equal(isTransientModelError({ status: 429 }), true);
});


test("candidate safety includes aliases, compound ingredients and edited shopping payloads", async () => {
  const { findCandidateSafetyConflict, validateAgentActions, AgentSafetyConflictError } = await import("../src/services/agent/policy.js");
  const { buildUserContext } = await import("../src/services/contextBuilder.js");
  const context = await buildUserContext(userId);
  for (const ingredient of ["peanut butter", "落花生", "花生醬", "混合酱（配料不详）"]) {
    assert.ok(findCandidateSafetyConflict({ ingredients: [ingredient] }, context), ingredient);
  }
  assert.equal(findCandidateSafetyConflict({ ingredients: ["番茄", "鸡蛋"] }, context), null);
  assert.throws(() => validateAgentActions([{ actionType: "update_shopping_item", summary: "替换食材", payload: { itemId: "shopping-1", name: "peanut butter", note: "不要花生" } }], context), AgentSafetyConflictError);
});


test("opt-in final reply stream persists only decoded answer fragments", async () => {
  process.env.AI_REPLY_STREAM_ENABLED = "true";
  calls = [];
  answers = [{ goal: "复杂规划", specialists: ["NutritionPlanningAgent"] }, { summary: "可按两人准备番茄炒蛋。", artifacts: [] }, { reply: "两人份方案已经准备好。可以按需调整份量。" }];
  try {
    const result = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "请规划复杂多餐，不保存业务记录" }, 10000);
    assert.equal(result.run.status, "completed", JSON.stringify(result.run.error));
    const events = db.prepare("SELECT event_type, payload_json FROM agent_run_events WHERE run_id = ? ORDER BY sequence").all(result.run.id) as Array<{ event_type: string; payload_json: string }>;
    const deltas = events.filter((event) => event.event_type === "reply_delta").map((event) => JSON.parse(event.payload_json).delta).join("");
    assert.equal(deltas, "两人份方案已经准备好。可以按需调整份量。");
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1)?.stream, true);
  } finally { delete process.env.AI_REPLY_STREAM_ENABLED; }
});


test("five turns deliver the latest constraints and plan reference without persisting preferences", async () => {
  const before = db.prepare("SELECT allergies_json FROM user_health_profiles WHERE user_id=?").get(userId);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "assistant", content: "方案 plan-123：第一份番茄面，第二份辣椒炒蛋" }];
  const prompts = ["换一个", "第二份不要辣", "保留第一份", "改成两人份", "仍只给建议，不保存"];
  for (const prompt of prompts) {
    messages.push({ role: "user", content: prompt });
    answers = [{ goal: "局部修改", specialists: [], reply: "plan-123：第一份番茄面保持，第二份番茄炒蛋，两人份，不放辣椒。" }];
    const result = await runtime.startSupervisorRun(userId, { modality: "text", prompt, messages }, 10000);
    assert.equal(result.run.status, "completed");
    const delivered = JSON.stringify(calls.at(-1)?.messages);
    assert.match(delivered, /plan-123/);
    assert.ok(delivered.includes(prompt));
    messages.push({ role: "assistant", content: result.run.reply! });
  }
  assert.deepEqual(db.prepare("SELECT allergies_json FROM user_health_profiles WHERE user_id=?").get(userId), before);
});
