import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { describe, test } from "node:test";
import { RealtimeVoiceError } from "../src/modules/realtimeVoice/errors.js";
import type { RealtimeVoiceRepository } from "../src/modules/realtimeVoice/repository.js";
import { RealtimeVoiceService } from "../src/modules/realtimeVoice/service.js";
import type { RealtimeVoiceEvent, RealtimeVoiceSession, RealtimeVoiceTurn, TranscriptChunk } from "../src/modules/realtimeVoice/types.js";

function activeSession(overrides: Partial<RealtimeVoiceSession> = {}): RealtimeVoiceSession {
  return { id: "session-1", userId: 42, recipeId: 7, status: "active", platform: "ios", context: { recipeTitle: "番茄炒蛋" },
    version: 1, connectedAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    firstTranscriptMs: null, firstResponseMs: null, interruptions: 0, reconnects: 0, fallbacks: 0, ...overrides };
}

function fakeRepository(overrides: Partial<RealtimeVoiceRepository> = {}) {
  const state = { session: activeSession(), chunks: new Map<string, TranscriptChunk>(), turns: new Map<string, RealtimeVoiceTurn>(),
    events: [] as RealtimeVoiceEvent[], completed: [] as Array<{ text: string; status: string }>, cancelled: [] as string[] };
  const repository: RealtimeVoiceRepository = {
    createSession: async () => ({ status: "created", session: state.session }),
    session: async (_sessionId, userId) => userId === state.session.userId ? state.session : null,
    heartbeat: async (_sessionId, _userId, version, status, reconnect) => {
      if (version !== state.session.version) return null;
      state.session = { ...state.session, status, version: version + 1, reconnects: state.session.reconnects + Number(reconnect) };
      return state.session;
    },
    transcript: async (_sessionId, turnId, sequence) => state.chunks.get(`${turnId}:${sequence}`) ?? null,
    recordTranscript: async (input) => { state.chunks.set(`${input.turnId}:${input.sequence}`,
      { transcript: input.transcript, final: input.final, latencyMs: input.latencyMs }); },
    turn: async (_sessionId, _userId, turnId) => state.turns.get(turnId) ?? null,
    recordTurnActivity: async () => {},
    interruptedTurn: async () => ({ id: "old-turn", agentRunId: "old-run" }),
    recordTurn: async (input) => { state.turns.set(input.id, { id: input.id, intent: input.intent, action: input.action,
      agentRunId: input.agentRunId ?? null }); },
    emitEvent: async (_sessionId, type, payload) => { const sequence = state.events.length + 1;
      state.events.push({ sequence, type, payload, createdAt: new Date().toISOString() }); return sequence; },
    events: async (_sessionId, after) => state.events.filter((event) => event.sequence > after),
    completeResponse: async (input) => { state.completed.push({ text: input.text, status: input.status }); },
    pendingRuns: async () => ["pending-run"],
    close: async () => { state.session = { ...state.session, status: "closed", version: state.session.version + 1 }; return state.session; },
    ...overrides,
  };
  return { repository, state };
}

function service(repository: RealtimeVoiceRepository, overrides: Partial<ConstructorParameters<typeof RealtimeVoiceService>[1]> = {}) {
  return new RealtimeVoiceService(repository, {
    transcribe: async () => ({ text: "  切好的番茄  " }),
    startRun: async () => ({ run: { id: "run-1", status: "queued" } }),
    waitForRun: async () => ({ id: "run-1", status: "completed", reply: "保持中火翻炒。" }),
    cancelRun: () => {},
    ...overrides,
  });
}

describe("realtime voice module", () => {
  test("keeps optimistic heartbeats and ownership database-neutral", async () => {
    const { repository, state } = fakeRepository(); const subject = service(repository);
    assert.equal((await subject.heartbeat(42, state.session.id, { version: 1, muted: true, reconnect: true })).session.status, "muted");
    await assert.rejects(() => subject.heartbeat(42, state.session.id, { version: 1 }),
      (error: unknown) => error instanceof RealtimeVoiceError && error.code === "REALTIME_VOICE_VERSION_CONFLICT");
    await assert.rejects(() => subject.sessionEvents(99, state.session.id, 0),
      (error: unknown) => error instanceof RealtimeVoiceError && error.status === 404);
  });

  test("deduplicates transcript chunks and does not retain audio", async () => {
    const { repository, state } = fakeRepository(); let transcriptions = 0;
    const subject = service(repository, { transcribe: async () => { transcriptions += 1; return { text: " 切好的番茄 " }; } });
    const input = { turnId: "turn-a", sequence: 1, audioBase64: "data:audio/webm;base64,YXVkaW8=", mimeType: "audio/webm", final: true };
    assert.equal((await subject.audio(42, state.session.id, input)).transcript, "切好的番茄");
    assert.equal((await subject.audio(42, state.session.id, input)).repeated, true);
    assert.equal(transcriptions, 1);
  });

  test("routes deterministic controls and persistent writes without an Agent Run", async () => {
    const { repository, state } = fakeRepository(); let runs = 0;
    const subject = service(repository, { startRun: async () => { runs += 1; return { run: { id: "unexpected", status: "queued" } }; } });
    const control = await subject.turn(42, state.session.id, { turnId: "turn-control", transcript: "增加5分钟", currentStep: 1, timerSeconds: 0 });
    assert.deepEqual(control.action, { action: "ADD_TIMER", seconds: 300 });
    const confirmation = await subject.turn(42, state.session.id,
      { turnId: "turn-write", transcript: "删除这条库存", currentStep: 1, timerSeconds: 0 });
    assert.equal(confirmation.intent, "confirmation_required");
    assert.equal(confirmation.action?.requiresConfirmation, true);
    assert.equal(runs, 0);
  });

  test("streams completed answers, cancels barge-ins, and cancels pending work on close", async () => {
    const { repository, state } = fakeRepository(); const cancelled: string[] = [];
    const subject = service(repository, { cancelRun: (_userId, runId) => { cancelled.push(runId); } });
    const result = await subject.turn(42, state.session.id,
      { turnId: "turn-question", transcript: "现在火候怎么控制", currentStep: 2, timerSeconds: 30, interruptedResponse: true });
    assert.equal(result.intent, "question");
    await waitForImmediate();
    assert.deepEqual(cancelled, ["old-run"]);
    assert.deepEqual(state.completed, [{ text: "保持中火翻炒。", status: "completed" }]);
    await subject.close(42, state.session.id);
    assert.deepEqual(cancelled, ["old-run", "pending-run"]);
  });
});
