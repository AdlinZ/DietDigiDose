import { randomUUID } from "node:crypto";
import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  getRecipeRecommendationPage,
  RECIPE_SCORING_VERSION,
  RECIPE_CANDIDATE_VERSION,
} from "../services/recipeRecommendations.js";
import { db } from "../storage/db.js";
import { sendError } from "../utils/http.js";
import { recipeRecommendationEventSchema, recipeRecommendationSchema } from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);

router.get("/versions", (_req, res) => res.json({
  scoringVersion: RECIPE_SCORING_VERSION,
  candidateVersion: RECIPE_CANDIDATE_VERSION,
}));

router.post("/recipes", validateBody(recipeRecommendationSchema), (req: AuthRequest, res) => {
  try {
    return res.json(getRecipeRecommendationPage(req.userId!, req.body));
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CURSOR") {
      return sendError(res, 400, "推荐游标格式不正确", "INVALID_RECOMMENDATION_CURSOR");
    }
    if (error instanceof Error && error.message === "EXPIRED_CURSOR") {
      return sendError(res, 410, "本轮推荐已过期，请重新获取", "RECOMMENDATION_CURSOR_EXPIRED");
    }
    throw error;
  }
});

router.post("/events", validateBody(recipeRecommendationEventSchema), (req: AuthRequest, res) => {
  const userId = req.userId!;
  const existing = db.prepare("SELECT * FROM recipe_recommendation_events WHERE user_id = ? AND idempotency_key = ?")
    .get(userId, req.body.idempotencyKey) as Record<string, unknown> | undefined;
  if (existing) return res.json({ eventId: existing.id, repeated: true });

  const recipe = db.prepare("SELECT id FROM recipes WHERE id = ? AND status = 'approved' AND deleted_at IS NULL")
    .get(req.body.recipeId) as { id: number } | undefined;
  if (!recipe) return sendError(res, 404, "菜谱不存在或当前不可推荐", "RECIPE_NOT_AVAILABLE");
  if (req.body.requestId) {
    const request = db.prepare("SELECT scoring_version FROM recipe_recommendation_requests WHERE id = ? AND user_id = ?")
      .get(req.body.requestId, userId) as { scoring_version: string } | undefined;
    if (!request) return sendError(res, 404, "推荐请求不存在", "RECOMMENDATION_REQUEST_NOT_FOUND");
    if (request.scoring_version !== req.body.scoringVersion) {
      return sendError(res, 409, "评分版本与推荐请求不一致", "RECOMMENDATION_VERSION_MISMATCH");
    }
  }

  const eventId = randomUUID();
  db.prepare(`INSERT INTO recipe_recommendation_events
    (id, user_id, request_id, recipe_id, event_type, scoring_version, surface, metadata_json, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(eventId, userId, req.body.requestId ?? null, req.body.recipeId, req.body.eventType,
      req.body.scoringVersion, req.body.surface, JSON.stringify(req.body.metadata ?? {}), req.body.idempotencyKey);
  return res.status(201).json({ eventId, repeated: false });
});

export default router;
