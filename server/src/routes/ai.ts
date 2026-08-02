import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { authMiddleware, optionalAuthMiddleware, type AuthRequest } from "../middleware/auth.js";
import { db } from "../storage/db.js";
import { chatCompletion, analyzeImage, transcribeAudio, type ChatMessage } from "../services/aiService.js";
import { buildUserContext, generateSystemPrompt } from "../services/contextBuilder.js";
import { aiToolsSchema } from "../services/aiTools.js";

const router = Router();

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
    const message = error instanceof Error ? error.message : "识别图片失败";
    console.error("[AI Inventory Scan Job Error]", { jobId, message });
    db.prepare("UPDATE inventory_scan_jobs SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(message.slice(0, 500), jobId);
  }
};

const recordChatTurn = (userId: number, sessionId: string, userContent: string, assistantContent: string) => {
  const insert = db.prepare("INSERT INTO ai_chat_messages (user_id, session_id, role, content) VALUES (?, ?, ?, ?)");
  const save = db.transaction(() => {
    insert.run(userId, sessionId, "user", userContent.slice(0, 12000));
    insert.run(userId, sessionId, "assistant", assistantContent.slice(0, 12000));
  });
  try { save(); } catch (error) { console.error("[AI Chat Audit Error]", error); }
};

/**
 * 1. AI 对话 / 营养大厨答疑 (含 Function Calling 自动写库)
 */
router.post("/chat", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { messages = [], prompt, sessionId: requestedSessionId } = req.body;
    const userId = req.userId!;
    const sessionId = typeof requestedSessionId === "string" && requestedSessionId.trim()
      ? requestedSessionId.trim().slice(0, 120)
      : randomUUID();

    // 构建用户数据库 Context
    const userCtx = buildUserContext(userId);
    const systemPrompt = generateSystemPrompt(userCtx);

    const fullMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    if (Array.isArray(messages) && messages.length > 0) {
      messages.forEach((msg: any) => {
        if (msg.role && msg.content) {
          fullMessages.push({ role: msg.role, content: msg.content });
        }
      });
    } else if (prompt) {
      fullMessages.push({ role: "user", content: prompt });
    } else {
      return res.status(400).json({ error: "必须提供 prompt 或 messages" });
    }

    const result = await chatCompletion(fullMessages, {
      temperature: 0.7,
      tools: aiToolsSchema,
      userId,
      endpoint: "chat",
    });
    const latestUserMessage = [...fullMessages].reverse().find((message) => message.role === "user");
    const userContent = typeof latestUserMessage?.content === "string" ? latestUserMessage.content : "";
    recordChatTurn(userId, sessionId, userContent, result.reply);
    return res.json({
      reply: result.reply,
      sessionId,
      actionCard: result.actionCard,
      missingCard: result.missingCard,
      optionsCard: result.optionsCard,
      solutionCards: result.solutionCards,
      contextSummary: {
        inventoryCount: userCtx.inventory.length,
        kitchenwareCount: userCtx.kitchenware.length,
      },
    });
  } catch (error: any) {
    console.error("[AI Router Chat Error]", error);
    return res.status(500).json({ error: "AI 对话请求失败", details: error.message });
  }
});

/**
 * 首页时段推荐：模型读取用户库存、当天饮食及热量目标，返回可直接渲染的多张卡片。
 */
router.post("/home-recommendations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const period = typeof req.body?.period === "string" ? req.body.period.slice(0, 40) : "当前时段";
    const userCtx = buildUserContext(userId);
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
      { role: "system", content: generateSystemPrompt(userCtx) },
      { role: "user", content: prompt },
    ], {
      temperature: 0.45,
      max_tokens: 450,
      jsonMode: true,
      userId,
      endpoint: "home-recommendations",
    });
    const parsed = JSON.parse(result.reply) as { cards?: unknown };
    const cards = normalizeHomeRecommendations(parsed.cards);
    if (cards.length === 0) throw new Error("AI 未返回有效推荐");
    return res.json({ cards });
  } catch (error: any) {
    console.error("[AI Home Recommendations Error]", error);
    return res.status(500).json({ error: "AI 推荐暂时不可用" });
  }
});

/**
 * 2. 拍照识别菜品与热量评估
 */
router.post("/vision-food", authMiddleware, async (req: AuthRequest, res) => {
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
router.post("/inventory-scan-jobs", authMiddleware, (req: AuthRequest, res) => {
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
router.get("/inventory-scan-jobs/:jobId", authMiddleware, (req: AuthRequest, res) => {
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
router.post("/scan-receipt", authMiddleware, async (req: AuthRequest, res) => {
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
 */
router.post("/voice-command", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { speechText, currentStep = 0, recipeTitle = "" } = req.body;
    if (!speechText) {
      return res.status(400).json({ error: "缺少语音识别文本 speechText" });
    }

    const text = speechText.trim();

    // 快捷控制指令硬匹配（零延迟）
    if (text.includes("下一步") || text.includes("继续")) {
      return res.json({ type: "CONTROL", action: "NEXT_STEP" });
    }
    if (text.includes("上一步") || text.includes("返回上一步")) {
      return res.json({ type: "CONTROL", action: "PREV_STEP" });
    }
    if (text.includes("重置") || text.includes("暂停")) {
      return res.json({ type: "CONTROL", action: "TOGGLE_TIMER" });
    }

    // 烹饪疑问提问，由大模型回答
    const prompt = `当前正在做菜【${recipeTitle}】，当前步骤索引是第 ${currentStep + 1} 步。
用户在做饭过程中发出了语音提问：“${text}”。
请简短、清晰地回答该疑问（控制在 60 字以内，方便语音播报），并指出后续注意要点。`;

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const answer = await chatCompletion(messages, {
      max_tokens: 150,
      userId: req.userId,
      endpoint: "voice-command",
    });

    return res.json({ type: "QUESTION", answerText: answer.reply });
  } catch (error: any) {
    console.error("[AI Voice Command Error]", error);
    return res.status(500).json({ error: "处理语音指令失败" });
  }
});

/**
 * 4. 语音识别转文本 (ASR Transcribe) 接口
 */
router.post("/transcribe", optionalAuthMiddleware, async (req: AuthRequest, res) => {
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
