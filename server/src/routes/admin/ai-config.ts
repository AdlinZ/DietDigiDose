import { Router } from "express";
import { getSystemSetting, logAdminAction, setSystemSetting } from "../../storage/db.js";
import { getAIConfig, testAIConnection } from "../../services/aiService.js";
import { validateBody } from "../../middleware/validate.js";
import { adminAIConfigSchema, adminAIConfigTestSchema } from "../../validation/schemas.js";
import type { AuthRequest } from "../../middleware/auth.js";

export function createAdminAIConfigRouter() {
  const router = Router();

  router.get("/ai-config", (_req, res) => {
    try {
      const config = getAIConfig();
      const maskedKey = config.apiKey
        ? config.apiKey.length > 8
          ? `${config.apiKey.slice(0, 4)}****${config.apiKey.slice(-4)}`
          : "********"
        : "";
      res.json({
        maskedKey,
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        visionModel: config.visionModel,
        isConfiguredFromDB: !!getSystemSetting("AI_API_KEY"),
      });
    } catch {
      res.status(500).json({ error: "获取 AI 配置失败" });
    }
  });

  router.put("/ai-config", validateBody(adminAIConfigSchema), (req: AuthRequest, res) => {
    try {
      const { apiKey, baseUrl, model, visionModel } = req.body;
      if (typeof apiKey === "string" && apiKey.trim()) setSystemSetting("AI_API_KEY", apiKey.trim());
      if (baseUrl !== undefined) setSystemSetting("AI_BASE_URL", baseUrl.trim());
      if (model !== undefined) setSystemSetting("AI_MODEL", model.trim());
      if (visionModel !== undefined) setSystemSetting("AI_VISION_MODEL", visionModel.trim());
      if (req.userId) {
        logAdminAction({
          adminUserId: req.userId,
          action: "ai_config.update",
          resourceType: "ai_config",
          resourceId: "global",
          summary: "更新 AI 模型服务配置",
          details: {
            apiKeyChanged: typeof apiKey === "string" && !!apiKey.trim(),
            baseUrlChanged: baseUrl !== undefined,
            modelChanged: model !== undefined,
            visionModelChanged: visionModel !== undefined,
          },
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
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
