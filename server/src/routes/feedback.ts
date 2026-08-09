import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { feedbackCreateSchema } from "../validation/schemas.js";

const router = Router();

router.post("/", authMiddleware, validateBody(feedbackCreateSchema), (req: AuthRequest, res) => {
  const { category, content, context } = req.body;
  const result = db.prepare(`
    INSERT INTO user_feedback (user_id, category, content, context_json)
    VALUES (?, ?, ?, ?)
  `).run(req.userId, category, content, context ? JSON.stringify(context) : null);
  return res.status(201).json({ id: Number(result.lastInsertRowid), status: "received" });
});

export default router;
