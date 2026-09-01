import { Router } from "express";
import { getSystemSetting, setSystemSetting } from "../../storage/db.js";
import { getAIConfig, testAIConnection } from "../../services/aiService.js";
import { DEFAULT_AI_PERSONA_PROMPT } from "../../services/contextBuilder.js";
import { validateBody } from "../../middleware/validate.js";
import { adminAIConfigSchema, adminAIConfigTestSchema } from "../../validation/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { auditAdminAction } from "./shared.js";

export function createAdminAIConfigRouter() {
  const router = Router();

  router.get("/ai-config", (_req, res) => {
    try {
      const config = getAIConfig();
      const formatMasked = (key?: string) =>
        key ? (key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}` : "********") : "";

      res.json({
        maskedKey: formatMasked(config.apiKey),
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        visionModel: config.visionModel,
        asrModel: config.asrModel,
        agents: {
          supervisorModel: getSystemSetting("AI_SUPERVISOR_MODEL").trim() || config.chat.model,
          nutritionModel: getSystemSetting("AI_NUTRITION_MODEL").trim() || config.chat.model,
          recipeModel: getSystemSetting("AI_RECIPE_MODEL").trim() || config.chat.model,
          operationsModel: getSystemSetting("AI_OPERATIONS_MODEL").trim() || config.chat.model,
        },

        chat: {
          maskedKey: formatMasked(config.chat.apiKey),
          hasApiKey: !!config.chat.apiKey,
          baseUrl: config.chat.baseUrl,
          model: config.chat.model,
          isCustomKey: !!getSystemSetting("AI_CHAT_API_KEY"),
          isCustomUrl: !!getSystemSetting("AI_CHAT_BASE_URL"),
        },
        vision: {
          maskedKey: formatMasked(config.vision.apiKey),
          hasApiKey: !!config.vision.apiKey,
          baseUrl: config.vision.baseUrl,
          model: config.vision.model,
          isCustomKey: !!getSystemSetting("AI_VISION_API_KEY"),
          isCustomUrl: !!getSystemSetting("AI_VISION_BASE_URL"),
        },
        asr: {
          maskedKey: formatMasked(config.asr.apiKey),
          hasApiKey: !!config.asr.apiKey,
          baseUrl: config.asr.baseUrl,
          model: config.asr.model,
          isCustomKey: !!getSystemSetting("AI_ASR_API_KEY"),
          isCustomUrl: !!getSystemSetting("AI_ASR_BASE_URL"),
        },

        systemPrompt: getSystemSetting("AI_SYSTEM_PROMPT").trim() || DEFAULT_AI_PERSONA_PROMPT,
        isSystemPromptCustomized: !!getSystemSetting("AI_SYSTEM_PROMPT").trim(),
        isConfiguredFromDB: !!getSystemSetting("AI_API_KEY"),
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

      if (typeof apiKey === "string" && apiKey.trim()) setSystemSetting("AI_API_KEY", apiKey.trim());
      if (baseUrl !== undefined) setSystemSetting("AI_BASE_URL", baseUrl.trim());
      if (model !== undefined) setSystemSetting("AI_MODEL", model.trim());
      if (visionModel !== undefined) setSystemSetting("AI_VISION_MODEL", visionModel.trim());
      if (asrModel !== undefined) setSystemSetting("AI_ASR_MODEL", asrModel.trim());
      if (supervisorModel !== undefined) setSystemSetting("AI_SUPERVISOR_MODEL", supervisorModel.trim());
      if (nutritionModel !== undefined) setSystemSetting("AI_NUTRITION_MODEL", nutritionModel.trim());
      if (recipeModel !== undefined) setSystemSetting("AI_RECIPE_MODEL", recipeModel.trim());
      if (operationsModel !== undefined) setSystemSetting("AI_OPERATIONS_MODEL", operationsModel.trim());

      if (typeof chatApiKey === "string") setSystemSetting("AI_CHAT_API_KEY", chatApiKey.trim());
      if (chatBaseUrl !== undefined) setSystemSetting("AI_CHAT_BASE_URL", chatBaseUrl.trim());
      if (chatModel !== undefined) {
        setSystemSetting("AI_CHAT_MODEL", chatModel.trim());
        setSystemSetting("AI_MODEL", chatModel.trim());
      }

      if (typeof visionApiKey === "string") setSystemSetting("AI_VISION_API_KEY", visionApiKey.trim());
      if (visionBaseUrl !== undefined) setSystemSetting("AI_VISION_BASE_URL", visionBaseUrl.trim());

      if (typeof asrApiKey === "string") setSystemSetting("AI_ASR_API_KEY", asrApiKey.trim());
      if (asrBaseUrl !== undefined) setSystemSetting("AI_ASR_BASE_URL", asrBaseUrl.trim());

      if (systemPrompt !== undefined) setSystemSetting("AI_SYSTEM_PROMPT", systemPrompt.trim());

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
    } catch {
      res.status(500).json({ error: "更新 AI 配置失败" });
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
