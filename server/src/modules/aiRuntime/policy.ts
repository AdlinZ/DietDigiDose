import { z } from "zod";

export const modelPolicySchema = z.object({
  thinking: z.enum(["default", "off", "high", "max"]).default("default"),
  maxTokens: z.number().int().min(128).max(16000).default(3000),
  timeoutMs: z.number().int().min(1000).max(180000).default(60000),
  retries: z.number().int().min(0).max(2).default(0),
}).strict();
export type ModelPolicy = z.infer<typeof modelPolicySchema>;
export const runtimePolicySchema = z.object({
  main: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  planner: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  vision: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  asr: modelPolicySchema.default(() => modelPolicySchema.parse({})),
  deadlineMs: z.number().int().min(1000).max(300000).default(180000),
  maxModelCalls: z.number().int().min(1).max(30).default(12),
  maxToolCalls: z.number().int().min(1).max(12).default(6),
}).strict();

// Explicit documented parameter support, not a claim of account availability.
// Source checked 2026-09-18: SiliconFlow chat-completions-post.
const effortModels = new Set(["Pro/deepseek-ai/DeepSeek-V4", "deepseek-ai/DeepSeek-V4-Flash", "Pro/zai-org/GLM-5.2"]);
export function thinkingParameters(baseUrl: string, model: string, policy: ModelPolicy) {
  if (policy.thinking === "default") return {};
  const host = new URL(baseUrl).hostname;
  if (!["api.siliconflow.cn", "api.siliconflow.com"].includes(host) || !effortModels.has(model)) {
    throw new Error(`模型 ${model} 的思考参数尚未验证，请选择“提供商默认”或使用已确认支持的模型`);
  }
  return policy.thinking === "off" ? { enable_thinking: false }
    : { enable_thinking: true, reasoning_effort: policy.thinking };
}

export function isTransientModelError(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  if (status) return status === 429 || status >= 500;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(error instanceof Error ? error.message : String(error));
}
