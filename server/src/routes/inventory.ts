import { Router } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/security.js";
import { db } from "../storage/db.js";

const router = Router();

function getUserIdFromReq(req: any): number | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    return decoded.userId;
  } catch {
    return null;
  }
}

// GET /api/v1/inventory
router.get("/", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const items = db.prepare(`
    SELECT * FROM inventory_items
    WHERE user_id = ?
    ORDER BY expiration_date ASC
  `).all(userId);

  // Convert SQLite 1/0 integer to boolean for JS
  const formatted = items.map((item: any) => ({
    ...item,
    is_available: Boolean(item.is_available)
  }));

  res.json(formatted);
});

// POST /api/v1/inventory
router.post("/", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { food_name, category, quantity, expiration_date, storage_location, image_url } = req.body;
  if (!food_name || !category || !expiration_date) {
    return res.status(400).json({ error: "食材名称、分类和到期时间不能为空" });
  }

  const result = db.prepare(`
    INSERT INTO inventory_items (user_id, food_name, category, quantity, expiration_date, storage_location, image_url, is_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    userId,
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
router.put("/:id", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const { food_name, category, quantity, expiration_date, storage_location, image_url, is_available } = req.body;
  const itemId = req.params.id;

  const item: any = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(itemId, userId);
  if (!item) {
    return res.status(404).json({ error: "食材不存在或无权修改" });
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
    userId
  );

  const updated = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId) as Record<string, any>;
  res.json({
    ...updated,
    is_available: Boolean(updated.is_available)
  });

});

// DELETE /api/v1/inventory/:id
router.delete("/:id", (req, res) => {
  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ error: "未登录" });
  }

  const result = db.prepare("DELETE FROM inventory_items WHERE id = ? AND user_id = ?").run(req.params.id, userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: "未找到相关食材" });
  }

  res.json({ message: "删除成功" });
});

export default router;
