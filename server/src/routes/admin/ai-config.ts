import { thinkingParameters } from "../../modules/aiRuntime/policy.js";
import { Router } from "express";
import { aiRuntimeService } from "../../modules/aiRuntime/runtime.js";
import { testAIConnection } from "../../services/aiService.js";
import { DEFAULT_AI_PERSONA_PROMPT } from "../../services/contextBuilder.js";
import { validateBody } from "../../middleware/validate.js";
import { adminAIConfigSchema, adminAIConfigTestSchema } from "../../validation/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { auditAdminAction } from "./shared.js";

export function createAdminAIConfigRouter() {
  const router = Router();

  router.get("/ai-config", async (_req, res) => {
    try {
      const settings = await aiRuntimeService().settings();
      const config = await aiRuntimeService().config(settings);
      const formatMasked = (key?: string) =>
        key ? (key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}` : "********") : "";

      res.json({
        maskedKey: formatMasked(config.apiKey),
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        visionModel: config.visionModel,
        asrModel: config.asrModel,
        runtimePolicy: await aiRuntimeService().runtimePolicy(),
        effectiveModels: [
          { role: "主助手", model: settings.AI_SUPERVISOR_MODEL?.trim() || config.chat.model, source: settings.AI_SUPERVISOR_MODEL?.trim() ? "角色设置" : "继承文本模型", baseUrl: config.chat.baseUrl },
          { role: "规划", model: settings.AI_NUTRITION_MODEL?.trim() || config.chat.model, source: settings.AI_NUTRITION_MODEL?.trim() ? "角色设置" : "继承文本模型", baseUrl: config.chat.baseUrl },
          { role: "图片", model: config.vision.model, source: settings.AI_VISION_MODEL ? "图片设置" : "环境变量或内置默认", baseUrl: config.vision.baseUrl },
          { role: "转写", model: config.asr.model, source: settings.AI_ASR_MODEL ? "转写设置" : "环境变量或内置默认", baseUrl: config.asr.baseUrl },
        ],
        agents: {
          supervisorModel: settings.AI_SUPERVISOR_MODEL?.trim() || config.chat.model,
          nutritionModel: settings.AI_NUTRITION_MODEL?.trim() || config.chat.model,
          recipeModel: settings.AI_RECIPE_MODEL?.trim() || config.chat.model,
          operationsModel: settings.AI_OPERATIONS_MODEL?.trim() || config.chat.model,
        },

        chat: {
          maskedKey: formatMasked(config.chat.apiKey),
          hasApiKey: !!config.chat.apiKey,
          baseUrl: config.chat.baseUrl,
          model: config.chat.model,
          isCustomKey: !!settings.AI_CHAT_API_KEY,
          isCustomUrl: !!settings.AI_CHAT_BASE_URL,
        },
        vision: {
          maskedKey: formatMasked(config.vision.apiKey),
          hasApiKey: !!config.vision.apiKey,
          baseUrl: config.vision.baseUrl,
          model: config.vision.model,
          isCustomKey: !!settings.AI_VISION_API_KEY,
          isCustomUrl: !!settings.AI_VISION_BASE_URL,
        },
        asr: {
          maskedKey: formatMasked(config.asr.apiKey),
          hasApiKey: !!config.asr.apiKey,
          baseUrl: config.asr.baseUrl,
          model: config.asr.model,
          isCustomKey: !!settings.AI_ASR_API_KEY,
          isCustomUrl: !!settings.AI_ASR_BASE_URL,
        },

        systemPrompt: settings.AI_SYSTEM_PROMPT?.trim() || DEFAULT_AI_PERSONA_PROMPT,
        isSystemPromptCustomized: !!settings.AI_SYSTEM_PROMPT?.trim(),
        isConfiguredFromDB: !!settings.AI_API_KEY,
      });
    } catch {
      res.status(500).json({ error: "获取 AI 配置失败" });
    }
  });

  router.put("/ai-config", validateBody(adminAIConfigSchema), async (req: AuthRequest, res) => {
    try {
      const {
        apiKey, baseUrl, model, visionModel, asrModel,
        supervisorModel, nutritionModel, recipeModel, operationsModel,
        chatApiKey, chatBaseUrl, chatModel,
        visionApiKey, visionBaseUrl,
        asrApiKey, asrBaseUrl,
        systemPrompt,
      } = req.body;

      const entries: Array<{ key: string; value: string }> = [];
      const add = (key: string, value: string | undefined) => {
        if (value !== undefined) entries.push({ key, value: value.trim() });
      };
      if (typeof apiKey === "string" && apiKey.trim()) add("AI_API_KEY", apiKey);
      add("AI_BASE_URL", baseUrl); add("AI_MODEL", model); add("AI_VISION_MODEL", visionModel); add("AI_ASR_MODEL", asrModel);
      add("AI_SUPERVISOR_MODEL", supervisorModel); add("AI_NUTRITION_MODEL", nutritionModel);
      add("AI_RECIPE_MODEL", recipeModel); add("AI_OPERATIONS_MODEL", operationsModel);
      add("AI_CHAT_API_KEY", chatApiKey); add("AI_CHAT_BASE_URL", chatBaseUrl);
      if (chatModel !== undefined) {
        add("AI_CHAT_MODEL", chatModel);
        add("AI_MODEL", chatModel);
      }
      add("AI_VISION_API_KEY", visionApiKey); add("AI_VISION_BASE_URL", visionBaseUrl);
      add("AI_ASR_API_KEY", asrApiKey); add("AI_ASR_BASE_URL", asrBaseUrl); add("AI_SYSTEM_PROMPT", systemPrompt);
      {
        const current = await aiRuntimeService().settings();
        const merged = { ...current, ...Object.fromEntries(entries.map((entry) => [entry.key, entry.value])) };
        const effective = await aiRuntimeService().config(merged);
        const policy = req.body.runtimePolicy || await aiRuntimeService().runtimePolicy();
        for (const role of ["SUPERVISOR", "RECIPE", "OPERATIONS"]) thinkingParameters(effective.chat.baseUrl, merged[`AI_${role}_MODEL`] || effective.chat.model, policy.main);
        thinkingParameters(effective.chat.baseUrl, merged.AI_NUTRITION_MODEL || effective.chat.model, policy.planner);
        thinkingParameters(effective.vision.baseUrl, effective.vision.model, policy.vision);
        if (policy.asr.thinking !== "default") throw new Error("语音转写不支持思考策略，请选择提供商默认");
        entries.push({ key: "AI_RUNTIME_POLICY", value: JSON.stringify(policy) });
      }
      await aiRuntimeService().saveSettings(entries);

      if (req.userId) {
        await auditAdminAction(req, {
          action: "ai_config.update",
          resourceType: "ai_config",
          resourceId: "global",
          summary: "更新 AI 模型服务配置",
          details: {
            apiKeyChanged: typeof apiKey === "string" && !!apiKey.trim(),
            baseUrlChanged: baseUrl !== undefined,
            modelChanged: model !== undefined,
            visionModelChanged: visionModel !== undefined,
            asrModelChanged: asrModel !== undefined,
            supervisorModelChanged: supervisorModel !== undefined,
            nutritionModelChanged: nutritionModel !== undefined,
            recipeModelChanged: recipeModel !== undefined,
            operationsModelChanged: operationsModel !== undefined,
            systemPromptChanged: systemPrompt !== undefined,
          },
        });
      }
      res.json({ success: true, message: "AI 配置更新成功" });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error && /思考|参数/.test(error.message) ? error.message : "更新 AI 配置失败，请检查模型与策略配置" });
    }
  });

  router.post("/ai-config/test", validateBody(adminAIConfigTestSchema), async (req, res) => {
    try {
      const { apiKey, baseUrl, model } = req.body;
      const result = await testAIConnection({ apiKey, baseUrl, model });
      res.json({ success: true, reply: result.reply, latencyMs: result.latencyMs });
    } catch (error) {
      console.error("[Admin AI Connection Test Error]", error instanceof Error ? error.message : error);
      res.status(400).json({ success: false, error: "连接测试失败，请检查地址、模型和凭据" });
    }
  });

  return router;
}
