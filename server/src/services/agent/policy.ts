import { z } from "zod";
import type { AgentActionProposal, AgentActionType } from "./types.js";
import type { UserContext } from "../contextBuilder.js";

const lowRiskActions = new Set<AgentActionType>([
  "create_meal_plan",
  "update_meal_plan",
  "add_shopping_items",
  "update_shopping_item",
]);

const highRiskActions = new Set<AgentActionType>([
  "delete_meal_plan",
  "delete_shopping_item",
  "record_diet_meal",
  "add_inventory_item",
  "update_inventory_item",
  "consume_inventory_items",
  "add_kitchenware_item",
  "submit_recipe",
  "record_health_log",
]);

export const agentActionProposalSchema = z.object({
  actionType: z.enum([
    "create_meal_plan", "update_meal_plan", "add_shopping_items", "update_shopping_item",
    "delete_meal_plan", "delete_shopping_item", "record_diet_meal", "add_inventory_item",
    "update_inventory_item", "consume_inventory_items", "add_kitchenware_item", "submit_recipe",
    "record_health_log",
  ]),
  summary: z.string().trim().min(1).max(300),
  payload: z.record(z.string(), z.unknown()),
}).strict();

const requiredText = z.string().trim().min(1);
const optionalNonnegativeNumber = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? undefined : Number(value),
  z.number().finite().nonnegative().optional(),
);

function normalizeMealType(value: unknown) {
  const mealType = typeof value === "string" ? value.trim() : "";
  return ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" } as Record<string, string>)[mealType.toLocaleLowerCase()] || mealType || "午餐";
}

function normalizePayload(actionType: AgentActionType, raw: Record<string, unknown>) {
  if (actionType === "record_diet_meal") {
    const rawDate = raw.recordedAt ?? raw.date;
    const recordedAt = typeof rawDate === "string" && !["today", "今天"].includes(rawDate.trim().toLocaleLowerCase())
      ? rawDate.trim()
      : undefined;
    return z.object({
      foodName: requiredText.max(120),
      mealType: requiredText.max(20),
      amount: requiredText.max(80),
      recordedAt: z.string().trim().min(1).max(30).optional(),
      recordedTime: z.string().trim().min(1).max(20).optional(),
      calories: optionalNonnegativeNumber,
      protein: optionalNonnegativeNumber,
      carbs: optionalNonnegativeNumber,
      fat: optionalNonnegativeNumber,
    }).parse({
      foodName: raw.foodName ?? raw.dishName ?? raw.name,
      mealType: normalizeMealType(raw.mealType),
      amount: raw.amount ?? raw.portion ?? "1 份",
      recordedAt,
      recordedTime: raw.recordedTime,
      calories: raw.calories,
      protein: raw.protein,
      carbs: raw.carbs,
      fat: raw.fat,
    });
  }

  if (actionType === "add_inventory_item") {
    return z.object({
      name: requiredText.max(120),
      expireDays: z.coerce.number().int().min(0).max(3650).default(7),
      category: z.string().trim().max(80).optional(),
      quantity: z.string().trim().max(80).optional(),
      location: z.string().trim().max(80).optional(),
    }).parse({ ...raw, name: raw.name ?? raw.foodName });
  }

  validateRequiredPayload(actionType, raw);
  return raw;
}

function validateRequiredPayload(actionType: AgentActionType, payload: Record<string, unknown>) {
  const idSchema = z.coerce.number().int().positive();
  switch (actionType) {
    case "create_meal_plan":
      z.object({ items: z.array(z.record(z.string(), z.unknown())).default([]) }).passthrough().parse(payload);
      break;
    case "update_meal_plan":
    case "delete_meal_plan":
      z.object({ planId: requiredText.max(120) }).passthrough().parse(payload);
      break;
    case "add_shopping_items":
      z.object({ items: z.array(z.object({ name: requiredText }).passthrough()).min(1) }).passthrough().parse(payload);
      break;
    case "update_shopping_item":
    case "delete_shopping_item":
      z.object({ itemId: requiredText.max(120) }).passthrough().parse(payload);
      break;
    case "update_inventory_item":
      z.object({ itemId: idSchema }).passthrough().parse(payload);
      break;
    case "consume_inventory_items":
      z.object({ itemIds: z.array(idSchema).min(1) }).passthrough().parse(payload);
      break;
    case "add_kitchenware_item":
      z.object({ name: requiredText }).passthrough().parse(payload);
      break;
    case "submit_recipe":
      z.object({ title: requiredText }).passthrough().parse(payload);
      break;
    case "record_health_log": {
      const parsed = z.object({
        weightKg: optionalNonnegativeNumber,
        bodyFatPercentage: optionalNonnegativeNumber,
        waterMl: optionalNonnegativeNumber,
      }).passthrough().parse(payload);
      if (parsed.weightKg === undefined && parsed.bodyFatPercentage === undefined && parsed.waterMl === undefined) {
        throw new Error("健康记录至少需要体重、体脂率或饮水量中的一项");
      }
      break;
    }
    default:
      break;
  }
}

export type AllergySafetyBlock = {
  allergyName: string;
  severe: boolean;
  reply: string;
};

const allergyAliases: Record<string, string[]> = {
  "花生": ["花生", "花生酱", "花生醬", "花生碎", "花身", "花牲", "花生将", "花生醬料"],
  "坚果": ["坚果", "堅果", "花生", "花生酱", "花生醬", "花生碎", "花身", "花牲", "花生将", "腰果", "核桃", "杏仁", "榛子", "开心果", "開心果", "碧根果"],
  "海鲜": ["海鲜", "海鮮", "虾", "蝦", "蟹", "贝", "貝", "牡蛎", "生蚝"],
  "乳制品": ["乳制品", "乳製品", "牛奶", "奶酪", "芝士", "酸奶"],
};

function normalizedSafetyText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

function isSevere(value: string) {
  const severity = normalizedSafetyText(value);
  return ["severe", "high", "重度", "严重", "嚴重"].some((term) => severity.includes(term));
}

function allergyTerms(name: string) {
  const normalizedName = normalizedSafetyText(name);
  const aliases = Object.entries(allergyAliases).find(([key]) => normalizedName.includes(normalizedSafetyText(key)))?.[1] || [];
  return [...new Set([name, ...aliases].map(normalizedSafetyText).filter(Boolean))];
}

function allergySafetyReply(name: string, severe: boolean) {
  const severity = severe ? "严重" : "";
  return `你的健康档案已记录对“${name}”${severity}过敏，因此我不会生成、保存或采购任何可能含该过敏原的餐单或采购项，也不建议少量尝试。请同时核对加工食品标签，并留意共用刀具、砧板、容器和生产线带来的交叉污染风险。可改用已确认不过敏的替代食材（例如葵花籽酱）；如曾有严重反应，请遵循医生给出的应急方案。`;
}

export function findAllergyConflict(text: string, ctx: UserContext): AllergySafetyBlock | null {
  const normalizedText = normalizedSafetyText(text);
  for (const allergy of ctx.healthProfile?.allergies || []) {
    const name = allergy.name.trim();
    if (!name || !allergyTerms(name).some((term) => normalizedText.includes(term))) continue;
    const severe = isSevere(allergy.severity);
    return { allergyName: name, severe, reply: allergySafetyReply(name, severe) };
  }
  return null;
}

export class AgentSafetyConflictError extends Error {
  readonly block: AllergySafetyBlock;

  constructor(block: AllergySafetyBlock) {
    super(`操作包含已记录的过敏或不耐受食材：${block.allergyName}`);
    this.name = "AgentSafetyConflictError";
    this.block = block;
  }
}

export function normalizeActionProposal(value: unknown): AgentActionProposal {
  const parsed = agentActionProposalSchema.parse(value);
  return {
    ...parsed,
    payload: normalizePayload(parsed.actionType, parsed.payload),
    riskLevel: lowRiskActions.has(parsed.actionType) ? "low" : highRiskActions.has(parsed.actionType) ? "high" : "forbidden",
  };
}

export function validateAgentActions(actions: unknown[], ctx: UserContext): AgentActionProposal[] {
  const normalized = actions.slice(0, 150).map(normalizeActionProposal);
  for (const action of normalized) {
    if (action.riskLevel === "forbidden") throw new Error(`禁止的 Agent 操作：${action.actionType}`);
    if (!["create_meal_plan", "update_meal_plan", "add_shopping_items", "submit_recipe"].includes(action.actionType)) continue;
    const conflict = findAllergyConflict(JSON.stringify(action.payload), ctx);
    if (conflict) throw new AgentSafetyConflictError(conflict);
  }
  return normalized;
}

export function normalizePrivacyDisclosure(reply: string, actionCount: number, request: string) {
  const asksForNoBusinessWrite = /(不要保存|不要写入|不保存|只给建议|仅给建议)/.test(request);
  if (!asksForNoBusinessWrite || actionCount > 0) return reply;
  const cleaned = reply
    .replace(/(?:本次|此次)?(?:咨询|对话|请求)?(?:中)?[，,：:]?\s*(?:我|系统)?(?:不会|没有|未)(?:保存|存储|记录)(?:您|你)?的?任何个人数据[。！!]?/g, "")
    .trim();
  const disclosure = "本次未创建餐单、采购、库存、饮食或健康业务记录；本次对话与 Agent Run 仍会按隐私说明保存。";
  return cleaned ? `${cleaned}\n\n${disclosure}` : disclosure;
}

export function hasHighRiskActions(actions: AgentActionProposal[]) {
  return actions.some((action) => action.riskLevel === "high");
}
