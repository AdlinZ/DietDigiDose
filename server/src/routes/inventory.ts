import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { inventoryCreateSchema, inventoryUpdateSchema } from "../validation/schemas.js";
import { sendError } from "../utils/http.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";

const router = Router();
router.param("id", positiveIntegerParam);
router.use(authMiddleware);

// GET /api/v1/inventory
router.get("/", (req: AuthRequest, res) => {
  const items = db.prepare(`
    SELECT * FROM inventory_items
    WHERE user_id = ?
    ORDER BY expiration_date ASC
  `).all(req.userId);

  // Convert SQLite 1/0 integer to boolean for JS
  const formatted = items.map((item: any) => ({
    ...item,
    is_available: Boolean(item.is_available)
  }));

  res.json(formatted);
});

// POST /api/v1/inventory
router.post("/", validateBody(inventoryCreateSchema), (req: AuthRequest, res) => {
  const { food_name, category, quantity, expiration_date, storage_location, image_url } = req.body;
  const result = db.prepare(`
    INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, storage_location, image_url, is_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    req.userId,
    food_name,
    category,
    quantity || "1份",
    expiration_date,
    storage_location || "冷藏",
    image_url || null
  );

  const newItem = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(result.lastInsertRowid) as Record<string, any>;
  res.status(201).json({
    ...newItem,
    is_available: true
  });
});

// PUT /api/v1/inventory/:id
router.put("/:id", validateBody(inventoryUpdateSchema), (req: AuthRequest, res) => {
  const { food_name, category, quantity, expiration_date, storage_location, image_url, is_available } = req.body;
  const itemId = req.params.id;

  const item: any = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(itemId, req.userId);
  if (!item) {
    return sendError(res, 404, "食材不存在或无权修改", "INVENTORY_NOT_FOUND");
  }

  db.prepare(`
    UPDATE inventory_items
    SET food_name = COALESCE(?, food_name),
        category = COALESCE(?, category),
        quantity = COALESCE(?, quantity),
        expiration_date = COALESCE(?, expiration_date),
        storage_location = COALESCE(?, storage_location),
        image_url = COALESCE(?, image_url),
        is_available = COALESCE(?, is_available)
    WHERE id = ? AND user_id = ?
  `).run(
    food_name,
    category,
    quantity,
    expiration_date,
    storage_location,
    image_url,
    is_available !== undefined ? (is_available ? 1 : 0) : null,
    itemId,
    req.userId
  );

  const updated = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId) as Record<string, any>;
  res.json({
    ...updated,
    is_available: Boolean(updated.is_available)
  });

});

// DELETE /api/v1/inventory/:id
router.delete("/:id", (req: AuthRequest, res) => {
  const result = db.prepare("DELETE FROM inventory_items WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
  if (result.changes === 0) {
    return sendError(res, 404, "未找到相关食材", "INVENTORY_NOT_FOUND");
  }

  res.json({ message: "删除成功" });
});

export default router;
