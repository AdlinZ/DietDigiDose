import dotenv from "dotenv";
import { getSystemSetting, logAIUsage } from "../storage/db.js";
import { executeAITool } from "./aiTools.js";
dotenv.config();

export function getAIConfig() {
  const apiKey = getSystemSetting("AI_API_KEY") || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = (getSystemSetting("AI_BASE_URL") || process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = getSystemSetting("AI_MODEL") || process.env.AI_MODEL || "gpt-4o-mini";
  const visionModel = getSystemSetting("AI_VISION_MODEL") || process.env.AI_VISION_MODEL || model;

  return { apiKey, baseUrl, model, visionModel };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  jsonMode?: boolean;
  tools?: any[];
  userId?: number;
  endpoint?: string;
}

export interface SolutionCard {
  id: string;
  schemeTag: string;
  title: string;
  ingredients: string;
  cookingTip: string;
  macros: string;
  actionText: string;
}

export interface ChatCompletionResult {
  reply: string;
  actionCard?: {
    mealType: string;
    foodName: string;
    amount: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  missingCard?: {
    dishName: string;
    missingIngredients: Array<{ name: string; amount: string }>;
  };
  optionsCard?: {
    title: string;
    options: Array<{ label: string; actionText: string }>;
  };
  solutionCards?: SolutionCard[];
}

export function parseDietActionCard(userText: string, aiReplyText: string = ""): ChatCompletionResult["actionCard"] {
  // 如果用户是在询问方案、想吃但缺料、或者 AI 在提供选项，绝不弹出打卡确认卡片！
  const isQueryOrOptionMode = /想吃|买|采购|缺|库存|没有|买菜|方案|选择|推荐|替代|怎么|如何|什么/i.test(userText);
  if (isQueryOrOptionMode) return undefined;

  // 必须用户明确表达“打卡”、“记录”、“今天吃了”、“刚才吃了”等行为才触发
  const isExplicitDietRecord = /打卡|记录|今天吃|刚才吃|早餐吃|午餐吃|晚餐吃|加餐吃|喝了|吃了/i.test(userText);
  if (!isExplicitDietRecord) return undefined;

  const combined = (userText + " " + aiReplyText).toLowerCase();

  let mealType = "午餐";
  if (userText.includes("早")) mealType = "早餐";
  else if (userText.includes("晚")) mealType = "晚餐";
  else if (userText.includes("加餐") || userText.includes("零食") || userText.includes("下午茶")) mealType = "加餐";

  let foodName = "健康膳食";
  if (combined.includes("饺子")) foodName = "水饺";
  else if (combined.includes("牛肉面") || combined.includes("拉面")) foodName = "牛肉面";
  else if (combined.includes("炒饭") || combined.includes("盖码饭")) foodName = "盖码饭";
  else if (combined.includes("鸡胸")) foodName = "香煎鸡胸肉";
  else if (combined.includes("汉堡")) foodName = "牛肉汉堡";
  else if (combined.includes("沙拉")) foodName = "鸡肉沙拉";
  else if (combined.includes("苹果")) foodName = "鲜苹果";
  else if (combined.includes("咖啡")) foodName = "美式咖啡";
  else if (combined.includes("酸奶") || combined.includes("牛奶")) foodName = "无糖酸奶";

  let amount = "1份";
  if (combined.includes("大碗")) amount = "1大碗";
  else if (combined.includes("小碗")) amount = "1小碗";
  else if (combined.includes("盘")) amount = "1盘";
  else if (combined.includes("杯")) amount = "1杯";
  else if (combined.includes("个")) amount = "1个";

  let calories = 450;
  if (foodName.includes("饺子")) calories = 480;
  else if (foodName.includes("面")) calories = 520;
  else if (foodName.includes("鸡胸")) calories = 280;
  else if (foodName.includes("沙拉")) calories = 210;
  else if (foodName.includes("苹果")) calories = 95;
  else if (foodName.includes("咖啡")) calories = 15;

  return {
    mealType,
    foodName,
    amount,
    calories,
    protein: Math.round((calories * 0.2) / 4),
    carbs: Math.round((calories * 0.5) / 4),
    fat: Math.round((calories * 0.3) / 9),
  };
}

export function parseMissingIngredientsCard(userText: string, aiReplyText: string = ""): ChatCompletionResult["missingCard"] {
  // 1. 倒序提取用户句尾最后表达的真正意图，过滤“不想吃这个了”等前置否定/转折短语
  let dishName = "";
  const matches = Array.from(userText.matchAll(/(?:想吃|想做|改吃|吃)([^\s，,。!！?？]+)/g));
  if (matches.length > 0) {
    const rawTarget = matches[matches.length - 1][1];
    dishName = rawTarget
      .replace(/^(这个了|了这个|这个|了|改|还是|吧|啊)+/g, "")
      .replace(/但.*$/, "")
      .trim();
  }

  if (!dishName) {
    if (userText.includes("西红柿炒蛋") || userText.includes("番茄炒蛋") || userText.includes("炒鸡蛋")) dishName = "西红柿炒蛋";
    else if (userText.includes("牛腩") || userText.includes("番茄炖牛腩")) dishName = "番茄炖牛腩";
    else if (userText.includes("炸鸡") || userText.includes("鸡翅")) dishName = "奥尔良烤鸡翅";
    else if (userText.includes("三文鱼")) dishName = "香煎三文鱼";
    else if (userText.includes("牛排")) dishName = "黑椒牛排";
  }

  if (!dishName) return undefined;

  // 检查 AI 回复中是否提到了缺食材/采购建议
  const isAiMissingWarn = /采购|补充|缺|没有|买/i.test(aiReplyText) || /缺|没有|买菜/i.test(userText);
  if (!isAiMissingWarn) return undefined;

  const missingItems: Array<{ name: string; amount: string }> = [];

  // 根据确切的菜名提取真正缺失的食材
  if (dishName.includes("西红柿炒蛋") || dishName.includes("番茄炒蛋") || dishName.includes("炒鸡蛋")) {
    if (aiReplyText.includes("鸡蛋") || userText.includes("鸡蛋")) missingItems.push({ name: "鲜鸡蛋", amount: "3个" });
    if (aiReplyText.includes("西红柿") || aiReplyText.includes("番茄")) missingItems.push({ name: "西红柿", amount: "2个" });
    if (missingItems.length === 0) missingItems.push({ name: "鲜鸡蛋", amount: "3个" });
  } else if (dishName.includes("牛腩")) {
    missingItems.push({ name: "牛腩", amount: "500g" }, { name: "番茄", amount: "2个" });
  } else if (dishName.includes("鸡翅") || dishName.includes("炸鸡")) {
    missingItems.push({ name: "鸡翅中", amount: "8个" }, { name: "奥尔良腌料", amount: "1包" });
  } else if (dishName.includes("三文鱼") && userText.includes("三文鱼")) {
    missingItems.push({ name: "三文鱼排", amount: "200g" });
  } else if (dishName.includes("牛排") && userText.includes("牛排")) {
    missingItems.push({ name: "原切眼肉牛排", amount: "1块" });
  } else {
    // 动态从 AI 回复里匹配缺失食材，例如："补充一些鸡蛋" -> "鲜鸡蛋 3个"
    const eggMatch = aiReplyText.match(/补充[一些\s]*([^\s，。！~]+)/);
    if (eggMatch) {
      missingItems.push({ name: eggMatch[1], amount: "适量" });
    } else {
      missingItems.push({ name: `${dishName}关键食材`, amount: "1份" });
    }
  }

  return {
    dishName,
    missingIngredients: missingItems,
  };
}

export function parseOptionChoicesCard(userText: string, aiReplyText: string = ""): ChatCompletionResult["optionsCard"] {
  // 如果是烹饪步骤、食谱教程、做饭流程，绝不能误判为方案选项卡片！
  if (
    aiReplyText.includes("步骤") ||
    aiReplyText.includes("做法") ||
    aiReplyText.includes("准备步骤") ||
    aiReplyText.includes("详细做法") ||
    aiReplyText.includes("分钟") ||
    aiReplyText.includes("热锅") ||
    aiReplyText.includes("爆香") ||
    aiReplyText.includes("下锅")
  ) {
    return undefined;
  }

  const options: Array<{ label: string; actionText: string }> = [];

  // 1. 匹配“方案 A: xxx”、“方案 B: xxx”等
  const schemeMatches = aiReplyText.matchAll(/方案\s*([A-Za-z0-9一二三四12345])[:：\s]\s*([^\n\r]+)/g);
  for (const match of schemeMatches) {
    const key = match[1].toUpperCase();
    const rawContent = match[2].replace(/[\*\_#]/g, "").trim();
    const shortLabel = rawContent.split(/[，,。!！\n]/)[0].slice(0, 16);
    options.push({
      label: `💡 方案 ${key}: ${shortLabel}`,
      actionText: `我选择【方案 ${key}：${shortLabel}】，请为我整理详细做法与准备步骤！`,
    });
  }

  // 仅在明确有 1~5 个独立方案且非烹饪步骤时才解析
  if (options.length > 0 && options.length <= 5) {
    return {
      title: "👇 点击下方快捷按钮选择您的方案：",
      options,
    };
  }

  return undefined;
}

export function parseSolutionCards(userText: string, aiReplyText: string = ""): SolutionCard[] | undefined {
  if (!aiReplyText.includes("方案")) return undefined;

  const cards: SolutionCard[] = [];
  const matches = Array.from(aiReplyText.matchAll(/方案\s*([A-Za-z0-9一二三四12345])[:：\s]\s*([^\n\r]+)/g));
  if (matches.length === 0) return undefined;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const key = match[1].toUpperCase();
    const schemeTag = `方案 ${key}`;
    const rawTitle = match[2].replace(/[\*\_#【】]/g, "").trim();
    const title = rawTitle.split(/[，,。!！\n]/)[0];

    const startIndex = match.index || 0;
    const endIndex = i < matches.length - 1 ? (matches[i + 1].index || aiReplyText.length) : aiReplyText.length;
    const blockText = aiReplyText.slice(startIndex, endIndex);

    const macroMatch = blockText.match(/(?:预估|热量|能量)[:：\s]*([^\n\r]+)/) || blockText.match(/(\d+\s*kcal[^\n\r]*)/i);
    const macros = macroMatch ? macroMatch[1].replace(/[\*\_#]/g, "").trim() : "预估 450 kcal · 营养均衡低卡";

    const detailLines = blockText
      .split("\n")
      .map((l) => l.replace(/^[•\-\*\s]+/, "").replace(/[\*\_#]/g, "").trim())
      .filter((l) => l && !l.startsWith("方案") && !l.includes("预估") && !l.includes("热量") && !l.includes("kcal"));

    const ingredientsLine = detailLines.find((l) => l.includes("+") || l.includes("g") || l.includes("个") || l.includes("ml") || l.includes("配")) || detailLines[0] || "优选食材搭配";
    const cookingTipLine = detailLines.find((l) => l !== ingredientsLine) || "少油少盐，保持食材原汁原味";

    cards.push({
      id: `sol_${key}_${i}`,
      schemeTag,
      title,
      ingredients: ingredientsLine,
      cookingTip: cookingTipLine,
      macros,
      actionText: `我选择【${schemeTag}：${title}】，请为我提供详细做法与准备步骤！`,
    });
  }

  return cards.length > 0 ? cards : undefined;
}

/**
 * 封装通用 OpenAIspec 兼容 API 请求 (含 Agentic Tool Calls 与预填卡片)
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResult> {
  const config = getAIConfig();
  const model = options.model || config.model;
  const startedAt = Date.now();
  let usageLogged = false;
  const lastMsg = messages[messages.length - 1];
  const userText = typeof lastMsg?.content === "string" ? lastMsg.content : "";

  if (!config.apiKey) {
    const replyText = getFallbackResponse(messages);
    const actionCard = parseDietActionCard(userText, replyText);
    const missingCard = parseMissingIngredientsCard(userText, replyText);
    const solutionCards = parseSolutionCards(userText, replyText);
    const optionsCard = solutionCards && solutionCards.length > 0 ? undefined : parseOptionChoicesCard(userText, replyText);
    return {
      reply: actionCard
        ? `🍱 食语已为您分析并预填好【${actionCard.mealType}】打卡数据！请在下方核对，点击【确认打卡保存】或【弹出修改】：`
        : replyText,
      actionCard,
      missingCard,
      optionsCard,
      solutionCards,
    };
  }

  try {
    const payload: any = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1000,
      response_format: options.jsonMode ? { type: "json_object" } : undefined,
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools;
      payload.tool_choice = "auto";
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[AI Service Error]", response.status, errorText);
      throw new Error(`AI API 响应错误: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const choiceMsg = data.choices?.[0]?.message;
    const usage = data.usage || {};

    if (options.userId) {
      logAIUsage({
        userId: options.userId,
        endpoint: options.endpoint || "chat",
        model: data.model || model,
        promptTokens: Number(usage.prompt_tokens ?? usage.input_tokens) || 0,
        completionTokens: Number(usage.completion_tokens ?? usage.output_tokens) || 0,
        totalTokens: Number(usage.total_tokens)
          || (Number(usage.prompt_tokens ?? usage.input_tokens) || 0)
            + (Number(usage.completion_tokens ?? usage.output_tokens) || 0),
        latencyMs: Date.now() - startedAt,
        success: true,
      });
      usageLogged = true;
    }

    // A. 如果模型决定调用工具 (Tool Calls)
    if (choiceMsg?.tool_calls && choiceMsg.tool_calls.length > 0 && options.userId) {
      const toolCall = choiceMsg.tool_calls[0];
      const fnName = toolCall.function.name;
      let fnArgs: any = {};
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        fnArgs = {};
      }

      console.log(`[AI Tool Call Triggered] User ${options.userId} -> ${fnName}`, fnArgs);

      // 人机协同模式 (Human-In-The-Loop): 饮食打卡不静默落库，而是生成中间确认卡片
      if (fnName === "record_diet_meal") {
        const card = {
          mealType: fnArgs.mealType || "午餐",
          foodName: fnArgs.foodName || "健康料理",
          amount: fnArgs.amount || "1份",
          calories: fnArgs.calories || 350,
          protein: fnArgs.protein || 18,
          carbs: fnArgs.carbs || 45,
          fat: fnArgs.fat || 10,
        };
        return {
          reply: `🍱 食语已为你识别并整理好【${card.mealType}】打卡数据卡片！请核对信息，点击【确认打卡保存】或【弹出修改】：`,
          actionCard: card,
        };
      }

      if (fnName === "report_missing_ingredients") {
        const missingCard = {
          dishName: fnArgs.dishName || "目标料理",
          missingIngredients: Array.isArray(fnArgs.missingIngredients) ? fnArgs.missingIngredients : [],
        };
        return {
          reply: `健康体贴家，理解您想吃【${missingCard.dishName}】的心情～ 但查看了您的冰箱库存，目前缺少关键食材！为您整理了【缺料智能采购卡片】：`,
          missingCard,
        };
      }

      if (fnName === "recommend_meal_solutions") {
        const solutionCards = (fnArgs.solutions || []).map((s: any, idx: number) => ({
          id: `sol_${s.schemeTag || idx}_${idx}`,
          schemeTag: s.schemeTag || `方案 ${String.fromCharCode(65 + idx)}`,
          title: s.title || "健康推荐料理",
          ingredients: s.ingredients || "优选食材搭配",
          cookingTip: s.cookingTip || "少油少盐，保持食材原汁原味",
          macros: s.macros || "预估 450 kcal · 营养均衡",
          actionText: `我选择【${s.schemeTag || `方案 ${String.fromCharCode(65 + idx)}`}：${s.title || "健康推荐料理"}】，请为我提供详细做法与准备步骤！`,
        }));

        return {
          reply: fnArgs.introMessage || "根据您当前的诉求与库存，为您推荐以下膳食方案：",
          solutionCards: solutionCards.length > 0 ? solutionCards : undefined,
        };
      }

      // 其它工具执行 SQLite 操作
      const toolResult = await executeAITool(options.userId, fnName, fnArgs);
      if (toolResult.success) {
        return { reply: `${toolResult.message}\n\n如有其它需求，随时告诉我哦！` };
      } else {
        return { reply: `尝试执行操作时出错：${toolResult.message}` };
      }
    }

    const replyContent = choiceMsg?.content || "";
    const parsedCard = parseDietActionCard(userText, replyContent);
    const missingCard = parseMissingIngredientsCard(userText, replyContent);
    const solutionCards = parseSolutionCards(userText, replyContent);
    const optionsCard = solutionCards && solutionCards.length > 0 ? undefined : parseOptionChoicesCard(userText, replyContent);

    let cleanedReply = replyContent;
    if (solutionCards && solutionCards.length > 0) {
      cleanedReply = replyContent.split(/(?=方案\s*[A-Za-z0-9一二三四12345][:：\s])/)[0].trim();
      if (!cleanedReply.endsWith("：") && !cleanedReply.endsWith(":")) {
        cleanedReply += "：";
      }
    }

    return { reply: cleanedReply, actionCard: parsedCard, missingCard, optionsCard, solutionCards };
  } catch (err: any) {
    console.error("[AI Service Exception]", err.message);
    if (options.userId && !usageLogged) {
      logAIUsage({
        userId: options.userId,
        endpoint: options.endpoint || "chat",
        model,
        latencyMs: Date.now() - startedAt,
        success: false,
      });
    }
    const replyText = getFallbackResponse(messages);
    const actionCard = parseDietActionCard(userText, replyText);
    const missingCard = parseMissingIngredientsCard(userText, replyText);
    const optionsCard = parseOptionChoicesCard(userText, replyText);
    return { reply: replyText, actionCard, missingCard, optionsCard };
  }
}

/**
 * 真实连通性测试 (不使用 getFallbackResponse 降级，严格抛出真实 API 错误)
 */
export async function testAIConnection(overrideConfig?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Promise<{ reply: string; latencyMs: number }> {
  const currentConfig = getAIConfig();
  const apiKey = (overrideConfig?.apiKey || currentConfig.apiKey).trim();
  const baseUrl = (overrideConfig?.baseUrl || currentConfig.baseUrl).replace(/\/$/, "").trim();
  const model = (overrideConfig?.model || currentConfig.model).trim();

  if (!apiKey) {
    throw new Error("请先填写 API Key 凭证");
  }
  if (!baseUrl) {
    throw new Error("请先填写 API Base URL");
  }
  if (!model) {
    throw new Error("请先指定测试的 Chat Model 名称");
  }

  const startTime = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Say 'OK'" }],
      max_tokens: 15,
      temperature: 0.1,
    }),
  });

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errBody = await response.text();
    let errorDetail = errBody;
    try {
      const json = JSON.parse(errBody);
      errorDetail = json.error?.message || json.message || errBody;
    } catch {
      // keep text
    }
    throw new Error(`[HTTP ${response.status}] ${errorDetail}`);
  }

  const data = (await response.json()) as any;
  const reply = data.choices?.[0]?.message?.content?.trim() || "OK";
  return { reply, latencyMs };
}

/**
 * 多模态图片识别
 */
export async function analyzeImage(
  imageBase64OrUrl: string,
  prompt: string,
  options: ChatCompletionOptions = {}
): Promise<string> {
  const config = getAIConfig();
  const model = options.model || config.visionModel;
  const imageUrl = imageBase64OrUrl.startsWith("http") || imageBase64OrUrl.startsWith("data:")
    ? imageBase64OrUrl
    : `data:image/jpeg;base64,${imageBase64OrUrl}`;

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];

  const res = await chatCompletion(messages, { model, ...options });
  return res.reply;
}

/**
 * 未配置真实 API Key 时的智能降级逻辑
 */
function getFallbackResponse(messages: ChatMessage[]): string {
  const lastMsg = messages[messages.length - 1];
  const userText = typeof lastMsg.content === "string" ? lastMsg.content : "";

  if (userText.includes("今晚吃") || userText.includes("吃什么") || userText.includes("吃啥") || userText.includes("推荐") || userText.includes("想吃")) {
    return `为您根据现有库房食材推荐以下 3 个平替高蛋白健康餐方案：

方案 A：香煎三文鱼配紫麦紫菜沙拉
• 挪威三文鱼排 150g + 三色藜麦 50g + 羽衣甘蓝 + 菠菜 + 樱桃小番茄 150g
• 煎香鱼皮，油脂自然渗入藜麦，简单黑胡椒调味
• 预估：约 605 kcal | 蛋白质 31g

方案 B：蒜香虾仁炒时蔬配生菜沙拉
• 南美大虾仁 200g + 罗马生菜 100g + 菠菜 100g + 牛油果 1/4 个
• 虾仁用橄榄油蒜蓉香炒，搭配水煮
• 预估：约 323 kcal | 蛋白质 36g

方案 C：嫩煎鸡胸肉藜麦能量碗
• 鸡胸肉 150g + 三色藜麦 50g + 羽衣甘蓝 + 樱桃小番茄 100g
• 鸡胸肉香料腌制煎制，搭配牛油果泥和藜麦基底
• 预估：约 520 kcal | 蛋白质 45g

您更倾心哪个方案呢？您可以点击下方卡片开启制作流程！`;
  }

  if (userText.includes("冰箱") || userText.includes("食材")) {
    return "根据您当前冰箱的库存记录，我推荐【牛油果高纤蛋白碗】！主料：牛油果 1个、鸡胸肉 150g、菠菜 80g。热量约 420 kcal（蛋白质 32g / 碳水 24g / 脂肪 18g）。适合今晚做一顿健康晚餐！";
  }
  if (userText.includes("卡路里") || userText.includes("评估") || userText.includes("营养")) {
    return "为您分析今日健康数据：您今日已摄入约 1460 kcal（达到日目标的 73%），蛋白质已补充 85g。建议晚餐增加少许优质复合碳水（如紫薯或燕麦）和绿叶蔬菜！";
  }
  if (userText.includes("下一步") || userText.includes("做饭")) {
    return "【AI 下厨指导】：请将蒜末和生姜片放入炒锅中，中小火爆香 30 秒至闻到香味。准备好了说“下一步”！";
  }

  return `收到您的咨询：“${userText || "健康饮食"}”！建议保持每日膳食平衡：50% 绿叶蔬菜 + 25% 优质蛋白质（鸡肉/鱼肉/蛋类）+ 25% 低 GI 复合碳水化合物（玄米/燕麦/紫薯）。`;
}

/**
 * 语音识别 ASR 转换接口
 */
export async function transcribeAudio(
  audioBase64: string,
  options: { userId?: number; mimeType?: string } = {}
): Promise<{ text: string }> {
  const { apiKey, baseUrl } = getAIConfig();
  if (!audioBase64 || audioBase64.length === 0) {
    return { text: "" };
  }

  if (apiKey && baseUrl) {
    try {
      const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, "");
      const audioBuffer = Buffer.from(cleanBase64, "base64");
      const mimeType = options.mimeType || "audio/m4a";
      const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("webm") ? "webm" : "m4a";

      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType });
      formData.append("file", blob, `speech.${extension}`);
      formData.append("model", getSystemSetting("AI_ASR_MODEL") || "FunAudioLLM/SenseVoiceSmall");

      const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (response.ok) {
        const data = (await response.json()) as { text?: string };
        if (data && typeof data.text === "string" && data.text.trim()) {
          logAIUsage({
            userId: options.userId ?? 1,
            endpoint: "voice-transcribe",
            model: "SenseVoiceSmall",
            promptTokens: Math.ceil(audioBuffer.length / 100),
            completionTokens: data.text.length,
          });
          return { text: data.text.trim() };
        }
      }
    } catch (err) {
      console.warn("[transcribeAudio API Error]", err);
    }
  }

  return { text: "今晚吃什么推荐一下" };
}
