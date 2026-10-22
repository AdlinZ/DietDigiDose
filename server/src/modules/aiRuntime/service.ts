import { sanitizeAIErrorMessage } from "../../services/aiErrors.js";
import { RESOURCE_SETTING_KEY, legacyResourceDocument, resourceDocumentSchema, resourceUpdateSchema, applyResourceUpdate, publicResourceDocument, resolveResourceService, serviceIds, serviceCatalog, validateResourceDocument, type ServiceId } from "./resources.js";
import { thinkingParameters, runtimePolicySchema } from "./policy.js";
import type { AIRuntimeRepository } from "./repository.js";
import type { AIConfig, AIUsageInput } from "./types.js";

export const AI_SETTING_KEYS = [
  "AI_API_KEY", "AI_BASE_URL", "AI_MODEL",
  "AI_CHAT_API_KEY", "AI_CHAT_BASE_URL", "AI_CHAT_MODEL",
  "AI_VISION_API_KEY", "AI_VISION_BASE_URL", "AI_VISION_MODEL",
  "AI_ASR_API_KEY", "AI_ASR_BASE_URL", "AI_ASR_MODEL",
  "AI_SUPERVISOR_MODEL", "AI_NUTRITION_MODEL", "AI_RECIPE_MODEL", "AI_OPERATIONS_MODEL",
  "AI_SYSTEM_PROMPT", "AI_RUNTIME_POLICY", RESOURCE_SETTING_KEY,
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
    const legacy = this.resolveConfig(values);
    const document = this.resourceDocument(values);
    const resolve = (service: ServiceId) => {
      const { apiKey, baseUrl, model } = resolveResourceService(document, service, legacy, values);
      return { apiKey, baseUrl, model };
    };
    const chat = resolve("chat"), vision = resolve("vision"), asr = resolve("asr");
    return { ...legacy, model: chat.model, visionModel: vision.model, asrModel: asr.model, chat, vision, asr };
  }

  async runtimePolicy() {
    const values = await this.settings();
    return runtimePolicySchema.parse(values.AI_RUNTIME_POLICY ? JSON.parse(values.AI_RUNTIME_POLICY) : {});
  }

  async agentConfig(agent: AIAgentRole, settings?: Record<string, string>) {
    const values = settings || await this.settings();
    const resolved = resolveResourceService(this.resourceDocument(values), agent.toLowerCase() as ServiceId, this.resolveConfig(values), values);
    return { apiKey: resolved.apiKey, baseUrl: resolved.baseUrl, model: resolved.model };
  }

  private resourceDocument(values: Record<string, string>) {
    const document = values[RESOURCE_SETTING_KEY]
      ? resourceDocumentSchema.parse(JSON.parse(values[RESOURCE_SETTING_KEY])) : legacyResourceDocument();
    validateResourceDocument(document);
    return document;
  }

  /** Idempotent, atomic metadata migration; secrets and legacy/env fallback remain in their existing storage. */
  async migrateResources() {
    await this.repository.compareAndSaveSetting(RESOURCE_SETTING_KEY, null, JSON.stringify(legacyResourceDocument()));
    return this.resourceConfiguration();
  }

  async resourceConfiguration() {
    const values = await this.settings();
    const document = this.resourceDocument(values);
    const legacy = this.resolveConfig(values);
    const effective = Object.fromEntries(serviceIds.map(service => {
      const { apiKey, ...resolved } = resolveResourceService(document, service, legacy, values);
      return [service, { ...resolved, hasApiKey: !!apiKey, maskedKey: apiKey ? "********" : "" }];
    }));
    return { ...publicResourceDocument(document), migrated: !!values[RESOURCE_SETTING_KEY], catalog: serviceCatalog, effective };
  }

  async saveResourceConfiguration(input: unknown) {
    const update = resourceUpdateSchema.parse(input);
    const values = await this.settings();
    const previous = this.resourceDocument(values);
    if (update.revision !== previous.revision) throw new Error("配置版本已变更，请重新加载");
    const next = applyResourceUpdate(update, previous);
    const policy = runtimePolicySchema.parse(values.AI_RUNTIME_POLICY ? JSON.parse(values.AI_RUNTIME_POLICY) : {});
    for (const service of serviceIds) {
      const effective = resolveResourceService(next, service, this.resolveConfig(values), values);
      const modelPolicy = service === "vision" ? policy.vision : service === "asr" ? policy.asr : service === "nutrition" ? policy.planner : policy.main;
      if (service === "asr" && modelPolicy.thinking !== "default") throw new Error("语音转写不支持思考策略");
      thinkingParameters(effective.baseUrl, effective.model, modelPolicy);
    }
    if (!await this.repository.compareAndSaveSetting(RESOURCE_SETTING_KEY, values[RESOURCE_SETTING_KEY] ?? null, JSON.stringify(next))) {
      throw new Error("配置版本已变更，请重新加载");
    }
    return this.resourceConfiguration();
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
        estimatedCostUsd: Math.max(0, estimatedCostUsd), failureReason: input.failureReason ? sanitizeAIErrorMessage(input.failureReason) : undefined });
    } catch (error) {
      console.error("[AI usage persistence error]", error instanceof Error ? error.message : error);
    }
  }
}
