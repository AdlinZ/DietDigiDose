import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AIRuntimeRepository } from "../src/modules/aiRuntime/repository.js";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { SqliteAIRuntimeRepository } from "../src/modules/aiRuntime/sqliteRepository.js";
import type { AIUsageWrite } from "../src/modules/aiRuntime/types.js";

function repository(overrides: Partial<AIRuntimeRepository> = {}): AIRuntimeRepository {
  return {
    settings: async () => ({}),
    saveSettings: async () => undefined,
    recordUsage: async () => undefined,
    ...overrides,
  };
}

describe("AI runtime module", () => {
  test("resolves scoped providers, legacy fallbacks, and agent model overrides", async () => {
    const values = {
      AI_API_KEY: "global-key", AI_BASE_URL: "https://global.test/v1/", AI_MODEL: "legacy-chat",
      AI_CHAT_API_KEY: "chat-key", AI_CHAT_BASE_URL: "https://chat.test/v1/", AI_CHAT_MODEL: "chat-model",
      AI_VISION_MODEL: "vision-db", AI_ASR_API_KEY: "asr-key", AI_SUPERVISOR_MODEL: "supervisor-db",
    };
    const service = new AIRuntimeService(repository({ settings: async (keys) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => keys.includes(key))) }), {
      AI_VISION_API_KEY: "ignored", AI_ASR_MODEL: "asr-env",
    });
    const config = await service.config();
    assert.deepEqual(config.chat, { apiKey: "chat-key", baseUrl: "https://chat.test/v1", model: "chat-model" });
    assert.deepEqual(config.vision, { apiKey: "global-key", baseUrl: "https://global.test/v1", model: "vision-db" });
    assert.deepEqual(config.asr, { apiKey: "asr-key", baseUrl: "https://global.test/v1", model: "asr-env" });
    assert.equal((await service.agentConfig("SUPERVISOR")).model, "supervisor-db");
    assert.equal((await service.agentConfig("RECIPE")).model, "chat-model");
  });

  test("normalizes costs and redacts oversized failure details before persistence", async () => {
    let stored: AIUsageWrite | undefined;
    const service = new AIRuntimeService(repository({ recordUsage: async (input) => { stored = input; } }), {
      AI_INPUT_COST_PER_MILLION_USD: "2", AI_OUTPUT_COST_PER_MILLION_USD: "4",
    });
    await service.recordUsage({ userId: 7, endpoint: "chat", model: "test", promptTokens: 1_000,
      completionTokens: 500, latencyMs: -3, success: false, failureReason: "x".repeat(700) });
    assert.equal(stored?.totalTokens, 1_500);
    assert.equal(stored?.estimatedCostUsd, 0.004);
    assert.equal(stored?.failureReason?.length, 500);
    assert.equal(stored?.success, false);
  });

  test("keeps usage persistence best-effort", async () => {
    const service = new AIRuntimeService(repository({ recordUsage: async () => { throw new Error("offline"); } }));
    const originalError = console.error;
    console.error = () => undefined;
    try { await assert.doesNotReject(service.recordUsage({ userId: 1, endpoint: "chat", model: "test" })); }
    finally { console.error = originalError; }
  });

  test("SQLite adapter atomically saves settings and structured usage", async () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE ai_usage_logs (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, model TEXT,
        prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, latency_ms INTEGER, success INTEGER,
        estimated_cost_usd REAL, failure_reason TEXT, run_id TEXT, agent_name TEXT, phase TEXT);
    `);
    const service = new AIRuntimeService(new SqliteAIRuntimeRepository(database));
    await service.saveSettings([{ key: "AI_API_KEY", value: "secret" }, { key: "AI_CHAT_MODEL", value: "model-a" }]);
    assert.deepEqual(await service.settings(["AI_API_KEY", "AI_CHAT_MODEL"]),
      { AI_API_KEY: "secret", AI_CHAT_MODEL: "model-a" });
    await service.saveSettings([{ key: "AI_CHAT_MODEL", value: "model-b" }]);
    assert.equal((await service.config()).chat.model, "model-b");
    await service.recordUsage({ userId: 4, endpoint: "agent:Recipe", model: "model-b", runId: "run-1",
      agentName: "Recipe", phase: "specialist", promptTokens: 12, completionTokens: 8, latencyMs: 25 });
    const usage = database.prepare("SELECT * FROM ai_usage_logs").get() as Record<string, unknown>;
    assert.equal(usage.total_tokens, 20);
    assert.equal(usage.success, 1);
    assert.equal(usage.run_id, "run-1");
    database.close();
  });
});
