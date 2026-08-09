import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRoutes from "./routes/auth.js";
import inventoryRoutes from "./routes/inventory.js";
import dietRecordsRoutes from "./routes/diet-records.js";
import healthDataRoutes from "./routes/health-data.js";
import recipesRoutes from "./routes/recipes.js";
import foodsRoutes from "./routes/foods.js";
import communityRoutes from "./routes/community.js";
import adminRoutes from "./routes/admin.js";
import aiRoutes from "./routes/ai.js";
import kitchenwareRoutes from "./routes/kitchenware.js";
import notificationsRoutes from "./routes/notifications.js";
import mediaRoutes from "./routes/media.js";
import householdRoutes from "./routes/households.js";
import feedbackRoutes from "./routes/feedback.js";
import { initDatabase } from "./storage/db.js";
import { errorHandler, notFoundHandler, sendError } from "./utils/http.js";
import { requestContext } from "./middleware/requestContext.js";
import { errorEnvelope } from "./middleware/errorEnvelope.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { SERVER_BUILD_TIME, SERVER_VERSION } from "./version.js";

const staticAssetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

export function createApp() {
  initDatabase();
  const app = express();
  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:8080,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(requestContext);
  app.use(requestLogger);
  app.use(errorEnvelope);
  app.use((req, res, next) => {
    if (process.env.NODE_ENV === "production" && process.env.REQUIRE_HTTPS !== "0" && !req.secure) {
      return sendError(res, 426, "生产环境仅允许 HTTPS", "HTTPS_REQUIRED");
    }
    return next();
  });
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  }));
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  app.use("/media", express.static(staticAssetsDir, { maxAge: "7d" }));

  app.get("/api/v1/health", (_req, res) => res.status(200).json({ status: "ok" }));
  app.get("/api/v1/version", (req, res) => res.status(200).json({
    serverVersion: SERVER_VERSION,
    serverBuildTime: SERVER_BUILD_TIME,
    clientVersion: req.get("x-client-version") || null,
    clientBuildTime: req.get("x-client-build-time") || null,
  }));
  app.get("/api/v1/ai-data-policy", (_req, res) => res.json({
    providerName: process.env.AI_PROVIDER_NAME?.trim() || "由部署运营方配置的 AI 模型服务商",
    providerPrivacyUrl: process.env.AI_PROVIDER_PRIVACY_URL?.trim() || null,
    processingRegion: process.env.AI_PROCESSING_REGION?.trim() || "以部署运营方正式披露为准",
    conversationRetentionDays: Math.max(1, Number(process.env.AI_CONVERSATION_RETENTION_DAYS) || 90),
    supportContact: process.env.PRIVACY_SUPPORT_CONTACT?.trim() || "应用商店开发者联系方式",
  }));
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/inventory", inventoryRoutes);
  app.use("/api/v1/diet-records", dietRecordsRoutes);
  app.use("/api/v1/health-data", healthDataRoutes);
  app.use("/api/v1/recipes", recipesRoutes);
  app.use("/api/v1/foods", foodsRoutes);
  app.use("/api/v1/community", communityRoutes);
  app.use("/api/v1/admin", adminRoutes);
  app.use("/api/v1/ai", aiRoutes);
  app.use("/api/v1/kitchenware", kitchenwareRoutes);
  app.use("/api/v1/notifications", notificationsRoutes);
  app.use("/api/v1/media", mediaRoutes);
  app.use("/api/v1/households", householdRoutes);
  app.use("/api/v1/feedback", feedbackRoutes);

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      return sendError(res, 400, "请求 JSON 格式错误", "INVALID_JSON");
    }
    if (typeof error === "object" && error && "type" in error && error.type === "entity.too.large") {
      return sendError(res, 413, "请求内容过大", "PAYLOAD_TOO_LARGE");
    }
    return next(error);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
