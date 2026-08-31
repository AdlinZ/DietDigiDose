import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { sendError } from "../../utils/http.js";
import { cookingCompletionSchema, dietRecordCreateSchema } from "../../validation/schemas.js";
import type { DietRecordsService } from "./service.js";

function handleInventoryError(error: unknown, res: Response, next: NextFunction) {
  if (!(error instanceof InventoryQuantityError)) return next(error);
  const status = ["INVENTORY_UNIT_MISMATCH", "STRUCTURED_QUANTITY_REQUIRED", "INVALID_CONSUMPTION_AMOUNT"].includes(error.code) ? 400 : 409;
  return sendError(res, status, error.message, error.code);
}

export function createDietRecordsRouter(service: DietRecordsService) {
  const router = Router();
  router.param("id", positiveIntegerParam);
  router.use(authMiddleware);

  router.post("/cooking-completions", validateBody(cookingCompletionSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.completeCooking(req.userId!, req.body)
      .then((result) => res.status(result.repeated ? 200 : 201).json(result))
      .catch((error: unknown) => handleInventoryError(error, res, next));
  });
  router.get("/", (req: AuthRequest, res: Response, next: NextFunction) => {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    void service.list(req.userId!, date).then((records) => res.json(records)).catch(next);
  });
  router.post("/", validateBody(dietRecordCreateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.create(req.userId!, req.body).then((record) => res.status(201).json(record)).catch(next);
  });
  router.delete("/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.remove(req.userId!, Number(req.params.id))
      .then((removed) => removed ? res.json({ message: "删除成功" }) : sendError(res, 404, "记录不存在", "DIET_RECORD_NOT_FOUND"))
      .catch(next);
  });
  return router;
}
