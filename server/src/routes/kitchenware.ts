import { Router } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { db } from "../storage/db.js";

const router = Router();
const CATEGORIES = new Set(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]);
const STATUSES = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);

router.use(authMiddleware);

function normalizeInput(body: Record<string, unknown>) {
  const category = String(body.category || "其他").trim();
  const status = String(body.status || "良好").trim();
  return {
    name: String(body.name || "").trim(),
    category: CATEGORIES.has(category) ? category : "其他",
    status: STATUSES.has(status) ? status : "良好",
    note: String(body.note || "").trim(),
    imageUrl: String(body.image_url || "").trim(),
    purchaseDate: String(body.purchase_date || "").trim(),
  };
}

function validateInput(input: ReturnType<typeof normalizeInput>) {
  if (input.name.length < 1 || input.name.length > 80) return "厨具名称需为 1-80 个字符";
  if (input.note.length > 300) return "规格或备注不能超过 300 个字符";
  if (input.imageUrl.length > 4_000_000) return "厨具图片过大，请压缩后重试";
  if (input.purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) {
    return "购买日期格式不正确";
  }
  return null;
}

// GET /api/v1/kitchenware - 当前用户的厨具资产
router.get("/", (req: AuthRequest, res) => {
  const items = db.prepare(`
    SELECT *
    FROM kitchenware_items
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
  `).all(req.userId);
  return res.json(items);
});

// GET /api/v1/kitchenware/catalog - 官方标准厨具类型库
router.get("/catalog", (_req, res) => {
  const items = db.prepare(`SELECT * FROM kitchenware_catalog ORDER BY category, name`).all();
  return res.json(items);
});

// POST /api/v1/kitchenware
router.post("/", (req: AuthRequest, res) => {
  const input = normalizeInput(req.body || {});
  const validationError = validateInput(input);
  if (validationError) return res.status(400).json({ error: validationError });

  const result = db.prepare(`
    INSERT INTO kitchenware_items (
      user_id, name, category, status, note, image_url, purchase_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId,
    input.name,
    input.category,
    input.status,
    input.note || null,
    input.imageUrl || null,
    input.purchaseDate || null,
  );

  const item = db.prepare("SELECT * FROM kitchenware_items WHERE id = ?").get(result.lastInsertRowid);
  return res.status(201).json(item);
});

// PUT /api/v1/kitchenware/:id
router.put("/:id", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`
    SELECT id FROM kitchenware_items
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).get(id, req.userId);
  if (!existing) return res.status(404).json({ error: "厨具不存在或无权修改" });

  const input = normalizeInput(req.body || {});
  const validationError = validateInput(input);
  if (validationError) return res.status(400).json({ error: validationError });

  db.prepare(`
    UPDATE kitchenware_items
    SET name = ?, category = ?, status = ?, note = ?, image_url = ?,
        purchase_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(
    input.name,
    input.category,
    input.status,
    input.note || null,
    input.imageUrl || null,
    input.purchaseDate || null,
    id,
    req.userId,
  );

  const item = db.prepare("SELECT * FROM kitchenware_items WHERE id = ?").get(id);
  return res.json(item);
});

// POST /api/v1/kitchenware/:id/maintain
router.post("/:id/maintain", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const result = db.prepare(`
    UPDATE kitchenware_items
    SET status = '良好', last_maintained_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "厨具不存在或无权修改" });

  const item = db.prepare("SELECT * FROM kitchenware_items WHERE id = ?").get(id);
  return res.json(item);
});

// DELETE /api/v1/kitchenware/:id
router.delete("/:id", (req: AuthRequest, res) => {
  const result = db.prepare(`
    UPDATE kitchenware_items
    SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(req.params.id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "厨具不存在或无权删除" });
  return res.json({ success: true, message: "厨具已移除" });
});

export default router;
