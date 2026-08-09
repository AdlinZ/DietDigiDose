import { z } from "zod";

const trimmedString = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label}不能为空`).max(max, `${label}不能超过 ${max} 个字符`);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD").refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  "日期无效",
);

const optionalImage = z.string().trim().max(4_000_000, "图片过大").nullable().optional();
const nutrition = z.number().finite().min(0).max(100_000).nullable().optional();

export const mediaImageUploadSchema = z.object({
  data_url: z.string().max(5_600_000, "图片过大"),
  scope: z.literal("community"),
}).strict();

export const registerSchema = z.object({
  identifier: trimmedString(1, 254, "邮箱或手机号"),
  username: trimmedString(2, 30, "用户名"),
  password: z.string()
    .min(6, "密码长度不能少于 6 位")
    .max(128, "密码不能超过 128 位")
    .regex(/[A-Za-z]/, "密码必须包含字母")
    .regex(/\d/, "密码必须包含数字"),
}).strict();

export const loginSchema = z.object({
  identifier: z.string().trim().max(254).optional(),
  password: z.string().min(1).max(128),
}).strict().refine((value) => value.identifier, {
  message: "请输入登录账号",
  path: ["identifier"],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string()
    .min(6, "新密码长度不能少于 6 位")
    .max(128, "新密码不能超过 128 位")
    .regex(/[A-Za-z]/, "新密码必须包含字母")
    .regex(/\d/, "新密码必须包含数字"),
}).strict();

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "请输入当前密码").max(128),
  confirmation: z.literal("DELETE", { message: "账号删除确认无效" }),
}).strict();

export const profileSchema = z.object({
  username: trimmedString(2, 30, "用户名").optional(),
  avatar_url: z.string().trim().max(4_000_000, "头像图片过大").nullable().optional(),
  bio: z.string().trim().max(500, "个人简介不能超过 500 个字符").nullable().optional(),
  daily_calories_target: z.number().int().min(500).max(10_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

export const notificationPreferencesSchema = z.object({
  expiring_alert: z.boolean(),
  meal_reminder: z.boolean(),
  water_reminder: z.boolean(),
  breakfast_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "早餐提醒时间格式无效"),
  lunch_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "午餐提醒时间格式无效"),
  dinner_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "晚餐提醒时间格式无效"),
  water_start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "饮水开始时间格式无效"),
  water_end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "饮水结束时间格式无效"),
  water_interval_minutes: z.number().int().min(30).max(360),
  quiet_start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "静默开始时间格式无效"),
  quiet_end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "静默结束时间格式无效"),
  weekdays_enabled: z.boolean(),
  weekends_enabled: z.boolean(),
}).strict();

export const notificationActionSchema = z.object({
  action: z.enum(["open", "complete", "snooze_today", "plan_recipe"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const localNotificationEventSchema = z.object({
  kind: z.enum(["meal", "water"]),
  title: trimmedString(1, 80, "提醒标题"),
  body: trimmedString(1, 500, "提醒内容"),
  event: z.enum(["received", "opened"]),
  source_id: z.string().trim().max(200).optional(),
}).strict();

export const pushDeviceSchema = z.object({
  expo_push_token: z.string().trim().regex(/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/, "无效的 Expo Push Token"),
  platform: z.enum(["ios", "android"]),
}).strict();

export const notificationCampaignSchema = z.object({
  title: trimmedString(1, 80, "通知标题"),
  body: trimmedString(1, 500, "通知内容"),
}).strict();

export const feedbackCreateSchema = z.object({
  category: z.enum(["issue", "suggestion", "support"]),
  content: trimmedString(5, 2000, "反馈内容"),
  context: z.object({
    page: z.string().trim().max(120).optional(),
    recipeId: z.number().int().positive().optional(),
    recipeTitle: z.string().trim().max(160).optional(),
  }).strict().optional(),
}).strict();

export const inventoryCreateSchema = z.object({
  food_name: trimmedString(1, 100, "食材名称"),
  category: trimmedString(1, 40, "分类"),
  quantity: trimmedString(1, 40, "数量").default("1份"),
  expiration_date: isoDate,
  storage_location: z.enum(["冷藏", "冷冻", "常温"]).default("冷藏"),
  image_url: optionalImage,
}).strict();

export const inventoryUpdateSchema = inventoryCreateSchema.partial().extend({
  is_available: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

export const shoppingInventoryImportSchema = z.object({
  idempotency_key: z.string().trim().min(16, "幂等键格式无效").max(200, "幂等键过长"),
  items: z.array(inventoryCreateSchema).min(1, "至少选择一项食材").max(100),
}).strict();

export const dietRecordCreateSchema = z.object({
  meal_type: z.string().trim().max(30, "餐别标签不能超过 30 个字符").default(""),
  food_name: trimmedString(1, 120, "食物名称"),
  amount: trimmedString(1, 40, "分量").default("1份"),
  calories: nutrition,
  protein: nutrition,
  carbs: nutrition,
  fat: nutrition,
  recorded_at: isoDate.optional(),
  recorded_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "进食时间格式必须为 HH:mm").nullable().optional(),
  image_url: optionalImage,
}).strict();

export const cookingCompletionSchema = z.object({
  idempotency_key: z.string().trim().min(16, "幂等键格式无效").max(200, "幂等键过长"),
  recipe_id: z.number().int().positive().nullable().optional(),
  inventory_item_ids: z.array(z.number().int().positive()).max(100).default([]),
  diet_record: dietRecordCreateSchema,
}).strict();

export const healthLogSchema = z.object({
  weight: z.number().finite().min(20).max(500).nullable().optional(),
  body_fat: z.number().finite().min(1).max(75).nullable().optional(),
  water_ml: z.number().int().min(0).max(20_000).nullable().optional(),
  height_cm: z.number().finite().min(80).max(250).nullable().optional(),
  waist_cm: z.number().finite().min(30).max(300).nullable().optional(),
  hip_cm: z.number().finite().min(30).max(300).nullable().optional(),
  resting_heart_rate: z.number().int().min(20).max(250).nullable().optional(),
  blood_pressure_systolic: z.number().int().min(50).max(300).nullable().optional(),
  blood_pressure_diastolic: z.number().int().min(30).max(200).nullable().optional(),
  blood_glucose_mmol: z.number().finite().min(1).max(50).nullable().optional(),
  cycle_status: z.enum(["经期", "备孕", "孕期", "产后", "哺乳期"]).nullable().optional(),
  sleep_hours: z.number().finite().min(0).max(24).nullable().optional(),
  recorded_date: isoDate.optional(),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "recorded_date"),
  "至少填写一项健康数据",
);

export const healthProfileSchema = z.object({
  gender: z.enum(["男", "女", "保密", "male", "female", "other"]).nullable().optional(),
  age: z.number().int().min(12).max(120).nullable().optional(),
  height: z.number().finite().min(80).max(250).nullable().optional(),
  weight: z.number().finite().min(20).max(500).nullable().optional(),
  target_weight: z.number().finite().min(20).max(500).nullable().optional(),
  health_goal: z.enum(["lose_weight", "reduce_fat", "gain_muscle", "maintain", "healthy"]).optional(),
  activity_level: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).optional(),
  dietary_preference: z.string().trim().max(200).optional(),
  allergies: z.array(z.object({
    name: trimmedString(1, 80, "过敏或不耐受名称"),
    type: z.enum(["allergy", "intolerance"]),
    severity: z.enum(["mild", "moderate", "severe"]),
  }).strict()).max(30).optional(),
  medications: z.string().trim().max(1000).optional(),
  medical_conditions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  medical_notes: z.string().trim().max(1000).optional(),
  dietary_restrictions: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  disliked_foods: z.string().trim().max(1000).optional(),
  kitchen_constraints: z.object({
    meal_time_minutes: z.number().int().min(5).max(300).nullable().optional(),
    budget_per_meal: z.number().finite().min(0).max(100_000).nullable().optional(),
    cooking_level: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
    servings: z.number().int().min(1).max(30).nullable().optional(),
    eating_out_frequency: z.enum(["rarely", "sometimes", "often"]).nullable().optional(),
  }).strict().optional(),
  nutrition_targets: z.object({
    calories_kcal: z.number().finite().min(500).max(10_000).nullable().optional(),
    protein_g: z.number().finite().min(0).max(1000).nullable().optional(),
    salt_g: z.number().finite().min(0).max(100).nullable().optional(),
    sugar_g: z.number().finite().min(0).max(1000).nullable().optional(),
    water_ml: z.number().finite().min(0).max(20_000).nullable().optional(),
    professional_advice: z.string().trim().max(1000).optional(),
  }).strict().optional(),
  tracking_enabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

export const customFoodSchema = z.object({
  name: trimmedString(1, 120, "食材名称"),
  calories_100g: z.number().finite().min(0).max(10_000),
  protein_100g: z.number().finite().min(0).max(1000).default(0),
  carbs_100g: z.number().finite().min(0).max(1000).default(0),
  fat_100g: z.number().finite().min(0).max(1000).default(0),
}).strict();

const communityImage = z.string().trim().url("图片必须来自受控对象存储").max(2048, "图片 URL 过长");
export const communityPostSchema = z.object({
  content: z.string().trim().max(5000, "动态内容不能超过 5000 个字符").default(""),
  image_url: communityImage.nullable().optional(),
  image_urls: z.array(communityImage).max(9, "最多上传 9 张图片").optional(),
  category: z.enum(["寻味", "榜单", "活动", "问答"]).default("寻味"),
  event_start_at: z.string().trim().nullable().optional(),
  event_end_at: z.string().trim().nullable().optional(),
}).strict().superRefine((value, context) => {
  const images = value.image_urls?.length || (value.image_url ? 1 : 0);
  if (!value.content && !images) {
    context.addIssue({ code: "custom", path: ["content"], message: "动态内容或图片不能为空" });
  }
  if (value.category === "活动") {
    const start = value.event_start_at ? Date.parse(value.event_start_at) : Number.NaN;
    const end = value.event_end_at ? Date.parse(value.event_end_at) : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      context.addIssue({ code: "custom", path: ["event_start_at"], message: "活动需要有效的开始和结束日期" });
    } else if (end < start) {
      context.addIssue({ code: "custom", path: ["event_end_at"], message: "活动结束日期不能早于开始日期" });
    }
  }
});

export const communityCommentSchema = z.object({
  content: z.string().trim().max(2000, "评论不能超过 2000 个字符").default(""),
  image_url: communityImage.nullable().optional(),
}).strict().refine((value) => value.content || value.image_url, "评论内容或图片不能为空");

const recipeArrayOrJson = z.union([z.array(z.unknown()), z.string().max(100_000)]);
export const recipeSubmissionSchema = z.object({
  title: trimmedString(2, 80, "食谱标题"),
  description: z.string().trim().max(1000).default(""),
  image_url: z.string().trim().max(4_000_000).optional(),
  cook_time: z.union([z.number(), z.string()]).optional(),
  difficulty: z.string().trim().max(20).optional(),
  calories: z.union([z.number(), z.string()]).optional(),
  protein: z.union([z.number(), z.string()]).optional(),
  carbs: z.union([z.number(), z.string()]).optional(),
  fat: z.union([z.number(), z.string()]).optional(),
  nutrition: recipeArrayOrJson.optional(),
  nutrition_json: recipeArrayOrJson.optional(),
  category: z.string().trim().max(40).optional(),
  tags: recipeArrayOrJson.optional(),
  steps: recipeArrayOrJson.optional(),
  steps_json: recipeArrayOrJson.optional(),
  ingredients: recipeArrayOrJson.optional(),
  ingredients_json: recipeArrayOrJson.optional(),
}).strict().refine((value) => value.steps !== undefined || value.steps_json !== undefined, "请至少填写一个烹饪步骤")
  .refine((value) => value.ingredients !== undefined || value.ingredients_json !== undefined, "请至少填写一种食材");

const imagePayload = z.string().trim().min(1, "缺少图片数据").max(7_500_000, "图片过大").refine(
  (value) => !value.startsWith("data:") || /^data:image\/(jpeg|png|webp|heic|heif);base64,/i.test(value),
  "只支持 JPEG、PNG、WebP 或 HEIC 图片",
);
const aiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12_000),
}).strict();

// 对话历史保存在客户端，旧版本或损坏的缓存不应阻止一条新的有效提问。
// 此处只清洗 AI 上下文，不降低其他业务接口的严格校验。
const normalizeAIChatPayload = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  const normalizedMessages = Array.isArray(raw.messages)
    ? raw.messages.flatMap((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return [];
      const item = message as Record<string, unknown>;
      if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") return [];
      const content = item.content.trim().slice(0, 12_000);
      return content ? [{ role: item.role, content }] : [];
    })
    : [];
  // System instructions are server-owned. Silently discard them here so old
  // clients keep working without elevating untrusted text to system level.
  const messages = normalizedMessages.slice(-50);
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim().slice(0, 12_000) : undefined;
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim().slice(0, 120) : undefined;
  const source = raw.source === "voice" || raw.source === "cooking" ? raw.source : "assistant";
  return {
    ...(messages.length ? { messages } : {}),
    ...(prompt ? { prompt } : {}),
    ...(sessionId ? { sessionId } : {}),
    source,
  };
};

export const aiChatSchema = z.preprocess(normalizeAIChatPayload, z.object({
  messages: z.array(aiChatMessageSchema).max(50).optional(),
  prompt: z.string().min(1).max(12_000).optional(),
  sessionId: z.string().max(120).optional(),
  source: z.enum(["assistant", "voice", "cooking"]).default("assistant"),
}).strict().refine((value) => value.prompt || value.messages?.length, "必须提供 prompt 或 messages"));

export const aiWriteConfirmationCommitSchema = z.object({
  idempotencyKey: z.string().trim().min(16, "幂等键格式无效").max(200, "幂等键过长"),
}).strict();

export const aiHomeRecommendationsSchema = z.object({
  period: z.string().trim().max(40).optional(),
}).strict();

export const aiVisionSchema = z.object({
  image: imagePayload,
  userPrompt: z.string().trim().max(1000).optional(),
}).strict();

export const aiImageSchema = z.object({ image: imagePayload }).strict();

export const aiVoiceCommandSchema = z.object({
  speechText: trimmedString(1, 1000, "语音识别文本"),
  sessionId: z.string().trim().min(1).max(120),
  currentStep: z.number().int().min(0).max(1000).default(0),
  recipeTitle: z.string().trim().max(120).default(""),
  recipeSteps: z.array(z.string().max(2000)).max(100).optional(),
  recipeIngredients: z.array(z.string().max(500)).max(100).optional(),
  voiceHistory: z.array(z.object({
    question: z.string().trim().min(1).max(1000),
    answer: z.string().trim().min(1).max(2000),
  }).strict()).max(3).optional(),
}).strict();

export const aiTranscribeSchema = z.object({
  audioBase64: z.string().trim().min(1, "缺少音频数据").max(7_500_000, "音频过大"),
  mimeType: z.enum([
    "audio/m4a", "audio/mp4", "audio/mpeg", "audio/wav", "audio/webm", "audio/x-m4a",
  ]).default("audio/m4a"),
}).strict();

export const kitchenwareSchema = z.object({
  name: trimmedString(1, 80, "厨具名称"),
  category: z.enum(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]).default("其他"),
  status: z.enum(["常用", "良好", "需保养", "维修中", "闲置"]).default("良好"),
  note: z.string().trim().max(300).default(""),
  image_url: z.string().trim().max(4_000_000).nullable().optional(),
  purchase_date: z.union([isoDate, z.literal("")]).nullable().optional(),
}).strict();

export const adminRoleSchema = z.object({ role: z.enum(["user", "admin"]) }).strict();
export const adminExpertSchema = z.object({ is_verified_expert: z.boolean() }).strict();
export const adminUserStatusSchema = z.object({ is_disabled: z.boolean() }).strict();
export const adminLevelAdjustmentSchema = z.object({
  xp_delta: z.number().int().min(-10_000).max(10_000).refine((value) => value !== 0, "经验调整不能为 0"),
  reason: trimmedString(2, 200, "调整原因"),
}).strict();
export const adminUserCredentialsSchema = z.object({
  identifier: z.string().trim().min(1, "邮箱或手机号不能为空").max(254, "邮箱或手机号不能超过 254 个字符").optional(),
  newPassword: z.string()
    .min(6, "新密码长度不能少于 6 位")
    .max(128, "新密码不能超过 128 位")
    .regex(/[A-Za-z]/, "新密码必须包含字母")
    .regex(/\d/, "新密码必须包含数字")
    .optional(),
}).strict().refine((value) => value.identifier !== undefined || value.newPassword !== undefined, "至少提供一个需要更新的字段");
export const adminKitchenwareStatusSchema = z.object({
  status: z.enum(["常用", "良好", "需保养", "维修中", "闲置"]),
}).strict();
export const adminKitchenwareCatalogSchema = z.object({
  name: trimmedString(1, 80, "厨具名称"),
  category: z.enum(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  cooking_methods: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  care_note: z.string().trim().max(300).default(""),
}).strict();
export const adminRecipeRejectSchema = z.object({ reason: trimmedString(2, 300, "驳回原因") }).strict();
export const adminEventSchema = z.object({
  event_start_at: z.string().trim().min(1),
  event_end_at: z.string().trim().min(1),
}).strict().refine((value) => {
  const start = Date.parse(value.event_start_at);
  const end = Date.parse(value.event_end_at);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}, "活动日期无效或结束时间早于开始时间");
export const adminQuestionSchema = z.object({
  question_status: z.enum(["open", "resolved"]),
  accepted_comment_id: z.number().int().positive().nullable().optional(),
}).strict();
export const adminIngredientSchema = customFoodSchema.extend({
  category: z.string().trim().max(80).nullable().optional(),
  source: z.string().trim().min(1).max(80).default("official"),
}).strict();
const optionalUrlSchema = z.string().trim().max(2000).optional().refine(
  (val) => !val || /^https?:\/\/\S+/i.test(val),
  "请输入包含 http:// 或 https:// 的有效接口地址 (Base URL)"
);

export const adminAIConfigSchema = z.object({
  apiKey: z.string().trim().max(1000).optional(),
  baseUrl: optionalUrlSchema,
  model: z.string().trim().min(1).max(200).optional(),
  visionModel: z.string().trim().min(1).max(200).optional(),
  asrModel: z.string().trim().min(1).max(200).optional(),

  chatApiKey: z.string().trim().max(1000).optional(),
  chatBaseUrl: optionalUrlSchema,
  chatModel: z.string().trim().min(1).max(200).optional(),

  visionApiKey: z.string().trim().max(1000).optional(),
  visionBaseUrl: optionalUrlSchema,

  asrApiKey: z.string().trim().max(1000).optional(),
  asrBaseUrl: optionalUrlSchema,

  systemPrompt: z.string().trim().min(20, "人设提示词至少需要 20 个字符").max(12_000, "人设提示词不能超过 12000 个字符").optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");
export const adminAIConfigTestSchema = z.object({
  apiKey: z.string().trim().max(1000).optional(),
  baseUrl: optionalUrlSchema,
  model: z.string().trim().min(1).max(200).optional(),
}).strict();
