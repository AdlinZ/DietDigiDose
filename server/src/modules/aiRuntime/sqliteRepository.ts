import type Database from "better-sqlite3";
import type { AIRuntimeRepository } from "./repository.js";
import type { AIUsageWrite } from "./types.js";

export class SqliteAIRuntimeRepository implements AIRuntimeRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async settings(keys: string[]) {
    if (!keys.length) return {};
    const placeholders = keys.map(() => "?").join(",");
    const rows = this.database.prepare(`SELECT key, value FROM system_settings WHERE key IN (${placeholders})`)
      .all(...keys) as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async saveSettings(entries: Array<{ key: string; value: string }>) {
    const statement = this.database.prepare(`INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`);
    this.database.transaction(() => entries.forEach((entry) => statement.run(entry.key, entry.value)))();
  }

  async recordUsage(input: AIUsageWrite) {
    this.database.prepare(`INSERT INTO ai_usage_logs (user_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens,
      latency_ms, success, estimated_cost_usd, failure_reason, run_id, agent_name, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.userId, input.endpoint, input.model, input.promptTokens, input.completionTokens, input.totalTokens,
        input.latencyMs, input.success ? 1 : 0, input.estimatedCostUsd, input.failureReason || null, input.runId || null,
        input.agentName?.slice(0, 80) || null, input.phase?.slice(0, 80) || null);
  }
}
