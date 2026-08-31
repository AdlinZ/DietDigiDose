import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { uuidParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import {
  mealPlanCompleteSchema, mealPlanItemUpdateSchema, mealPlanQueueSchema, mealPlanShoppingSchema,
  mealPlanUpdateSchema, mealPlanVersionSchema,
} from "../../validation/schemas.js";
import { MealPlansError } from "./errors.js";
import type { MealPlansService } from "./service.js";

function handleError(error: unknown, res: Response, next: NextFunction) {
  return error instanceof MealPlansError ? sendError(res, error.status, error.message, error.code) : next(error);
}

export function createMealPlansRouter(service: MealPlansService) {
  const router = Router();
  router.use(authMiddleware);
  router.param("id", uuidParam);
  router.param("itemId", uuidParam);
  router.get("/", (req: AuthRequest, res, next) => {
    void service.list(req.userId!, req.query.includeArchived === "true").then((value) => res.json(value)).catch(next);
  });
  router.get("/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.find(req.userId!, String(req.params.id), req.query.includeArchived === "true")
      .then((value) => res.json(value)).catch((error: unknown) => handleError(error, res, next));
  });
  router.patch("/:id", validateBody(mealPlanUpdateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.updatePlan(req.userId!, String(req.params.id), req.body)
      .then((value) => res.json(value)).catch((error: unknown) => handleError(error, res, next));
  });
  router.delete("/:id", validateBody(mealPlanVersionSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.removePlan(req.userId!, String(req.params.id), req.body.version)
      .then((value) => res.json(value)).catch((error: unknown) => handleError(error, res, next));
  });
  router.patch("/:id/items/:itemId", validateBody(mealPlanItemUpdateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.updateItem(req.userId!, String(req.params.id), String(req.params.itemId), req.body)
      .then((value) => res.json(value)).catch((error: unknown) => handleError(error, res, next));
  });
  router.post("/:id/items/:itemId/shopping", validateBody(mealPlanShoppingSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.shopping(req.userId!, String(req.params.id), String(req.params.itemId), req.body)
      .then((value) => res.status(value.repeated ? 200 : 201).json(value)).catch((error: unknown) => handleError(error, res, next));
  });
  router.post("/:id/items/:itemId/queue", validateBody(mealPlanQueueSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.queue(req.userId!, String(req.params.id), String(req.params.itemId), req.body)
      .then((value) => res.status(value.repeated ? 200 : 201).json(value)).catch((error: unknown) => handleError(error, res, next));
  });
  router.post("/:id/items/:itemId/complete", validateBody(mealPlanCompleteSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.complete(req.userId!, String(req.params.id), String(req.params.itemId), req.body)
      .then((value) => res.status(value.repeated ? 200 : 201).json(value)).catch((error: unknown) => handleError(error, res, next));
  });
  return router;
}
