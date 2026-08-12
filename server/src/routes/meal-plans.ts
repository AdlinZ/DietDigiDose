import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { uuidParam } from "../middleware/validateParam.js";

const router = Router();
router.use(authMiddleware);
router.param("id", uuidParam);

router.get("/", (req: AuthRequest, res) => {
  const plans = db.prepare("SELECT * FROM meal_plans WHERE user_id = ? AND deleted_at IS NULL ORDER BY start_date DESC, created_at DESC").all(req.userId!) as Array<Record<string, unknown>>;
  const itemQuery = db.prepare("SELECT * FROM meal_plan_items WHERE plan_id = ? AND user_id = ? ORDER BY planned_date, id");
  return res.json(plans.map((plan) => ({ ...plan, constraints: JSON.parse(String(plan.constraints_json || "{}")), items: itemQuery.all(plan.id, req.userId!).map((item: any) => ({ ...item, ingredients: JSON.parse(item.ingredients_json || "[]"), steps: JSON.parse(item.steps_json || "[]") })) })));
});

router.get("/:id", (req: AuthRequest, res) => {
  const plan = db.prepare("SELECT * FROM meal_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(req.params.id, req.userId!) as Record<string, unknown> | undefined;
  if (!plan) return res.status(404).json({ error: "餐单不存在", code: "MEAL_PLAN_NOT_FOUND" });
  const items = db.prepare("SELECT * FROM meal_plan_items WHERE plan_id = ? AND user_id = ? ORDER BY planned_date, id").all(plan.id, req.userId!);
  return res.json({ ...plan, constraints: JSON.parse(String(plan.constraints_json || "{}")), items });
});

export default router;
