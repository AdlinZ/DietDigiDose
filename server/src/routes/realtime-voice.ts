import { randomUUID } from "node:crypto";
import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uuidParam } from "../middleware/validateParam.js";
import { sharedRateLimit } from "../middleware/sharedRateLimit.js";
import { cancelSupervisorRun, startSupervisorRun, waitForSupervisorRunCompletion } from "../services/agent/runtime.js";
import { db } from "../storage/db.js";
import { sendError } from "../utils/http.js";
import { realtimeVoiceHeartbeatSchema, realtimeVoiceSessionSchema, realtimeVoiceTurnSchema } from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);
const realtimeTurnRateLimit = sharedRateLimit({
  namespace: "realtime-voice-user",
  limit: Math.max(10, Number(process.env.REALTIME_VOICE_RATE_LIMIT) || 90),
  windowMs: 15 * 60 * 1000,
  key: (req) => String((req as AuthRequest).userId || "unknown"),
  message: "实时语音请求过于频繁，请稍后重试",
  code: "REALTIME_VOICE_RATE_LIMITED",
});
router.use((req, res, next) => req.method === "POST" && req.path.endsWith("/turns")
  ? realtimeTurnRateLimit(req, res, next)
  : next());
router.param("sessionId", uuidParam);

type Row = Record<string, unknown>;

function ownedSession(sessionId: string, userId: number) {
  return db.prepare("SELECT * FROM realtime_voice_sessions WHERE id = ? AND user_id = ?")
    .get(sessionId, userId) as Row | undefined;
}

function formatSession(row: Row) {
  return {
    id: String(row.id),
    recipeId: Number(row.recipe_id),
    status: String(row.status),
    platform: String(row.client_platform),
    version: Number(row.version),
    connectedAt: String(row.connected_at),
    expiresAt: String(row.expires_at),
    metrics: {
      firstTranscriptMs: row.first_transcript_ms === null ? null : Number(row.first_transcript_ms),
      firstResponseMs: row.first_response_ms === null ? null : Number(row.first_response_ms),
      interruptions: Number(row.interruption_count || 0),
      reconnects: Number(row.reconnect_count || 0),
      fallbacks: Number(row.fallback_count || 0),
    },
  };
}

function emitEvent(sessionId: string, eventType: string, payload: Record<string, unknown>) {
  return db.transaction(() => {
    const sequence = Number((db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM realtime_voice_events WHERE session_id = ?")
      .get(sessionId) as { value: number }).value);
    db.prepare("INSERT INTO realtime_voice_events (session_id, sequence, event_type, payload_json) VALUES (?, ?, ?, ?)")
      .run(sessionId, sequence, eventType, JSON.stringify(payload));
    return sequence;
  })();
}

function listEvents(sessionId: string, after: number) {
  return (db.prepare("SELECT * FROM realtime_voice_events WHERE session_id = ? AND sequence > ? ORDER BY sequence LIMIT 100")
    .all(sessionId, after) as Row[]).map((event) => ({
      sequence: Number(event.sequence),
      type: String(event.event_type),
      payload: JSON.parse(String(event.payload_json || "{}")),
      createdAt: String(event.created_at),
    }));
}

function deterministicIntent(text: string) {
  if (/下一步|继续(?:下一步)?/.test(text)) return { intent: "control", action: "NEXT_STEP" };
  if (/上一步|返回上一步/.test(text)) return { intent: "control", action: "PREV_STEP" };
  if (/暂停.*(?:计时|倒计时)|停一下计时/.test(text)) return { intent: "control", action: "PAUSE_TIMER" };
  if (/开始.*(?:计时|倒计时)|继续计时/.test(text)) return { intent: "control", action: "START_TIMER" };
  const add = /(?:增加|加)(\d{1,2})(?:分钟|分)/.exec(text);
  if (add) return { intent: "control", action: "ADD_TIMER", seconds: Number(add[1]) * 60 };
  if (/删除|扣减库存|记录饮食|打卡|完成烹饪|清空/.test(text)) return { intent: "confirmation_required", action: "PERSISTENT_WRITE" };
  return { intent: "question", action: null };
}

router.post("/sessions", validateBody(realtimeVoiceSessionSchema), (req: AuthRequest, res) => {
  const recipe = db.prepare("SELECT id, title FROM recipes WHERE id = ? AND status = 'approved' AND deleted_at IS NULL")
    .get(req.body.recipeId) as { id: number; title: string } | undefined;
  if (!recipe) return sendError(res, 404, "菜谱不存在或不可用于实时语音", "RECIPE_NOT_AVAILABLE");
  const existing = db.prepare("SELECT * FROM realtime_voice_sessions WHERE user_id = ? AND idempotency_key = ?")
    .get(req.userId!, req.body.idempotencyKey) as Row | undefined;
  if (existing) return res.json({ session: formatSession(existing), repeated: true });
  const id = randomUUID();
  const context = { recipeTitle: recipe.title, currentStep: req.body.currentStep, recipeSteps: req.body.recipeSteps, recipeIngredients: req.body.recipeIngredients };
  db.prepare(`INSERT INTO realtime_voice_sessions
    (id, user_id, recipe_id, client_platform, context_json, idempotency_key, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+2 hour'))`)
    .run(id, req.userId!, recipe.id, req.body.platform, JSON.stringify(context), req.body.idempotencyKey);
  emitEvent(id, "session.ready", { transport: "event-stream", rawAudioRetained: false, vad: "client" });
  return res.status(201).json({ session: formatSession(ownedSession(id, req.userId!)!), repeated: false });
});

router.post("/sessions/:sessionId/heartbeat", validateBody(realtimeVoiceHeartbeatSchema), (req: AuthRequest, res) => {
  const session = ownedSession(String(req.params.sessionId), req.userId!);
  if (!session || session.status === "closed") return sendError(res, 404, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND");
  if (Number(session.version) !== req.body.version) return sendError(res, 409, "会话状态已更新", "REALTIME_VOICE_VERSION_CONFLICT");
  const status = req.body.muted === undefined ? String(session.status) : req.body.muted ? "muted" : "active";
  db.prepare(`UPDATE realtime_voice_sessions SET status = ?, version = version + 1,
    reconnect_count = reconnect_count + ?, last_heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, req.body.reconnect ? 1 : 0, session.id);
  return res.json({ session: formatSession(ownedSession(String(session.id), req.userId!)!) });
});

router.post("/sessions/:sessionId/turns", validateBody(realtimeVoiceTurnSchema), async (req: AuthRequest, res) => {
  const session = ownedSession(String(req.params.sessionId), req.userId!);
  if (!session || !["active", "muted"].includes(String(session.status)) || Date.parse(String(session.expires_at).replace(" ", "T") + "Z") <= Date.now()) {
    return sendError(res, 410, "实时语音会话已结束", "REALTIME_VOICE_SESSION_EXPIRED");
  }
  const prior = db.prepare("SELECT * FROM realtime_voice_turns WHERE id = ? AND session_id = ? AND user_id = ?")
    .get(req.body.turnId, session.id, req.userId!) as Row | undefined;
  if (prior) return res.json({ turnId: prior.id, intent: prior.intent, action: JSON.parse(String(prior.action_json)), repeated: true });
  const text = String(req.body.transcript);
  const parsed = deterministicIntent(text);
  const connectedAt = Date.parse(String(session.connected_at).replace(" ", "T") + "Z");
  db.prepare(`UPDATE realtime_voice_sessions SET
    first_transcript_ms = COALESCE(first_transcript_ms, ?),
    interruption_count = interruption_count + ?, last_heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(Math.max(0, Date.now() - connectedAt), req.body.interruptedResponse ? 1 : 0, session.id);
  if (req.body.interruptedResponse) {
    const interrupted = db.prepare(`SELECT id, agent_run_id FROM realtime_voice_turns
      WHERE session_id = ? AND user_id = ? AND intent = 'question' AND agent_run_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`).get(session.id, req.userId!) as { id: string; agent_run_id: string } | undefined;
    if (interrupted?.agent_run_id) {
      try { cancelSupervisorRun(req.userId!, interrupted.agent_run_id); } catch { /* The prior run may have just reached a terminal state. */ }
    }
    emitEvent(String(session.id), "response.cancelled", {
      turnId: interrupted?.id || req.body.turnId,
      interruptedByTurnId: req.body.turnId,
      reason: "barge_in",
    });
  }

  if (parsed.intent !== "question") {
    const action = parsed.intent === "confirmation_required"
      ? { action: parsed.action, requiresConfirmation: true, message: "该操作会修改持久数据，请在屏幕上确认后执行" }
      : { action: parsed.action, seconds: parsed.seconds || 0 };
    db.prepare("INSERT INTO realtime_voice_turns (id, session_id, user_id, transcript, intent, action_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(req.body.turnId, session.id, req.userId!, text, parsed.intent, JSON.stringify(action));
    emitEvent(String(session.id), parsed.intent === "control" ? "control.ready" : "confirmation.required", { turnId: req.body.turnId, ...action });
    return res.status(201).json({ turnId: req.body.turnId, intent: parsed.intent, action, repeated: false });
  }

  const context = JSON.parse(String(session.context_json || "{}")) as Row;
  const response = await startSupervisorRun(req.userId!, {
    modality: "cooking", source: "realtime_cooking_voice", sessionId: String(session.id),
    idempotencyKey: `realtime-voice:${session.id}:${req.body.turnId}`,
    prompt: `${text}\n当前菜品：${String(context.recipeTitle || "当前菜品")}；当前步骤序号：${req.body.currentStep}；计时：${req.body.timerSeconds} 秒。回答限 80 字。`,
    metadata: { realtimeVoiceSessionId: session.id, turnId: req.body.turnId, currentStep: req.body.currentStep },
  }, 0);
  db.prepare("INSERT INTO realtime_voice_turns (id, session_id, user_id, transcript, intent, action_json, agent_run_id) VALUES (?, ?, ?, ?, 'question', '{}', ?)")
    .run(req.body.turnId, session.id, req.userId!, text, response.run.id);
  emitEvent(String(session.id), "response.started", { turnId: req.body.turnId, runId: response.run.id });
  void waitForSupervisorRunCompletion(response.run.id).then((run) => {
    const active = ownedSession(String(session.id), req.userId!);
    if (!active || active.status === "closed") return;
    if (run.status === "cancelled" || run.status === "expired") return;
    const reply = run.reply || run.error?.message || "暂时无法回答，请使用屏幕操作继续烹饪";
    const chunks = reply.split(/(?<=[。！？!?])/).filter(Boolean);
    chunks.forEach((delta, index) => emitEvent(String(session.id), "response.text.delta", { turnId: req.body.turnId, index, delta }));
    emitEvent(String(session.id), "response.completed", { turnId: req.body.turnId, text: reply, status: run.status });
    db.prepare("UPDATE realtime_voice_sessions SET first_response_ms = COALESCE(first_response_ms, ?) WHERE id = ?")
      .run(Math.max(0, Date.now() - connectedAt), session.id);
  }).catch(() => emitEvent(String(session.id), "response.failed", { turnId: req.body.turnId }));
  return res.status(202).json({ turnId: req.body.turnId, intent: "question", run: response.run, repeated: false });
});

router.get("/sessions/:sessionId/events", (req: AuthRequest, res) => {
  const session = ownedSession(String(req.params.sessionId), req.userId!);
  if (!session) return sendError(res, 404, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND");
  const after = Math.max(0, Number(req.query.after) || 0);
  return res.json({ session: formatSession(session), events: listEvents(String(session.id), after) });
});

router.get("/sessions/:sessionId/stream", (req: AuthRequest, res) => {
  const session = ownedSession(String(req.params.sessionId), req.userId!);
  if (!session) return sendError(res, 404, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND");
  let after = Math.max(0, Number(req.query.after) || 0);
  res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  const send = () => {
    for (const event of listEvents(String(session.id), after)) {
      after = event.sequence;
      res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    }
  };
  send();
  const timer = setInterval(() => { send(); res.write(": heartbeat\n\n"); }, 1_000);
  req.on("close", () => clearInterval(timer));
});

router.delete("/sessions/:sessionId", (req: AuthRequest, res) => {
  const session = ownedSession(String(req.params.sessionId), req.userId!);
  if (!session) return sendError(res, 404, "实时语音会话不存在", "REALTIME_VOICE_SESSION_NOT_FOUND");
  if (session.status !== "closed") {
    const pendingRuns = db.prepare(`SELECT agent_run_id FROM realtime_voice_turns
      WHERE session_id = ? AND user_id = ? AND agent_run_id IS NOT NULL`)
      .all(session.id, req.userId!) as Array<{ agent_run_id: string }>;
    for (const pending of pendingRuns) {
      try { cancelSupervisorRun(req.userId!, pending.agent_run_id); } catch { /* Terminal runs need no cancellation. */ }
    }
    db.prepare("UPDATE realtime_voice_sessions SET status = 'closed', version = version + 1, closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
    emitEvent(String(session.id), "session.closed", { rawAudioRetained: false });
  }
  return res.json({ session: formatSession(ownedSession(String(session.id), req.userId!)!) });
});

export default router;
