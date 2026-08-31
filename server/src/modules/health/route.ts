import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { healthLogSchema, healthProfileSchema } from "../../validation/schemas.js";
import type { HealthService } from "./service.js";

export function createHealthRouter(service: HealthService) {
  const router = Router();
  router.use(authMiddleware);

  router.get("/latest", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.latestLog(req.userId!).then((log) => res.json(log)).catch(next);
  });

  router.get("/", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.listLogs(req.userId!).then((logs) => res.json(logs)).catch(next);
  });

  router.post("/log", validateBody(healthLogSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.upsertLog(req.userId!, req.body)
      .then(({ created, log }) => res.status(created ? 201 : 200).json(log))
      .catch(next);
  });

  router.delete("/log/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "无效的记录编号" });
    void service.removeLog(req.userId!, id)
      .then((removed) => removed ? res.status(204).send() : res.status(404).json({ error: "记录不存在" }))
      .catch(next);
  });

  router.get("/profile", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.getProfile(req.userId!).then((profile) => res.json(profile)).catch(next);
  });

  router.put("/profile", validateBody(healthProfileSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.upsertProfile(req.userId!, req.body).then((profile) => res.json(profile)).catch(next);
  });

  return router;
}
