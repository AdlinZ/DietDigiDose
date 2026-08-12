import { randomUUID } from "node:crypto";
import { db } from "../../storage/db.js";
import type {
  AgentActionBundle,
  AgentActionProposal,
  AgentInput,
  AgentRunEvent,
  AgentRunStatus,
  AgentRunSummary,
  SpecialistName,
} from "./types.js";

type RunRow = {
  id: string;
  user_id: number;
  session_id: string;
  modality: AgentInput["modality"];
  source: string;
  status: AgentRunStatus;
  input_json: string;
  result_json: string | null;
  pending_approval_json: string | null;
  pending_input_json: string | null;
  error_code: string | null;
  error_message: string | null;
  checkpoint_thread_id: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function createAgentRun(userId: number, input: AgentInput) {
  const id = randomUUID();
  const sessionId = input.sessionId?.trim().slice(0, 120) || randomUUID();
  const mediaData = input.image || input.audioBase64;
  const mediaRef = mediaData ? randomUUID() : undefined;
  const persistedInput: AgentInput = { ...input, sessionId, mediaRef, image: undefined, audioBase64: undefined };
  db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_runs (id, user_id, session_id, modality, source, input_json, checkpoint_thread_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, sessionId, input.modality, input.source || "assistant", JSON.stringify(persistedInput), id);
    if (mediaRef && mediaData) {
      db.prepare("INSERT INTO agent_run_media (id, run_id, user_id, kind, mime_type, data_base64) VALUES (?, ?, ?, ?, ?, ?)")
        .run(mediaRef, id, userId, input.audioBase64 ? "audio" : "image", input.mimeType || null, mediaData);
    }
    const { mediaRef: _mediaRef, image: _image, audioBase64: _audioBase64, ...publicEventInput } = persistedInput;
    appendAgentEvent(id, userId, "Supervisor", "run_created", "已创建 AI Agent 任务", {
      input: publicEventInput,
      hasMedia: Boolean(mediaRef),
    });
  })();
  return { id, sessionId };
}

export function getAgentRunMedia(runId: string, userId: number) {
  return db.prepare("SELECT id, kind, mime_type, data_base64 FROM agent_run_media WHERE run_id = ? AND user_id = ? LIMIT 1")
    .get(runId, userId) as { id: string; kind: "image" | "audio"; mime_type: string | null; data_base64: string } | undefined;
}

export function getAgentRunRow(runId: string, userId?: number): RunRow | undefined {
  return (userId === undefined
    ? db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId)
    : db.prepare("SELECT * FROM agent_runs WHERE id = ? AND user_id = ?").get(runId, userId)) as RunRow | undefined;
}

export function findReusableAgentRun(userId: number, idempotencyKey: string, maxAgeMinutes = 15): RunRow | undefined {
  return db.prepare(`
    SELECT * FROM agent_runs
    WHERE user_id = ?
      AND json_extract(input_json, '$.idempotencyKey') = ?
      AND status IN ('queued', 'running', 'awaiting_approval', 'completed')
      AND created_at >= datetime('now', ?)
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, idempotencyKey, `-${Math.max(1, Math.min(maxAgeMinutes, 60))} minutes`) as RunRow | undefined;
}

export function getAgentRunInput(runId: string): { userId: number; input: AgentInput; threadId: string } | undefined {
  const row = getAgentRunRow(runId);
  if (!row) return undefined;
  return { userId: row.user_id, input: parseJson<AgentInput>(row.input_json, { modality: row.modality }), threadId: row.checkpoint_thread_id };
}

export function setAgentRunStatus(runId: string, status: AgentRunStatus, fields: {
  result?: Record<string, unknown>;
  pendingApproval?: AgentActionBundle | null;
  pendingInput?: { question: string } | null;
  errorCode?: string | null;
  errorMessage?: string | null;
} = {}) {
  db.prepare(`
    UPDATE agent_runs SET status = ?, result_json = COALESCE(?, result_json),
      pending_approval_json = CASE WHEN ? = 1 THEN ? ELSE pending_approval_json END,
      pending_input_json = CASE WHEN ? = 1 THEN ? ELSE pending_input_json END,
      error_code = ?, error_message = ?,
      started_at = CASE WHEN ? = 'queued' THEN NULL WHEN ? = 'running' AND started_at IS NULL THEN strftime('%Y-%m-%d %H:%M:%f', 'now') ELSE started_at END,
      completed_at = CASE WHEN ? = 'queued' THEN NULL WHEN ? IN ('completed', 'failed', 'cancelled', 'expired') THEN strftime('%Y-%m-%d %H:%M:%f', 'now') ELSE completed_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    status,
    fields.result === undefined ? null : JSON.stringify(fields.result),
    fields.pendingApproval === undefined ? 0 : 1,
    fields.pendingApproval ? JSON.stringify(fields.pendingApproval) : null,
    fields.pendingInput === undefined ? 0 : 1,
    fields.pendingInput ? JSON.stringify(fields.pendingInput) : null,
    fields.errorCode ?? null,
    fields.errorMessage ?? null,
    status,
    status,
    status,
    status,
    runId,
  );
}

export function appendAgentEvent(
  runId: string,
  userId: number,
  agentName: SpecialistName,
  eventType: string,
  summary: string,
  payload?: unknown,
) {
  const next = db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_run_events WHERE run_id = ?")
    .get(runId) as { sequence: number };
  db.prepare(`
    INSERT INTO agent_run_events (run_id, user_id, sequence, agent_name, event_type, summary, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(runId, userId, next.sequence, agentName, eventType, summary.slice(0, 500), payload === undefined ? null : JSON.stringify(payload));
  return next.sequence;
}

export function listAgentEvents(runId: string, userId: number, afterSequence = 0): AgentRunEvent[] {
  return (db.prepare(`
    SELECT sequence, agent_name, event_type, summary, payload_json, created_at
    FROM agent_run_events WHERE run_id = ? AND user_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 200
  `).all(runId, userId, afterSequence) as Array<Record<string, unknown>>).map((row) => ({
    sequence: Number(row.sequence),
    agentName: row.agent_name as SpecialistName,
    eventType: String(row.event_type),
    summary: String(row.summary),
    payload: parseJson(String(row.payload_json || ""), undefined),
    createdAt: String(row.created_at),
  }));
}

export function saveAgentActions(runId: string, userId: number, proposals: AgentActionProposal[]) {
  const existing = db.prepare("SELECT id, action_type FROM agent_actions WHERE run_id = ? ORDER BY created_at, id").all(runId) as Array<{ id: string; action_type: string }>;
  if (existing.length) {
    return existing.map((item, index) => ({ ...proposals[index], id: item.id })).filter((item) => item.actionType);
  }
  const insert = db.prepare(`
    INSERT INTO agent_actions (id, run_id, user_id, action_type, risk_level, status, payload_json, idempotency_key, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))
  `);
  return proposals.map((proposal, index) => {
    const id = randomUUID();
    insert.run(
      id, runId, userId, proposal.actionType, proposal.riskLevel,
      proposal.riskLevel === "low" ? "proposed" : "awaiting_approval",
      JSON.stringify(proposal.payload), `${runId}:${index}:${proposal.actionType}`,
    );
    return { ...proposal, id, version: 1 };
  });
}

export function updateActionStatus(actionId: string, status: string, fields: { before?: unknown; result?: unknown } = {}) {
  db.prepare(`
    UPDATE agent_actions SET status = ?, before_json = COALESCE(?, before_json), result_json = COALESCE(?, result_json),
      executed_at = CASE WHEN ? = 'executed' THEN CURRENT_TIMESTAMP ELSE executed_at END,
      undone_at = CASE WHEN ? = 'undone' THEN CURRENT_TIMESTAMP ELSE undone_at END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, fields.before === undefined ? null : JSON.stringify(fields.before), fields.result === undefined ? null : JSON.stringify(fields.result), status, status, actionId);
}

export function recordActionDecision(actionIds: string[], userId: number, decision: "approve" | "reject" | "edit") {
  const update = db.prepare(`UPDATE agent_actions SET approval_decision = ?, approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 'awaiting_approval'`);
  for (const id of actionIds) update.run(decision, userId, id, userId);
}

export function getRunActions(runId: string, userId: number) {
  return (db.prepare("SELECT * FROM agent_actions WHERE run_id = ? AND user_id = ? ORDER BY created_at, id").all(runId, userId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    actionType: String(row.action_type) as AgentActionProposal["actionType"],
    riskLevel: String(row.risk_level) as AgentActionProposal["riskLevel"],
    status: String(row.status),
    payload: parseJson<Record<string, unknown>>(String(row.payload_json), {}),
    before: parseJson(String(row.before_json || ""), undefined),
    result: parseJson(String(row.result_json || ""), undefined),
    version: Number(row.version),
    createdAt: String(row.created_at),
    executedAt: row.executed_at ? String(row.executed_at) : undefined,
  }));
}

export function reviseRunActions(runId: string, userId: number, actions: Array<AgentActionProposal & { id?: string }>) {
  const update = db.prepare(`UPDATE agent_actions SET action_type = ?, risk_level = ?, payload_json = ?, version = version + 1,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND run_id = ? AND user_id = ? AND status = 'awaiting_approval'`);
  for (const action of actions) {
    if (!action.id) throw new Error("编辑后的操作缺少 ID");
    if (update.run(action.actionType, action.riskLevel, JSON.stringify(action.payload), action.id, runId, userId).changes !== 1) {
      throw new Error("待批准操作已变化，请刷新后重试");
    }
  }
}

export function toAgentRunSummary(row: RunRow): AgentRunSummary {
  const result = parseJson<{ reply?: string; transcript?: string; artifacts?: AgentRunSummary["artifacts"] }>(row.result_json, {});
  const timestampMs = (value: string | null) => value ? Date.parse(`${value.replace(" ", "T")}Z`) : Number.NaN;
  const startedMs = timestampMs(row.started_at);
  const completedMs = timestampMs(row.completed_at);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs) ? Math.max(0, completedMs - startedMs) : undefined;
  return {
    id: row.id,
    sessionId: row.session_id,
    modality: row.modality,
    source: row.source,
    status: row.status,
    reply: result.reply,
    transcript: result.transcript,
    artifacts: result.artifacts || [],
    pendingApproval: parseJson<AgentActionBundle | undefined>(row.pending_approval_json, undefined),
    pendingInput: parseJson<{ question: string } | undefined>(row.pending_input_json, undefined),
    error: row.error_code || row.error_message ? { code: row.error_code || "AGENT_FAILED", message: row.error_message || "Agent 执行失败" } : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    durationMs,
  };
}

export function listRecoverableAgentRuns() {
  return db.prepare("SELECT id FROM agent_runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC LIMIT 100").all() as Array<{ id: string }>;
}

export function deleteUserAgentData(userId: number) {
  const threads = db.prepare("SELECT checkpoint_thread_id FROM agent_runs WHERE user_id = ?").all(userId) as Array<{ checkpoint_thread_id: string }>;
  const hasCheckpointTable = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'").get());
  if (hasCheckpointTable) {
    const deleteCheckpoint = db.prepare("DELETE FROM checkpoints WHERE thread_id = ?");
    const deleteWrites = db.prepare("DELETE FROM writes WHERE thread_id = ?");
    for (const thread of threads) {
      deleteWrites.run(thread.checkpoint_thread_id);
      deleteCheckpoint.run(thread.checkpoint_thread_id);
    }
  }
  return db.prepare("DELETE FROM agent_runs WHERE user_id = ?").run(userId).changes;
}
