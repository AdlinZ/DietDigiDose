import { z } from "zod";

const trimmedString = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label}不能为空`).max(max, `${label}不能超过 ${max} 个字符`);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD").refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  "日期无效",
);

const optionalImage = z.string().trim().max(4_000_000, "图片过大").nullable().optional();
const nutrition = z.number().finite().min(0).max(100_000).nullable().optional();

export const registerSchema = z.object({
  identifier: trimmedString(1, 254, "邮箱或手机号"),
  password: z.string()
    .min(12, "密码长度不能少于 12 位")
    .max(128, "密码不能超过 128 位")
    .regex(/[A-Za-z]/, "密码必须包含字母")
    .regex(/\d/, "密码必须包含数字"),
}).strict();

export const loginSchema = z.object({
  identifier: z.string().trim().max(254).optional(),
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1).max(128),
}).strict().refine((value) => value.identifier || value.username, {
  message: "请输入登录账号",
  path: ["identifier"],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string()
    .min(12, "新密码长度不能少于 12 位")
    .max(128, "新密码不能超过 128 位")
    .regex(/[A-Za-z]/, "新密码必须包含字母")
    .regex(/\d/, "新密码必须包含数字"),
}).strict();

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "请输入当前密码").max(128),
  confirmation: z.literal("DELETE", { message: "账号删除确认无效" }),
}).strict();

export const profileSchema = z.object({
  avatar_url: z.string().trim().max(4_000_000, "头像图片过大").nullable().optional(),
  bio: z.string().trim().max(500, "个人简介不能超过 500 个字符").nullable().optional(),
  daily_calories_target: z.number().int().min(500).max(10_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

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

export const dietRecordCreateSchema = z.object({
  meal_type: z.enum(["早餐", "午餐", "晚餐", "加餐"]),
  food_name: trimmedString(1, 120, "食物名称"),
  amount: trimmedString(1, 40, "分量").default("1份"),
  calories: nutrition,
  protein: nutrition,
  carbs: nutrition,
  fat: nutrition,
  recorded_at: isoDate.optional(),
  image_url: optionalImage,
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
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个需要更新的字段");

export const customFoodSchema = z.object({
  name: trimmedString(1, 120, "食材名称"),
  calories_100g: z.number().finite().min(0).max(10_000),
  protein_100g: z.number().finite().min(0).max(1000).default(0),
  carbs_100g: z.number().finite().min(0).max(1000).default(0),
  fat_100g: z.number().finite().min(0).max(1000).default(0),
}).strict();

const communityImage = z.string().trim().min(1).max(4_000_000, "图片过大");
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
export const aiChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(12_000),
  }).strict()).max(50).optional(),
  prompt: z.string().trim().min(1).max(12_000).optional(),
  sessionId: z.string().trim().max(120).optional(),
}).strict().refine((value) => value.prompt || value.messages?.length, "必须提供 prompt 或 messages");

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
  currentStep: z.number().int().min(0).max(1000).default(0),
  recipeTitle: z.string().trim().max(120).default(""),
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
export const adminKitchenwareStatusSchema = z.object({
  status: z.enum(["常用", "良好", "需保养", "维修中", "闲置"]),
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
export const adminAIConfigSchema = z.object({
  apiKey: z.string().trim().max(1000).optional(),
  baseUrl: z.string().trim().url().max(2000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  visionModel: z.string().trim().min(1).max(200).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个配置字段");
export const adminAIConfigTestSchema = z.object({
  apiKey: z.string().trim().max(1000).optional(),
  baseUrl: z.string().trim().url().max(2000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
}).strict();
