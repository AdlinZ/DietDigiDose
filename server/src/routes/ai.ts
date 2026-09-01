import { Router } from "express";
import { randomUUID } from "node:crypto";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { db } from "../storage/db.js";
import { aiWriteConfirmationsService } from "../modules/aiWriteConfirmations/runtime.js";
import { validateBody } from "../middleware/validate.js";
import {
  aiChatSchema,
  aiWriteConfirmationCommitSchema,
  aiHomeRecommendationsSchema,
  aiImageSchema,
  aiTranscribeSchema,
  aiVisionSchema,
  aiVoiceCommandSchema,
} from "../validation/schemas.js";
import { uuidParam } from "../middleware/validateParam.js";
import { sharedRateLimit } from "../middleware/sharedRateLimit.js";
import { startSupervisorRun, waitForSupervisorRunCompletion } from "../services/agent/runtime.js";
import { getAgentRunRow, toAgentRunSummary } from "../services/agent/repository.js";
import { buildAgentSolutionCards } from "../services/agent/cards.js";
import { ensureUserInitialState } from "../modules/accessControl/index.js";
import { aiErrorTypeForCode } from "../services/aiErrors.js";
import { getChatConfig } from "../services/aiService.js";
import { recommendationsService } from "../modules/recommendations/runtime.js";

const router = Router();
router.param("jobId", uuidParam);
router.param("confirmationId", uuidParam);
const aiRateLimit = sharedRateLimit({
  namespace: "ai-user",
  limit: Math.max(1, Number(process.env.AI_RATE_LIMIT) || 30),
  windowMs: 15 * 60 * 1000,
  key: (req) => String((req as AuthRequest).userId || "unknown"),
  message: "AI 请求过于频繁，请稍后重试",
  code: "AI_RATE_LIMITED",
});

router.use(authMiddleware);
router.use((req, res, next) => {
  if (req.method !== "POST" || req.path.includes("/write-confirmations/")) return next();
  return aiRateLimit(req, res, next);
});

type InventoryScanItem = {
  foodName: string;
  quantity: string;
  suggestedStorageLocation: "冷藏" | "冷冻" | "常温";
  estimatedExpireDays: number;
};

type HomeRecommendation = {
  title: string;
  tag: string;
  desc: string;
  calories: number;
  prompt: string;
};

const normalizeHomeRecommendations = (raw: unknown): HomeRecommendation[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((card): card is Record<string, unknown> => !!card && typeof card === "object")
    .map((card) => ({
      title: typeof card.title === "string" ? card.title.trim().slice(0, 24) : "",
      tag: typeof card.tag === "string" ? card.tag.trim().slice(0, 10) : "",
      desc: typeof card.desc === "string" ? card.desc.trim().slice(0, 44) : "",
      calories: Math.max(0, Math.min(Math.round(Number(card.calories) || 0), 2000)),
      prompt: typeof card.prompt === "string" ? card.prompt.trim().slice(0, 240) : "",
    }))
    .filter((card) => card.title && card.tag && card.desc && card.calories > 0 && card.prompt)
    .slice(0, 5);

const parseHomeRecommendations = (reply: string): HomeRecommendation[] => {
  const candidates = [
    reply.trim(),
    reply.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    reply.match(/\{[\s\S]*\}/)?.[0],
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { cards?: unknown };
      const cards = normalizeHomeRecommendations(parsed.cards);
      if (cards.length > 0) return cards;
    } catch {
      // Try the next possible JSON fragment.
    }
  }
  return [];
};

const normalizeInventoryScanItems = (raw: unknown): InventoryScanItem[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && typeof item.foodName === "string" && item.foodName.trim().length > 0)
    .slice(0, 30)
    .map((item) => ({
      foodName: String(item.foodName).trim(),
      quantity: typeof item.quantity === "string" && item.quantity.trim() ? item.quantity.trim() : "1份",
      suggestedStorageLocation: ["冷藏", "冷冻", "常温"].includes(String(item.suggestedStorageLocation))
        ? item.suggestedStorageLocation as InventoryScanItem["suggestedStorageLocation"]
        : "冷藏",
      estimatedExpireDays: Math.max(1, Math.min(Number(item.estimatedExpireDays) || 7, 365)),
    }));

type ChatTurnAudit = {
  userId: number;
  sessionId: string;
  source: "assistant" | "voice" | "cooking" | "cooking_voice";
  userContent: string;
  assistantContent: string;
  systemContents?: string[];
  status?: "completed" | "failed";
  payload?: Record<string, unknown> | null;
  confirmationId?: string | null;
  responseTimeMs: number;
  requestedAt: number;
  respondedAt: number;
};

const toStoredDateTime = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 23).replace("T", " ");

export const recordChatTurn = ({
  userId,
  sessionId,
  source,
  userContent,
  assistantContent,
  systemContents = [],
  status = "completed",
  payload = null,
  confirmationId = null,
  responseTimeMs,
  requestedAt,
  respondedAt,
}: ChatTurnAudit) => {
  const insert = db.prepare(`
    INSERT INTO ai_chat_messages
      (user_id, session_id, role, content, response_time_ms, source, status,
       payload_json, confirmation_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const save = db.transaction(() => {
    const requestTime = toStoredDateTime(requestedAt);
    const deletedAfterRequest = db.prepare(`
      SELECT 1 FROM ai_chat_session_deletions
      WHERE user_id = ? AND session_id = ? AND deleted_at >= ?
      LIMIT 1
    `).get(userId, sessionId, requestTime);
    if (deletedAfterRequest) return false;
    [...new Set(systemContents.map((content) => content.trim()).filter(Boolean))].forEach((content) => {
      insert.run(userId, sessionId, "system", content.slice(0, 12000), null, source, "completed", null, null, requestTime);
    });
    insert.run(userId, sessionId, "user", userContent.slice(0, 12000), null, source, "completed", null, null, requestTime);
    insert.run(
      userId,
      sessionId,
      "assistant",
      assistantContent.slice(0, 12000),
      Math.max(0, Math.round(responseTimeMs)),
      source,
      status,
      payload ? JSON.stringify(payload).slice(0, 50_000) : null,
      confirmationId,
      toStoredDateTime(respondedAt),
    );
    return true;
  });
  try { save(); } catch (error) { console.error("[AI Chat Audit Error]", error); }
};

/**
 * 1. AI 对话 / 营养大厨答疑 (含 Function Calling 自动写库)
 */
router.post("/chat", validateBody(aiChatSchema), async (req: AuthRequest, res) => {
  const requestStartedAt = Date.now();
  const { messages = [], prompt, sessionId: requestedSessionId, source = "assistant", image, imageMimeType } = req.body;
  const userId = req.userId!;
  await ensureUserInitialState(userId);
  const sessionId = typeof requestedSessionId === "string" && requestedSessionId.trim()
    ? requestedSessionId.trim().slice(0, 120)
    : randomUUID();
  const clientMessages = Array.isArray(messages) ? messages : [];
  const requestedContent = [...clientMessages].reverse().find((message: any) => message.role === "user")?.content ?? prompt;
  const requestedText = typeof requestedContent === "string" ? requestedContent : "";

  try {
    const response = await startSupervisorRun(userId, {
      modality: image ? "image" : source === "cooking" ? "cooking" : "text",
      source,
      prompt: requestedText,
      messages: clientMessages,
      sessionId,
      ...(image ? {
        image,
        mimeType: imageMimeType,
        metadata: { attachmentMode: "chat" },
      } : {}),
    }, 0);
    const respondedAt = Date.now();
    const responseTimeMs = respondedAt - requestStartedAt;
    const artifacts = response.artifacts ?? response.run.artifacts;
    const solutionCards = buildAgentSolutionCards(response.run.id, artifacts);
    if (response.run.status === "queued" || response.run.status === "running") {
      void waitForSupervisorRunCompletion(response.run.id).then(async (completedRun) => {
        const completedAt = Date.now();
        const assistantContent = completedRun.reply || completedRun.error?.message;
        if (!requestedText || !assistantContent) return;
        recordChatTurn({
          userId,
          sessionId,
          source,
          userContent: requestedText,
          assistantContent,
          status: completedRun.status === "failed" ? "failed" : "completed",
          payload: {
            agentRunId: completedRun.id,
            artifacts: completedRun.artifacts,
            solutionCards: buildAgentSolutionCards(completedRun.id, completedRun.artifacts),
            pendingApproval: completedRun.pendingApproval,
            errorCode: completedRun.error?.code,
            errorType: aiErrorTypeForCode(completedRun.error?.code),
            errorMessage: completedRun.error?.message,
            failureStage: "agent_execution",
            requestId: String(res.locals.requestId || ""),
            occurredAt: new Date(completedAt).toISOString(),
            source,
            modelIdentifier: (await getChatConfig()).model,
          },
          responseTimeMs: completedAt - requestStartedAt,
          requestedAt: requestStartedAt,
          respondedAt: completedAt,
        });
      }).catch((error) => console.error("[AI Chat Async Audit Error]", error));
    }
    if (response.run.status === "failed") {
      const errorMessage = response.run.error?.message || "AI Agent 执行失败，请稍后重试";
      const errorCode = errorMessage.includes("未配置") ? "AI_NOT_CONFIGURED" : (response.run.error?.code || "AI_AGENT_FAILED");
      if (requestedText) {
        recordChatTurn({
          userId, sessionId, source, userContent: requestedText, assistantContent: errorMessage,
          status: "failed", payload: {
            agentRunId: response.run.id,
            errorCode,
            errorType: aiErrorTypeForCode(errorCode),
            errorMessage,
            failureStage: "agent_execution",
            requestId: String(res.locals.requestId || ""),
            occurredAt: new Date(respondedAt).toISOString(),
            source,
            modelIdentifier: (await getChatConfig()).model,
          }, responseTimeMs,
          requestedAt: requestStartedAt, respondedAt,
        });
      }
      return res.status(503).json({ ...response, error: errorMessage, code: errorCode, sessionId, responseTimeMs });
    }
    if (response.reply) recordChatTurn({
      userId, sessionId, source, userContent: requestedText, assistantContent: response.reply,
      payload: { agentRunId: response.run.id, artifacts, solutionCards, pendingApproval: response.pendingApproval },
      responseTimeMs, requestedAt: requestStartedAt, respondedAt,
    });
    return res.status(response.run.status === "queued" || response.run.status === "running" ? 202 : 200).json({
      ...response, solutionCards, sessionId, responseTimeMs,
    });
  } catch (error: any) {
    console.error("[AI Router Chat Error]", error);
    const errorMessage = "AI 对话请求失败，请稍后重试";
    if (requestedText) {
      const respondedAt = Date.now();
      recordChatTurn({ userId, sessionId, source, userContent: requestedText, assistantContent: errorMessage, status: "failed", payload: {
        errorCode: "AI_AGENT_FAILED",
        errorType: "server",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unknown server error",
        failureStage: "request_processing",
        requestId: String(res.locals.requestId || ""),
        occurredAt: new Date(respondedAt).toISOString(),
        source,
      }, responseTimeMs: respondedAt - requestStartedAt, requestedAt: requestStartedAt, respondedAt });
    }
    return res.status(500).json({ error: errorMessage, code: "AI_CHAT_FAILED" });
  }
});

router.delete("/chat-conversations/:sessionId", (req: AuthRequest, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  if (!sessionId || sessionId.length > 120) {
    return res.status(400).json({ error: "会话参数无效" });
  }
  const deleted = db.transaction(() => {
    db.prepare(`
      DELETE FROM agent_run_media
      WHERE user_id = ? AND run_id IN (
        SELECT id FROM agent_runs WHERE user_id = ? AND session_id = ?
      )
    `).run(req.userId!, req.userId!, sessionId);
    const changes = db.prepare("DELETE FROM ai_chat_messages WHERE user_id = ? AND session_id = ?")
      .run(req.userId!, sessionId).changes;
    db.prepare(`
      INSERT INTO ai_chat_session_deletions (user_id, session_id, deleted_at)
      VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
      ON CONFLICT(user_id, session_id) DO UPDATE SET deleted_at = excluded.deleted_at
    `).run(req.userId!, sessionId);
    return changes;
  })();
  return res.json({ success: true, deleted });
});

// 用户确认后的唯一写入入口。模型不能直接提交，确认记录与幂等键均按当前用户校验。
router.post("/write-confirmations/:confirmationId/commit", validateBody(aiWriteConfirmationCommitSchema), async (req: AuthRequest, res) => {
  try {
    const result = await aiWriteConfirmationsService().commit({
      userId: req.userId!,
      confirmationId: String(req.params.confirmationId),
      idempotencyKey: req.body.idempotencyKey,
    });
    return res.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "确认操作失败";
    const status = /不存在|无权/.test(message) ? 404 : /过期|失效/.test(message) ? 409 : 400;
    return res.status(status).json({ error: message });
  }
});

/**
 * 首页时段推荐：模型读取用户库存、当天饮食及热量目标，返回可直接渲染的多张卡片。
 */
router.post("/home-recommendations", validateBody(aiHomeRecommendationsSchema), async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const period = typeof req.body?.period === "string" ? req.body.period.slice(0, 40) : "当前时段";
  try {
    const mealType = /早餐|早/.test(period) ? "breakfast" : /午餐|午/.test(period) ? "lunch" : /晚餐|晚/.test(period) ? "dinner" : "snack";
    const recommendations = await recommendationsService().page(userId, {
      surface: "home", matchStatus: "all", mealType, pageSize: 12,
    });
    const cards = recommendations.items.slice(0, 5).map((item) => {
      const recipe = item.recipe as Record<string, unknown>;
      const reasons = item.reasons as string[];
      return {
        recipeId: item.recipeId,
        title: String(recipe.title || "推荐菜谱"),
        tag: reasons[0]?.includes("临期") ? "临期优先" : "食语推荐",
        desc: reasons.slice(0, 2).join("；"),
        calories: Number(recipe.calories || 0),
        prompt: `请介绍平台菜谱 #${item.recipeId}「${String(recipe.title || "") }」的做法`,
      };
    });
    return res.json({ cards, recommendations });
  } catch (error: any) {
    console.error("[Home Recommendations Error]", error);
    return res.status(500).json({ error: "首页推荐生成失败", code: "HOME_RECOMMENDATIONS_FAILED" });
  }
});

/**
 * 2. 拍照识别菜品与热量评估
 */
router.post("/vision-food", validateBody(aiVisionSchema), async (req: AuthRequest, res) => {
  try {
    const { image, userPrompt } = req.body;
    if (!image) {
      return res.status(400).json({ error: "缺少图片数据 (Base64 或 URL)" });
    }

    const response = await startSupervisorRun(req.userId!, { modality: "image", source: "vision-food", image, prompt: userPrompt || "识别餐食、分量与估算营养" });
    const vision = response.artifacts?.find((artifact) => artifact.type === "vision")?.data;
    return res.status(response.run.status === "queued" || response.run.status === "running" ? 202 : 200).json({ ...response, success: response.run.status === "completed", data: vision, rawText: vision ? undefined : response.reply });
  } catch (error: any) {
    console.error("[AI Vision Error]", error);
    return res.status(500).json({ error: "识别图片失败" });
  }
});

/**
 * 3. 创建可恢复的食材图片识别任务。
 * 上传成功后立刻返回任务 ID；后续识别在服务端继续，即使客户端关闭也不会丢失。
 */
router.post("/inventory-scan-jobs", validateBody(aiImageSchema), async (req: AuthRequest, res) => {
  const { image } = req.body;
  if (typeof image !== "string" || !image.trim()) {
    return res.status(400).json({ error: "缺少图片数据" });
  }
  if (image.length > 7_500_000) {
    return res.status(413).json({ error: "图片过大，请裁剪到只保留订单或商品区域后重试" });
  }

  try {
    const response = await startSupervisorRun(req.userId!, { modality: "inventory_scan", source: "inventory", image, prompt: "识别所有可加入家庭库存的食品条目、数量、保存位置与保守保质期" }, 0);
    return res.status(202).json({ mode: "agent", run: response.run, jobId: response.run.id, status: "queued", deduplicated: false });
  } catch (error) {
    console.error("[Agent Inventory Scan Start Error]", error);
    return res.status(500).json({ error: "创建识别任务失败", code: "INVENTORY_AGENT_START_FAILED" });
  }
});

/** Get a durable recognition job. */
router.get("/inventory-scan-jobs/:jobId", (req: AuthRequest, res) => {
  const agentRow = getAgentRunRow(String(req.params.jobId), req.userId!);
  if (agentRow) {
    const run = toAgentRunSummary(agentRow);
    const vision = run.artifacts.find((artifact) => artifact.type === "vision")?.data as { items?: unknown } | undefined;
    const items = normalizeInventoryScanItems(vision?.items);
    const confidence = Number((vision as { confidence?: unknown } | undefined)?.confidence);
    const lowConfidence = !Number.isFinite(confidence) || confidence < 0.65;
    const status = run.status === "completed" ? "completed" : run.status === "failed" || run.status === "cancelled" || run.status === "expired" ? "failed" : "processing";
    return res.json({ mode: "agent", run, jobId: run.id, status, items, confidence: Number.isFinite(confidence) ? confidence : null, lowConfidence, error: run.error?.message, createdAt: run.createdAt, updatedAt: run.updatedAt });
  }
  const job = db.prepare(`
    SELECT id, status, result_json, error_message, created_at, updated_at
    FROM inventory_scan_jobs WHERE id = ? AND user_id = ?
  `).get(req.params.jobId, req.userId!) as { id: string; status: string; result_json: string | null; error_message: string | null; created_at: string; updated_at: string } | undefined;
  if (!job) return res.status(404).json({ error: "识别任务不存在或无权访问" });
  return res.json({
    jobId: job.id,
    status: job.status,
    items: job.result_json ? JSON.parse(job.result_json) : undefined,
    error: job.error_message || undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  });
});

/**
 * 4. 兼容旧客户端的同步扫描接口。
 */
router.post("/scan-receipt", validateBody(aiImageSchema), async (req: AuthRequest, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "缺少图片数据" });
    }

    const response = await startSupervisorRun(req.userId!, { modality: "receipt", source: "scan-receipt", image, prompt: "识别小票中的食品、规格、数量和价格，并给出可加入采购或库存的结构化结果" });
    const vision = response.artifacts?.find((artifact) => artifact.type === "vision")?.data as { items?: unknown } | undefined;
    return res.status(response.run.status === "queued" || response.run.status === "running" ? 202 : 200).json({ ...response, success: response.run.status === "completed", items: normalizeInventoryScanItems(vision?.items), rawText: vision ? undefined : response.reply });
  } catch (error: any) {
    console.error("[AI Scan Error]", error);
    return res.status(500).json({ error: "识别小票/食材失败" });
  }
});

/**
 * 4. 做饭模式语音指令与疑问识别 (Voice Command Router)
 * 整合平台统一 AI Prompt 系统与菜品全量步骤食材上下文
 */
router.post("/voice-command", validateBody(aiVoiceCommandSchema), async (req: AuthRequest, res) => {
  const requestStartedAt = Date.now();
  const userId = req.userId!;
  const sessionId = String(req.body.sessionId);
  const text = String(req.body.speechText || "").trim();
  try {
    const { currentStep = 0, recipeTitle = "", recipeSteps, recipeIngredients, voiceHistory } = req.body;

    // UI 控制仍由确定性解析器判定，但请求也必须创建 Agent Run，
    // 以便语音能力具备统一审计、限流和 Supervisor 安全检查。
    const controlAction = text.includes("下一步") || text.includes("继续")
      ? "NEXT_STEP"
      : text.includes("上一步") || text.includes("返回上一步")
        ? "PREV_STEP"
        : text.includes("重置") || text.includes("暂停")
          ? "TOGGLE_TIMER"
          : undefined;

    const currentStepText = Array.isArray(recipeSteps) && recipeSteps[currentStep]
      ? recipeSteps[currentStep]
      : "按提示操作";
    const ingredientsText = Array.isArray(recipeIngredients) && recipeIngredients.length > 0
      ? recipeIngredients.join("；")
      : "未提供";
    const runtimeContext = `当前菜品：${recipeTitle || "当前菜品"}；当前步骤：${currentStepText}；食材：${ingredientsText}。回答限 60 字以内。`;
    const recentVoiceMessages = Array.isArray(voiceHistory)
      ? voiceHistory.slice(-3).flatMap((turn: { question: string; answer: string }) => [
        { role: "user" as const, content: turn.question },
        { role: "assistant" as const, content: turn.answer },
      ])
      : [];
    if (controlAction) {
      const response = await startSupervisorRun(userId, {
        modality: "cooking", source: "cooking_voice_control", sessionId,
        prompt: `用户发出烹饪界面控制指令：${text}。确认它不改变业务数据，并给出一句极简安全提示。`,
        metadata: { controlAction, currentStep, recipeTitle, recipeSteps, recipeIngredients },
      }, 0);
      return res.status(202).json({ ...response, type: "CONTROL", action: controlAction, responseTimeMs: Date.now() - requestStartedAt });
    }
    const response = await startSupervisorRun(userId, {
      modality: "cooking", source: "cooking_voice", sessionId,
      prompt: `${text}\n${runtimeContext}`,
      messages: [...recentVoiceMessages, { role: "user", content: text }],
      metadata: { currentStep, recipeTitle, recipeSteps, recipeIngredients },
    });
    const respondedAt = Date.now();
    if (response.reply) recordChatTurn({
      userId, sessionId, source: "cooking_voice", userContent: text,
      assistantContent: response.reply, systemContents: [runtimeContext], payload: { agentRunId: response.run.id, artifacts: response.artifacts },
      responseTimeMs: respondedAt - requestStartedAt, requestedAt: requestStartedAt, respondedAt,
    });
    return res.status(response.run.status === "queued" || response.run.status === "running" ? 202 : 200).json({ ...response, type: "QUESTION", answerText: response.reply, responseTimeMs: respondedAt - requestStartedAt });
  } catch (error: any) {
    console.error("[AI Voice Command Error]", error);
    const errorMessage = "处理语音指令失败，请稍后重试";
    if (text) {
      const respondedAt = Date.now();
      recordChatTurn({
        userId, sessionId, source: "cooking_voice", userContent: text,
        assistantContent: errorMessage, status: "failed", payload: { errorCode: "VOICE_COMMAND_FAILED" },
        responseTimeMs: respondedAt - requestStartedAt, requestedAt: requestStartedAt, respondedAt,
      });
    }
    return res.status(500).json({ error: errorMessage, code: "VOICE_COMMAND_FAILED" });
  }
});

/**
 * 4. 语音识别转文本 (ASR Transcribe) 接口
 */
router.post("/transcribe", validateBody(aiTranscribeSchema), async (req: AuthRequest, res) => {
  try {
    const { audioBase64, mimeType } = req.body || {};
    const response = await startSupervisorRun(req.userId!, { modality: "audio", source: "transcribe", audioBase64, mimeType, prompt: "准确转录这段语音，并理解其中的饮食任务；不要执行未明确要求的业务操作" });
    return res.status(response.run.status === "queued" || response.run.status === "running" ? 202 : 200).json({ ...response, text: response.transcript || "" });
  } catch (error: any) {
    console.error("[AI Transcribe Error]", error);
    return res.status(500).json({ error: "语音识别失败" });
  }
});

export default router;
