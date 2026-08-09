import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { db } from "../storage/db.js";
import { chatCompletion, analyzeImage, transcribeAudio, type ChatMessage, type SolutionCard } from "../services/aiService.js";
import { buildAIPromptMessages, buildUserContext, type UserContext } from "../services/contextBuilder.js";
import { aiToolsSchema } from "../services/aiTools.js";
import { commitAIWritePreview } from "../services/aiWriteConfirmations.js";
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
import { currentDateKey } from "../utils/date.js";

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

const buildFallbackHomeRecommendations = (ctx: UserContext, period: string): HomeRecommendation[] => {
  const ingredientNames = [...new Set(ctx.inventory.map((item) => item.food_name.trim()).filter(Boolean))].slice(0, 5);
  if (ingredientNames.length > 0) {
    return ingredientNames.map((name, index) => ({
      title: `${name}食用建议`,
      tag: ["优先消耗", "库存搭配", "轻松料理", "营养补给", "下餐灵感"][index] || "库存搭配",
      desc: `优先利用库存中的${name}，减少闲置。`,
      calories: [180, 240, 320, 260, 220][index] || 220,
      prompt: `我想优先使用库存中的【${name}】安排${period}的一餐。请结合我的饮食目标和现有厨具，给出简单做法。`,
    }));
  }

  return [
    { title: "补充饮水", tag: "日常提醒", desc: "先喝一杯温水，再安排下一餐。", calories: 0, prompt: "请提醒我今天如何科学补水。" },
    { title: "查看库存", tag: "备餐准备", desc: "先补充常用食材，方便规划下一餐。", calories: 1, prompt: "请告诉我适合日常备餐的基础食材清单。" },
    { title: "记录一餐", tag: "饮食管理", desc: "记录已吃食物，推荐会更贴合。", calories: 1, prompt: "我想记录刚吃的一餐，请告诉我需要提供哪些信息。" },
    { title: "规划下一餐", tag: "均衡饮食", desc: "按饥饿感和今日摄入安排食物。", calories: 1, prompt: "请帮我规划下一餐，并先询问我的可用食材。" },
    { title: "添加食材", tag: "库存完善", desc: "录入食材后可获得个性化推荐。", calories: 1, prompt: "请推荐适合家庭常备的健康食材。" },
  ];
};

const INVENTORY_SCAN_PROMPT = `请识别图片中所有清晰可见、适合加入家庭食材库存的食品条目。图片可能是超市购物清单、订单截图、小票、多个商品摆在一起的照片，不能只返回第一项。

规则：
1. 每种不同商品/食材各返回一项；相同商品重复出现时合并数量。订单截图中应逐行识别商品名称与包装规格（如 300g、400g、500毫升）。
2. 仅返回食品、调味品和饮料；不要返回价格、优惠、运费、店铺名、售后信息或非食品。
3. 看不清的项目不要猜测；最多返回 30 项。数量优先保留图片中的规格或件数，无法确定时写“1份”。
4. suggestedStorageLocation 只能是“冷藏”“冷冻”或“常温”；estimatedExpireDays 是未开封状态下的保守估计，范围 1 到 365。
5. 只返回严格 JSON，不要使用 Markdown 或补充说明。格式如下：
{
  "items": [
    { "foodName": "牛油果", "quantity": "2个", "suggestedStorageLocation": "冷藏", "estimatedExpireDays": 5 },
    { "foodName": "鲜牛奶", "quantity": "1盒", "suggestedStorageLocation": "冷藏", "estimatedExpireDays": 7 }
  ]
}`;

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

const processInventoryScanJob = async (jobId: string, userId: number, image: string) => {
  db.prepare("UPDATE inventory_scan_jobs SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);
  try {
    const rawResponse = await analyzeImage(image, INVENTORY_SCAN_PROMPT, {
      jsonMode: true,
      userId,
      endpoint: "scan-receipt",
    });
    const parsed = JSON.parse(rawResponse);
    const items = normalizeInventoryScanItems(parsed.items);
    db.prepare("UPDATE inventory_scan_jobs SET status = 'completed', result_json = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(JSON.stringify(items), jobId);
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : "识别图片失败";
    const publicMessage = "识别图片失败，请稍后重试";
    console.error("[AI Inventory Scan Job Error]", { jobId, message: internalMessage });
    db.prepare("UPDATE inventory_scan_jobs SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(publicMessage, jobId);
  }
};

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

const recordChatTurn = ({
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
  });
  try { save(); } catch (error) { console.error("[AI Chat Audit Error]", error); }
};

const getRecordedChatHistory = (userId: number, sessionId: string): ChatMessage[] => {
  const rows = db.prepare(`
    SELECT role, content, payload_json AS payloadJson FROM ai_chat_messages
    WHERE user_id = ? AND session_id = ? AND role IN ('user', 'assistant')
      AND status = 'completed'
    ORDER BY created_at DESC, id DESC
    LIMIT 48
  `).all(userId, sessionId) as Array<{ role: "user" | "assistant"; content: string; payloadJson: string | null }>;
  return rows.reverse().map((row) => ({
    role: row.role,
    content: row.role === "assistant" ? serializePayloadForModel(row.content, row.payloadJson) : row.content,
  }));
};

const serializePayloadForModel = (content: string, payloadJson: string | null) => {
  if (!payloadJson) return content;
  let payload: Record<string, any> = {};
  try { payload = JSON.parse(payloadJson); } catch { return content; }
  const cards: string[] = [];
  if (payload.actionCard) cards.push(`饮食打卡卡片：${payload.actionCard.mealType} ${payload.actionCard.foodName}（${payload.actionCard.amount}）`);
  if (payload.missingCard) cards.push(`缺料采购卡片：${payload.missingCard.dishName}；缺少 ${(payload.missingCard.missingIngredients || []).map((item: any) => `${item.name} ${item.amount}`).join("、")}`);
  if (payload.optionsCard) cards.push(`选项卡片：${payload.optionsCard.title}；${(payload.optionsCard.options || []).map((item: any) => `${item.label}=${item.actionText}`).join("；")}`);
  if (payload.solutionCards?.length) cards.push(`方案卡片：${payload.solutionCards.map((card: any) => `${card.schemeTag}：${card.title}；食材：${card.ingredients}；做法提示：${card.cookingTip}；营养：${card.macros}`).join("\n")}`);
  if (payload.legacyCardSummaries?.length) cards.push(...payload.legacyCardSummaries);
  return [content, ...cards].filter(Boolean).join("\n\n【结构化卡片上下文】\n");
};

const buildAssistantPayload = (
  result: Awaited<ReturnType<typeof chatCompletion>>,
  solutionSource: "local" | "ai" = "ai",
) => ({
  ...(result.actionCard ? { actionCard: result.actionCard } : {}),
  ...(result.missingCard ? { missingCard: result.missingCard } : {}),
  ...(result.optionsCard ? { optionsCard: result.optionsCard } : {}),
  ...(result.solutionCards?.length
    ? { solutionCards: result.solutionCards.map((card) => ({ ...card, source: solutionSource })) }
    : {}),
  ...(result.writeConfirmation ? { writeConfirmation: result.writeConfirmation } : {}),
});

const parseJsonArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

const normalizeIngredientName = (value: string) => value.replace(/[\s\d.]+(?:g|kg|ml|个|份|两)?/gi, "").replace(/[（(].*?[）)]/g, "").trim();

const isMealRecommendationRequest = (value: string) => /(吃什么|吃啥|推荐.*(?:餐|菜|吃)|(?:早|午|晚)餐.*(?:推荐|吃)|配餐|搭配.*(?:餐|菜))/.test(value);

const hasPersonalizedSafetyConstraints = (ctx: UserContext) => {
  const profile = ctx.healthProfile;
  if (!profile) return false;
  return Boolean(
    profile.allergies.length
    || profile.dietary_restrictions.length
    || profile.medical_conditions.length
    || profile.medications?.trim()
    || profile.medical_notes?.trim()
    || profile.disliked_foods?.trim()
    || profile.dietary_preference?.trim(),
  );
};

const recipeFitsAvailableCookware = (steps: string[], ctx: UserContext) => {
  if (!ctx.kitchenware.length) return false;
  const instructions = steps.join(" ");
  const available = ctx.kitchenware.map((item) => item.name.replace(/\s/g, ""));
  const requirements = [
    { pattern: /烤箱|烘烤/, aliases: ["烤箱"] },
    { pattern: /空气炸|气炸/, aliases: ["空气炸锅", "气炸锅"] },
    { pattern: /微波/, aliases: ["微波炉"] },
    { pattern: /破壁|料理机|搅拌机/, aliases: ["破壁机", "料理机", "搅拌机"] },
    { pattern: /电饭|饭煲/, aliases: ["电饭煲", "电饭锅"] },
    { pattern: /高压|压力锅/, aliases: ["高压锅", "压力锅"] },
    { pattern: /蒸制|上锅蒸|蒸锅|蒸箱/, aliases: ["蒸锅", "蒸箱", "锅"] },
    { pattern: /煎|炒|焖|炖|煮沸|热锅/, aliases: ["锅", "灶", "电磁炉"] },
  ];
  return requirements.every(({ pattern, aliases }) =>
    !pattern.test(instructions) || available.some((name) => aliases.some((alias) => name.includes(alias))),
  );
};

const findLocalRecipeRecommendations = (ctx: UserContext): SolutionCard[] => {
  // Recipes do not carry enough structured metadata to safely evaluate health
  // constraints. Let the model apply the full safety prompt whenever such a
  // constraint exists instead of taking the local fast path.
  if (hasPersonalizedSafetyConstraints(ctx)) return [];
  const today = currentDateKey();
  const inventory = ctx.inventory
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.expiration_date) && item.expiration_date >= today)
    .map((item) => normalizeIngredientName(item.food_name))
    .filter(Boolean);
  if (!inventory.length || !ctx.kitchenware.length) return [];
  const rows = db.prepare(`
    SELECT title, description, cook_time, calories, protein, carbs, fat, steps_json, ingredients_json
    FROM recipes WHERE status = 'approved' AND deleted_at IS NULL
    ORDER BY updated_at DESC LIMIT 120
  `).all() as Array<Record<string, unknown>>;

  return rows.map((recipe) => {
    const ingredientItems = parseJsonArray(recipe.ingredients_json)
      .map((item) => typeof item === "string" ? { name: item, amount: "适量" } : item as { name?: unknown; amount?: unknown })
      .map((item) => ({ name: String(item.name || "").trim(), amount: String(item.amount || "适量").trim() }))
      .filter((item) => item.name);
    const matched = ingredientItems.filter((item) => {
      const name = normalizeIngredientName(item.name);
      return name.length > 1 && inventory.some((stock) => stock.includes(name) || name.includes(stock));
    });
    const steps = parseJsonArray(recipe.steps_json).map((step) => String(step).trim()).filter(Boolean);
    return { recipe, ingredientItems, matched, steps, score: matched.length / Math.max(ingredientItems.length, 1) };
  }).filter((item) => item.matched.length > 0 && item.steps.length > 0 && recipeFitsAvailableCookware(item.steps, ctx))
    .sort((a, b) => b.score - a.score || b.matched.length - a.matched.length)
    .slice(0, 3)
    .map((item, index) => {
      const recipe = item.recipe;
      return {
        id: `local_recipe_${String(recipe.title)}_${index}`,
        schemeTag: `本地方案 ${String.fromCharCode(65 + index)}`,
        title: String(recipe.title || "本地菜谱"),
        ingredients: item.ingredientItems.map((ingredient) => `${ingredient.name} ${ingredient.amount}`).join(" + "),
        ingredientItems: item.ingredientItems,
        cookingTip: String(recipe.description || "按菜谱步骤烹饪，注意火候与食材熟度。"),
        steps: item.steps,
        macros: `约 ${Number(recipe.calories) || 0} kcal · 蛋白质 ${Number(recipe.protein) || 0}g · 碳水 ${Number(recipe.carbs) || 0}g · 脂肪 ${Number(recipe.fat) || 0}g`,
        actionText: "",
        source: "local" as const,
      };
    });
};

const CHAT_SOURCE_PROMPTS = {
  voice: "当前为实时语音对话。回答应精炼、亲切并适合语音播报；若返回结构化方案卡片，只用一句话概括并引导用户查看卡片。",
  cooking: "当前为烹饪过程中的问答。结合用户提供的当前菜品和步骤，给出实用、简短且符合食品安全要求的建议。",
} as const;

/**
 * 1. AI 对话 / 营养大厨答疑 (含 Function Calling 自动写库)
 */
router.post("/chat", validateBody(aiChatSchema), async (req: AuthRequest, res) => {
  const requestStartedAt = Date.now();
  const { messages = [], prompt, sessionId: requestedSessionId, source = "assistant" } = req.body;
  const userId = req.userId!;
  const sessionId = typeof requestedSessionId === "string" && requestedSessionId.trim()
    ? requestedSessionId.trim().slice(0, 120)
    : randomUUID();
  const clientMessages = Array.isArray(messages)
    ? messages.filter((msg: any): msg is ChatMessage => Boolean(msg?.role && msg?.content))
    : [];
  const sourceSystemContent = source === "voice"
    ? CHAT_SOURCE_PROMPTS.voice
    : source === "cooking" ? CHAT_SOURCE_PROMPTS.cooking : undefined;
  const requestedContent = [...clientMessages].reverse().find((message) => message.role === "user")?.content ?? prompt;
  const requestedText = typeof requestedContent === "string" ? requestedContent : "";

  const recordFailure = (message: string, code: string) => {
    if (!requestedText) return;
    const respondedAt = Date.now();
    recordChatTurn({
      userId,
      sessionId,
      source,
      userContent: requestedText,
      assistantContent: message,
      systemContents: sourceSystemContent ? [sourceSystemContent] : [],
      status: "failed",
      payload: { errorCode: code },
      responseTimeMs: respondedAt - requestStartedAt,
      requestedAt: requestStartedAt,
      respondedAt,
    });
  };

  try {
    // 构建用户数据库 Context
    const userCtx = buildUserContext(userId);
    const fullMessages: ChatMessage[] = buildAIPromptMessages(userCtx);
    if (sourceSystemContent) fullMessages.push({ role: "system", content: sourceSystemContent });
    const recordedHistory = getRecordedChatHistory(userId, sessionId);

    if (clientMessages.length > 1) {
      clientMessages.forEach((msg) => {
        if (msg.role && msg.content) {
          fullMessages.push({ role: msg.role, content: msg.content });
        }
      });
    } else if (recordedHistory.length > 0 && clientMessages.length === 1) {
      fullMessages.push(...recordedHistory, clientMessages[0]);
    } else if (clientMessages.length === 1) {
      fullMessages.push(clientMessages[0]);
    } else if (prompt) {
      fullMessages.push({ role: "user", content: prompt });
    } else {
      return res.status(400).json({ error: "必须提供 prompt 或 messages" });
    }

    const latestRequestedContent = [...fullMessages].reverse().find((message) => message.role === "user")?.content;
    const latestRequestedText = typeof latestRequestedContent === "string" ? latestRequestedContent : "";
    if (isMealRecommendationRequest(latestRequestedText)) {
      const localCards = findLocalRecipeRecommendations(userCtx);
      if (localCards.length) {
        const reply = "我优先从本地菜谱中找到了与当前库存匹配的做法：";
        const respondedAt = Date.now();
        const responseTimeMs = respondedAt - requestStartedAt;
        const payload = { solutionCards: localCards };
        recordChatTurn({
          userId,
          sessionId,
          source,
          userContent: latestRequestedText,
          assistantContent: reply,
          systemContents: sourceSystemContent ? [sourceSystemContent] : [],
          payload,
          responseTimeMs,
          requestedAt: requestStartedAt,
          respondedAt,
        });
        return res.json({ reply, sessionId, solutionCards: localCards, responseTimeMs });
      }
    }

    const result = await chatCompletion(fullMessages, {
      temperature: 0.7,
      tools: aiToolsSchema,
      userId,
      endpoint: "chat",
    });
    // Chat fallback text must never masquerade as a successful AI response.
    if (result.fallback) {
      const isNotConfigured = result.fallbackReason === "AI_NOT_CONFIGURED";
      const errorMessage = isNotConfigured
        ? "AI 对话尚未配置，请在管理端完成聊天模型配置后重试"
        : "AI 对话服务暂时不可用，请稍后重试";
      recordFailure(errorMessage, result.fallbackReason || "AI_REQUEST_FAILED");
      return res.status(503).json({
        error: errorMessage,
        code: result.fallbackReason,
      });
    }
    const latestUserMessage = [...fullMessages].reverse().find((message) => message.role === "user");
    const userContent = typeof latestUserMessage?.content === "string" ? latestUserMessage.content : "";
    const respondedAt = Date.now();
    const responseTimeMs = respondedAt - requestStartedAt;
    const payload = buildAssistantPayload(result);
    recordChatTurn({
      userId,
      sessionId,
      source,
      userContent,
      assistantContent: result.reply,
      systemContents: sourceSystemContent ? [sourceSystemContent] : [],
      payload,
      confirmationId: result.writeConfirmation?.confirmationId,
      responseTimeMs,
      requestedAt: requestStartedAt,
      respondedAt,
    });
    return res.json({
      reply: result.reply,
      sessionId,
      responseTimeMs,
      actionCard: result.actionCard,
      missingCard: result.missingCard,
      optionsCard: result.optionsCard,
      solutionCards: payload.solutionCards,
      writeConfirmation: result.writeConfirmation,
      contextSummary: {
        inventoryCount: userCtx.inventory.length,
        kitchenwareCount: userCtx.kitchenware.length,
      },
    });
  } catch (error: any) {
    console.error("[AI Router Chat Error]", error);
    const errorMessage = "AI 对话请求失败，请稍后重试";
    recordFailure(errorMessage, "AI_CHAT_FAILED");
    return res.status(500).json({ error: errorMessage, code: "AI_CHAT_FAILED" });
  }
});

router.delete("/chat-conversations/:sessionId", (req: AuthRequest, res) => {
  const sessionId = String(req.params.sessionId || "").trim();
  if (!sessionId || sessionId.length > 120) {
    return res.status(400).json({ error: "会话参数无效" });
  }
  const deleted = db.prepare("DELETE FROM ai_chat_messages WHERE user_id = ? AND session_id = ?")
    .run(req.userId!, sessionId).changes;
  return res.json({ success: true, deleted });
});

// 用户确认后的唯一写入入口。模型不能直接提交，确认记录与幂等键均按当前用户校验。
router.post("/write-confirmations/:confirmationId/commit", validateBody(aiWriteConfirmationCommitSchema), (req: AuthRequest, res) => {
  try {
    const result = commitAIWritePreview({
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
  const userCtx = buildUserContext(userId);
  try {
    const prompt = `现在是${period}。请结合系统提供的用户库存、今日饮食记录、每日热量目标和临期食材，为首页生成 5 条简短、可执行的个性化饮食推荐。

优先使用库存食材；若库存不适合，可给出容易获得的替代品。注意用户今天已经摄入的热量，不要推荐不合时宜的高热量餐食。
5 条内容必须明显不同，尽量覆盖饮品、加餐、轻食、正餐或食材消耗方案，避免同一种食物或同一种做法重复。只返回严格 JSON，不要 Markdown：
{
  "cards": [
    {
      "title": "食物或组合名称（不超过 14 个中文字符）",
      "tag": "短标签（不超过 6 个中文字符）",
      "desc": "一句推荐理由（不超过 24 个中文字符）",
      "calories": 160,
      "prompt": "用户点击后交给 AI 助手继续生成详细做法的提问"
    }
  ]
}`;
    const result = await chatCompletion([
      ...buildAIPromptMessages(userCtx),
      { role: "user", content: prompt },
    ], {
      temperature: 0.45,
      max_tokens: 450,
      jsonMode: true,
      userId,
      endpoint: "home-recommendations",
    });
    const cards = parseHomeRecommendations(result.reply);
    if (cards.length > 0) return res.json({ cards });
    console.warn("[AI Home Recommendations] Invalid AI payload; using inventory fallback");
    return res.json({ cards: buildFallbackHomeRecommendations(userCtx, period), fallback: true });
  } catch (error: any) {
    console.error("[AI Home Recommendations Error]", error);
    return res.json({ cards: buildFallbackHomeRecommendations(userCtx, period), fallback: true });
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

    const prompt = `请分析这张餐食照片，识别其中的食物种类。${userPrompt ? `用户附带提问：“${userPrompt}”，请在回答中专门回答该提问。` : ""}以 JSON 格式返回结果，格式要求如下：
{
  "foodName": "菜品/食材名称",
  "estimatedWeightGrams": 200,
  "calories": 350,
  "proteinGrams": 25,
  "carbsGrams": 30,
  "fatGrams": 12,
  "description": "针对照片与用户疑问的解答评价"
}`;

    const rawResponse = await analyzeImage(image, prompt, {
      jsonMode: true,
      userId: req.userId,
      endpoint: "vision-food",
    });
    
    // 尝试解析 JSON
    try {
      const parsed = JSON.parse(rawResponse);
      return res.json({ success: true, data: parsed });
    } catch {
      return res.json({ success: true, rawText: rawResponse });
    }
  } catch (error: any) {
    console.error("[AI Vision Error]", error);
    return res.status(500).json({ error: "识别图片失败" });
  }
});

/**
 * 3. 创建可恢复的食材图片识别任务。
 * 上传成功后立刻返回任务 ID；后续识别在服务端继续，即使客户端关闭也不会丢失。
 */
router.post("/inventory-scan-jobs", validateBody(aiImageSchema), (req: AuthRequest, res) => {
  const { image } = req.body;
  if (typeof image !== "string" || !image.trim()) {
    return res.status(400).json({ error: "缺少图片数据" });
  }
  if (image.length > 7_500_000) {
    return res.status(413).json({ error: "图片过大，请裁剪到只保留订单或商品区域后重试" });
  }

  const userId = req.userId!;
  const imageHash = createHash("sha256").update(image).digest("hex");
  const existing = db.prepare(`
    SELECT id, status, result_json, error_message
    FROM inventory_scan_jobs
    WHERE user_id = ? AND image_hash = ?
      AND created_at >= datetime('now', '-10 minutes')
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, imageHash) as { id: string; status: string; result_json: string | null; error_message: string | null } | undefined;

  if (existing) {
    if (existing.status === "failed") {
      db.prepare("UPDATE inventory_scan_jobs SET status = 'queued', error_message = NULL, result_json = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
        .run(existing.id, userId);
      void processInventoryScanJob(existing.id, userId, image);
      return res.status(202).json({
        jobId: existing.id,
        status: "queued",
        deduplicated: true,
        retried: true,
      });
    }
    return res.status(existing.status === "completed" ? 200 : 202).json({
      jobId: existing.id,
      status: existing.status,
      items: existing.result_json ? JSON.parse(existing.result_json) : undefined,
      error: existing.error_message || undefined,
      deduplicated: true,
    });
  }

  const jobId = randomUUID();
  db.prepare("INSERT INTO inventory_scan_jobs (id, user_id, image_hash, status) VALUES (?, ?, ?, 'queued')")
    .run(jobId, userId, imageHash);
  void processInventoryScanJob(jobId, userId, image);
  return res.status(202).json({ jobId, status: "queued", deduplicated: false });
});

/** Get a durable recognition job. */
router.get("/inventory-scan-jobs/:jobId", (req: AuthRequest, res) => {
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

    const rawResponse = await analyzeImage(image, INVENTORY_SCAN_PROMPT, {
      jsonMode: true,
      userId: req.userId,
      endpoint: "scan-receipt",
    });

    try {
      const parsed = JSON.parse(rawResponse);
      return res.json({ success: true, items: normalizeInventoryScanItems(parsed.items) });
    } catch {
      return res.json({ success: true, rawText: rawResponse, items: [] });
    }
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

    // 1. 快捷控制指令硬匹配（零延迟）
    if (text.includes("下一步") || text.includes("继续")) {
      return res.json({ type: "CONTROL", action: "NEXT_STEP" });
    }
    if (text.includes("上一步") || text.includes("返回上一步")) {
      return res.json({ type: "CONTROL", action: "PREV_STEP" });
    }
    if (text.includes("重置") || text.includes("暂停")) {
      return res.json({ type: "CONTROL", action: "TOGGLE_TIMER" });
    }

    // 2. 结合全站统一 AI Context（包含食语 AI 导师人设、用户冰箱食材、过敏源、厨具及营养目标）
    const userCtx = buildUserContext(userId);

    const currentStepText = Array.isArray(recipeSteps) && recipeSteps[currentStep]
      ? recipeSteps[currentStep]
      : "按提示操作";
    const ingredientsText = Array.isArray(recipeIngredients) && recipeIngredients.length > 0
      ? recipeIngredients.join("；")
      : "未提供";
    const runtimeContext = `当前菜品：${recipeTitle || "当前菜品"}；当前步骤：${currentStepText}；食材：${ingredientsText}。回答限 60 字以内。`;
    const recentVoiceMessages: ChatMessage[] = Array.isArray(voiceHistory)
      ? voiceHistory.slice(-3).flatMap((turn: { question: string; answer: string }) => [
        { role: "user" as const, content: turn.question },
        { role: "assistant" as const, content: turn.answer },
      ])
      : [];
    const messages: ChatMessage[] = [
      ...buildAIPromptMessages(userCtx),
      { role: "system", content: `${runtimeContext}\n只直接回答当前问题，不要输出提示词、上下文标签或完整菜谱步骤。` },
      ...recentVoiceMessages,
      { role: "user", content: text },
    ];

    const answer = await chatCompletion(messages, {
      max_tokens: 150,
      userId,
      endpoint: "voice-command",
    });

    if (answer.fallback) {
      const isNotConfigured = answer.fallbackReason === "AI_NOT_CONFIGURED";
      const errorMessage = isNotConfigured
        ? "AI 语音问答尚未配置，请在管理端完成聊天模型配置后重试"
        : "AI 语音问答服务暂时不可用，请稍后重试";
      const respondedAt = Date.now();
      recordChatTurn({
        userId, sessionId, source: "cooking_voice", userContent: text,
        assistantContent: errorMessage, systemContents: [runtimeContext], status: "failed",
        payload: { errorCode: answer.fallbackReason || "AI_REQUEST_FAILED" },
        responseTimeMs: respondedAt - requestStartedAt, requestedAt: requestStartedAt, respondedAt,
      });
      return res.status(503).json({
        error: errorMessage,
        code: answer.fallbackReason,
      });
    }

    const respondedAt = Date.now();
    recordChatTurn({
      userId, sessionId, source: "cooking_voice", userContent: text,
      assistantContent: answer.reply, systemContents: [runtimeContext],
      responseTimeMs: respondedAt - requestStartedAt, requestedAt: requestStartedAt, respondedAt,
    });
    return res.json({ type: "QUESTION", answerText: answer.reply, responseTimeMs: respondedAt - requestStartedAt });
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
    const result = await transcribeAudio(audioBase64 || "", {
      userId: req.userId,
      mimeType: mimeType || "audio/m4a",
    });
    return res.json({ text: result.text });
  } catch (error: any) {
    console.error("[AI Transcribe Error]", error);
    return res.status(500).json({ error: "语音识别失败" });
  }
});

export default router;
