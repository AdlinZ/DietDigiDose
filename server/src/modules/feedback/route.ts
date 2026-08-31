import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { feedbackCreateSchema } from "../../validation/schemas.js";
import type { FeedbackService } from "./service.js";

export function createFeedbackRouter(service: FeedbackService) {
  const router = Router();

  router.post("/", authMiddleware, validateBody(feedbackCreateSchema), (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    void service.create(req.userId!, req.body)
      .then((receipt) => res.status(201).json(receipt))
      .catch(next);
  });

  return router;
}
