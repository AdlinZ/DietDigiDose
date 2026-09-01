import type { AIRuntimeRepository } from "./repository.js";
import type { AIConfig, AIUsageInput } from "./types.js";

export const AI_SETTING_KEYS = [
  "AI_API_KEY", "AI_BASE_URL", "AI_MODEL",
  "AI_CHAT_API_KEY", "AI_CHAT_BASE_URL", "AI_CHAT_MODEL",
  "AI_VISION_API_KEY", "AI_VISION_BASE_URL", "AI_VISION_MODEL",
  "AI_ASR_API_KEY", "AI_ASR_BASE_URL", "AI_ASR_MODEL",
  "AI_SUPERVISOR_MODEL", "AI_NUTRITION_MODEL", "AI_RECIPE_MODEL", "AI_OPERATIONS_MODEL",
  "AI_SYSTEM_PROMPT",
] as const;

export type AIAgentRole = "SUPERVISOR" | "NUTRITION" | "RECIPE" | "OPERATIONS";

export class AIRuntimeService {
  private readonly repository: AIRuntimeRepository;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(repository: AIRuntimeRepository, environment: NodeJS.ProcessEnv = process.env) {
    this.repository = repository;
    this.environment = environment;
  }

  settings(keys: string[] = [...AI_SETTING_KEYS]) { return this.repository.settings(keys); }

  saveSettings(entries: Array<{ key: string; value: string }>) {
    return entries.length ? this.repository.saveSettings(entries) : Promise.resolve();
  }

  async config(settings?: Record<string, string>): Promise<AIConfig> {
    const values = settings || await this.settings();
    return this.resolveConfig(values);
  }

  async agentConfig(agent: AIAgentRole) {
    const values = await this.settings();
    const config = this.resolveConfig(values);
    return { ...config.chat, model: values[`AI_${agent}_MODEL`]?.trim() || config.chat.model };
  }

  private resolveConfig(values: Record<string, string>): AIConfig {
    const globalKey = values.AI_API_KEY || this.environment.AI_API_KEY || this.environment.OPENAI_API_KEY || "";
    const globalUrl = (values.AI_BASE_URL || this.environment.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const chat = {
      apiKey: values.AI_CHAT_API_KEY || globalKey,
      baseUrl: (values.AI_CHAT_BASE_URL || globalUrl).replace(/\/$/, ""),
      model: values.AI_CHAT_MODEL || values.AI_MODEL || this.environment.AI_MODEL || "deepseek-ai/DeepSeek-V3",
    };
    const vision = {
      apiKey: values.AI_VISION_API_KEY || globalKey,
      baseUrl: (values.AI_VISION_BASE_URL || globalUrl).replace(/\/$/, ""),
      model: values.AI_VISION_MODEL || this.environment.AI_VISION_MODEL || "Qwen/Qwen2.5-VL-72B-Instruct",
    };
    const asr = {
      apiKey: values.AI_ASR_API_KEY || globalKey,
      baseUrl: (values.AI_ASR_BASE_URL || globalUrl).replace(/\/$/, ""),
      model: values.AI_ASR_MODEL || this.environment.AI_ASR_MODEL || "FunAudioLLM/SenseVoiceSmall",
    };
    return { apiKey: globalKey, baseUrl: globalUrl, model: chat.model, visionModel: vision.model, asrModel: asr.model,
      chat, vision, asr };
  }

  async recordUsage(input: AIUsageInput) {
    const promptTokens = Math.max(0, input.promptTokens || 0);
    const completionTokens = Math.max(0, input.completionTokens || 0);
    const totalTokens = Math.max(0, input.totalTokens ?? promptTokens + completionTokens);
    const inputRate = Number(this.environment.AI_INPUT_COST_PER_MILLION_USD) || 0;
    const outputRate = Number(this.environment.AI_OUTPUT_COST_PER_MILLION_USD) || 0;
    const estimatedCostUsd = input.estimatedCostUsd ?? (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000;
    try {
      await this.repository.recordUsage({ ...input, promptTokens, completionTokens, totalTokens,
        latencyMs: input.latencyMs || 0, success: input.success !== false,
        estimatedCostUsd: Math.max(0, estimatedCostUsd), failureReason: input.failureReason?.slice(0, 500) });
    } catch (error) {
      console.error("[AI usage persistence error]", error instanceof Error ? error.message : error);
    }
  }
}
