import { Router } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { db } from "../../storage/db.js";
import { getPublicAgentCheckpointState } from "../../services/agent/runtime.js";
import { auditAdminAction } from "./shared.js";

const statuses = ["queued", "running", "awaiting_input", "awaiting_approval", "completed", "failed", "cancelled", "expired"] as const;
const modalities = ["text", "home", "cooking", "image", "audio", "inventory_scan", "receipt"] as const;
const rangeDays: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseJson(value: unknown, fallback: unknown = null) {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function publicInput(value: unknown) {
  const input = parseJson(value, {}) as Record<string, unknown>;
  const { image: _image, audioBase64: _audio, mediaRef: _mediaRef, ...safe } = input;
  return safe;
}

function promptPreview(value: unknown) {
  const input = publicInput(value);
  const direct = typeof input.prompt === "string" ? input.prompt : "";
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const latest = [...messages].reverse().find((message) => message && typeof message === "object" && (message as { role?: unknown }).role === "user") as { content?: unknown } | undefined;
  const text = direct || (typeof latest?.content === "string" ? latest.content : "") || (typeof input.period === "string" ? input.period : "");
  return text.trim().slice(0, 240);
}

export function createAdminAgentRunsRouter() {
  const router = Router();

  router.get("/agent-runs", (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));
      const status = typeof req.query.status === "string" && statuses.includes(req.query.status as typeof statuses[number]) ? req.query.status : "";
      const modality = typeof req.query.modality === "string" && modalities.includes(req.query.modality as typeof modalities[number]) ? req.query.modality : "";
      const agent = typeof req.query.agent === "string" ? req.query.agent.trim().slice(0, 80) : "";
      const query = typeof req.query.query === "string" ? req.query.query.trim().slice(0, 120) : "";
      const range = typeof req.query.range === "string" && req.query.range in rangeDays ? req.query.range : "30d";
      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (status) { conditions.push("r.status = ?"); params.push(status); }
      if (modality) { conditions.push("r.modality = ?"); params.push(modality); }
      if (rangeDays[range] !== null) { conditions.push("r.created_at >= datetime('now', ?)"); params.push(`-${rangeDays[range]} days`); }
      if (query) {
        const pattern = `%${query}%`;
        conditions.push("(r.id LIKE ? OR r.session_id LIKE ? OR u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?)");
        params.push(pattern, pattern, pattern, pattern);
      }
      if (agent) {
        conditions.push("EXISTS (SELECT 1 FROM agent_run_events af WHERE af.run_id = r.id AND af.agent_name = ?)");
        params.push(agent);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const total = (db.prepare(`SELECT COUNT(*) AS count FROM agent_runs r JOIN users u ON u.id = r.user_id ${where}`).get(...params) as { count: number }).count;
      const rows = db.prepare(`
        SELECT r.id, r.user_id AS userId, u.username, r.session_id AS sessionId,
          r.modality, r.source, r.status, r.input_json AS inputJson,
          r.error_code AS errorCode, r.error_message AS errorMessage,
          r.started_at AS startedAt, r.completed_at AS completedAt,
          r.created_at AS createdAt, r.updated_at AS updatedAt,
          ROUND((julianday(COALESCE(r.completed_at, r.updated_at)) - julianday(COALESCE(r.started_at, r.created_at))) * 86400000) AS durationMs,
          (SELECT COUNT(*) FROM agent_run_events e WHERE e.run_id = r.id) AS eventCount,
          (SELECT COUNT(*) FROM agent_actions a WHERE a.run_id = r.id) AS actionCount,
          (SELECT COUNT(*) FROM ai_usage_logs l WHERE l.run_id = r.id) AS modelCallCount,
          (SELECT COALESCE(SUM(l.prompt_tokens), 0) FROM ai_usage_logs l WHERE l.run_id = r.id) AS promptTokens,
          (SELECT COALESCE(SUM(l.completion_tokens), 0) FROM ai_usage_logs l WHERE l.run_id = r.id) AS completionTokens,
          (SELECT COALESCE(SUM(l.total_tokens), 0) FROM ai_usage_logs l WHERE l.run_id = r.id) AS totalTokens,
          (SELECT COALESCE(ROUND(SUM(l.estimated_cost_usd), 6), 0) FROM ai_usage_logs l WHERE l.run_id = r.id) AS estimatedCostUsd,
          EXISTS(SELECT 1 FROM agent_run_media m WHERE m.run_id = r.id) AS hasMedia,
          (SELECT GROUP_CONCAT(agent_name, ',') FROM (
            SELECT DISTINCT e.agent_name FROM agent_run_events e
            WHERE e.run_id = r.id AND e.agent_name NOT IN ('Supervisor', 'PolicyGate')
            ORDER BY e.sequence
          )) AS specialists,
          (SELECT e.summary FROM agent_run_events e WHERE e.run_id = r.id ORDER BY e.sequence DESC LIMIT 1) AS lastEventSummary
        FROM agent_runs r
        JOIN users u ON u.id = r.user_id
        ${where}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ? OFFSET ?
      `).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
      const items = rows.map(({ inputJson, ...row }) => ({ ...row, promptPreview: promptPreview(inputJson) }));
      const statusCounts = db.prepare(`
        SELECT r.status, COUNT(*) AS count
        FROM agent_runs r JOIN users u ON u.id = r.user_id
        ${where}
        GROUP BY r.status
      `).all(...params);
      const usageSummary = db.prepare(`
        SELECT
          COUNT(l.id) AS modelCalls,
          COALESCE(SUM(l.prompt_tokens), 0) AS promptTokens,
          COALESCE(SUM(l.completion_tokens), 0) AS completionTokens,
          COALESCE(SUM(l.total_tokens), 0) AS totalTokens,
          COALESCE(ROUND(SUM(l.estimated_cost_usd), 6), 0) AS estimatedCostUsd
        FROM agent_runs r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN ai_usage_logs l ON l.run_id = r.id
        ${where}
      `).get(...params);
      return res.json({ items, total, page, pageSize, range, statusCounts, usageSummary });
    } catch (error) {
      console.error("[Admin Agent Runs Error]", error);
      return res.status(500).json({ error: "获取 Agent Run 列表失败" });
    }
  });

  router.get("/agent-runs/:runId", async (req: AuthRequest, res) => {
    try {
      const runId = String(req.params.runId || "");
      if (!runIdPattern.test(runId)) return res.status(400).json({ error: "Agent Run ID 无效" });
      const row = db.prepare(`
        SELECT r.*, u.username,
          EXISTS(SELECT 1 FROM agent_run_media m WHERE m.run_id = r.id) AS has_media
        FROM agent_runs r JOIN users u ON u.id = r.user_id
        WHERE r.id = ?
      `).get(runId) as Record<string, unknown> | undefined;
      if (!row) return res.status(404).json({ error: "Agent Run 不存在" });

      const checkpointTableExists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'").get());
      const writesTableExists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'writes'").get());
      const checkpointCount = checkpointTableExists
        ? Number((db.prepare("SELECT COUNT(*) AS count FROM checkpoints WHERE thread_id = ?").get(row.checkpoint_thread_id) as { count: number }).count)
        : 0;
      const checkpointWriteCount = writesTableExists
        ? Number((db.prepare("SELECT COUNT(*) AS count FROM writes WHERE thread_id = ?").get(row.checkpoint_thread_id) as { count: number }).count)
        : 0;

      const eventRows = db.prepare(`
        SELECT sequence, agent_name AS agentName, event_type AS eventType, summary,
          payload_json AS payloadJson, created_at AS createdAt
        FROM agent_run_events WHERE run_id = ? ORDER BY sequence
      `).all(runId) as Array<Record<string, unknown>>;
      const actions = (db.prepare(`
        SELECT id, action_type AS actionType, risk_level AS riskLevel, status, payload_json AS payloadJson,
          before_json AS beforeJson, result_json AS resultJson, version, expires_at AS expiresAt,
          approval_decision AS approvalDecision, approved_by_user_id AS approvedByUserId,
          approved_at AS approvedAt, executed_at AS executedAt, undone_at AS undoneAt,
          created_at AS createdAt, updated_at AS updatedAt
        FROM agent_actions WHERE run_id = ? ORDER BY created_at, id
      `).all(runId) as Array<Record<string, unknown>>).map(({ payloadJson, beforeJson, resultJson, ...action }) => ({
        ...action,
        payload: parseJson(payloadJson, {}),
        before: parseJson(beforeJson),
        result: parseJson(resultJson),
      }));
      const usageRecords = db.prepare(`
        SELECT id, agent_name AS agentName, phase, endpoint, model,
          prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
          total_tokens AS totalTokens, estimated_cost_usd AS estimatedCostUsd,
          latency_ms AS latencyMs, success, failure_reason AS failureReason,
          created_at AS createdAt
        FROM ai_usage_logs
        WHERE run_id = ?
        ORDER BY id
      `).all(runId);
      const usageSummary = db.prepare(`
        SELECT COUNT(*) AS modelCalls,
          COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
          COALESCE(SUM(completion_tokens), 0) AS completionTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(ROUND(SUM(estimated_cost_usd), 6), 0) AS estimatedCostUsd,
          COALESCE(ROUND(AVG(latency_ms)), 0) AS avgLatencyMs
        FROM ai_usage_logs WHERE run_id = ?
      `).get(runId);
      const usageByAgent = db.prepare(`
        SELECT COALESCE(agent_name, 'Unknown') AS agentName, COUNT(*) AS modelCalls,
          COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
          COALESCE(SUM(completion_tokens), 0) AS completionTokens,
          COALESCE(SUM(total_tokens), 0) AS totalTokens,
          COALESCE(ROUND(SUM(estimated_cost_usd), 6), 0) AS estimatedCostUsd
        FROM ai_usage_logs WHERE run_id = ?
        GROUP BY COALESCE(agent_name, 'Unknown')
        ORDER BY totalTokens DESC, modelCalls DESC
      `).all(runId);
      const storedResult = parseJson(row.result_json, {}) as Record<string, unknown>;
      const storedArtifacts = Array.isArray(storedResult.artifacts) ? storedResult.artifacts : [];
      const safeInput = publicInput(row.input_json);
      let checkpointState: Awaited<ReturnType<typeof getPublicAgentCheckpointState>> = null;
      if (checkpointTableExists) {
        try { checkpointState = await getPublicAgentCheckpointState(runId); } catch { /* historical recovery is best-effort */ }
      }
      const events = eventRows.map(({ payloadJson, ...event }) => {
        const savedPayload = parseJson(payloadJson);
        if (savedPayload !== null && savedPayload !== undefined) {
          if (event.agentName === "Supervisor" && event.eventType === "routing_completed" && checkpointState?.goal && typeof savedPayload === "object") {
            return { ...event, payload: { ...(savedPayload as Record<string, unknown>), goal: checkpointState.goal, recoveredFromCheckpoint: true } };
          }
          return { ...event, payload: savedPayload };
        }
        if (event.eventType === "run_created") return { ...event, payload: { input: safeInput, recoveredFromRun: true } };
        if (event.eventType === "agent_completed" && checkpointState?.outputs[event.agentName as string] !== undefined) {
          return { ...event, payload: { ...(checkpointState.outputs[event.agentName as string] as Record<string, unknown>), recoveredFromCheckpoint: true } };
        }
        if (event.agentName === "OperationsAgent" && event.eventType === "agent_completed" && actions.length) {
          return { ...event, payload: { actions, recoveredFromRun: true } };
        }
        if (event.eventType === "specialist_results_validated" && storedArtifacts.length) {
          return { ...event, payload: { artifacts: storedArtifacts, recoveredFromRun: true } };
        }
        if (event.agentName === "Supervisor" && event.eventType === "run_completed" && Object.keys(storedResult).length) {
          return { ...event, payload: { ...storedResult, recoveredFromRun: true } };
        }
        if (event.agentName === "Supervisor" && event.eventType === "synthesis_started" && checkpointState) {
          return { ...event, payload: { specialists: checkpointState.specialists, artifactCount: checkpointState.artifactCount, actionCount: actions.length, recoveredFromCheckpoint: true } };
        }
        return { ...event, payload: null };
      });
      const run = {
        id: row.id,
        userId: row.user_id,
        username: row.username,
        sessionId: row.session_id,
        modality: row.modality,
        source: row.source,
        status: row.status,
        input: publicInput(row.input_json),
        result: storedResult,
        pendingApproval: parseJson(row.pending_approval_json),
        pendingInput: parseJson(row.pending_input_json),
        error: row.error_code || row.error_message ? { code: row.error_code, message: row.error_message } : null,
        hasMedia: Boolean(row.has_media),
        checkpointCount,
        checkpointWriteCount,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      await auditAdminAction(req, {
        action: "agent_run.view",
        resourceType: "agent_run",
        resourceId: runId,
        summary: "查看 Agent Run 运行详情",
        details: { userId: row.user_id, modality: row.modality, status: row.status },
      });
      return res.json({ run, events, actions, usage: { summary: usageSummary, byAgent: usageByAgent, records: usageRecords } });
    } catch (error) {
      console.error("[Admin Agent Run Detail Error]", error);
      return res.status(500).json({ error: "获取 Agent Run 详情失败" });
    }
  });

  return router;
}
