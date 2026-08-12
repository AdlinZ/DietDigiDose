import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { uuidParam } from "../middleware/validateParam.js";
import { shoppingListImportSchema, shoppingListItemCreateSchema, shoppingListItemUpdateSchema } from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);
router.param("id", uuidParam);

function format(item: Record<string, unknown>) {
  return {
    id: String(item.id), clientId: item.client_id ? String(item.client_id) : undefined,
    name: String(item.name), amount: String(item.amount), category: String(item.category), checked: Boolean(item.checked),
    purchaseDate: item.purchase_date ? String(item.purchase_date) : undefined,
    storageLocation: item.storage_location ? String(item.storage_location) : undefined,
    version: Number(item.version), createdAt: String(item.created_at), updatedAt: String(item.updated_at),
  };
}

router.get("/", (req: AuthRequest, res) => {
  const rows = db.prepare("SELECT * FROM shopping_list_items WHERE user_id = ? AND deleted_at IS NULL ORDER BY checked ASC, updated_at DESC")
    .all(req.userId!) as Array<Record<string, unknown>>;
  return res.json(rows.map(format));
});

router.post("/", validateBody(shoppingListItemCreateSchema), (req: AuthRequest, res) => {
  const id = randomUUID();
  db.prepare(`INSERT INTO shopping_list_items (id, user_id, client_id, name, amount, category, checked, purchase_date, storage_location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.userId!, req.body.clientId || null, req.body.name, req.body.amount, req.body.category, req.body.checked ? 1 : 0, req.body.purchaseDate || null, req.body.storageLocation || null);
  const row = db.prepare("SELECT * FROM shopping_list_items WHERE id = ?").get(id) as Record<string, unknown>;
  return res.status(201).json(format(row));
});

router.patch("/:id", validateBody(shoppingListItemUpdateSchema), (req: AuthRequest, res) => {
  const result = db.prepare(`UPDATE shopping_list_items SET name = COALESCE(?, name), amount = COALESCE(?, amount), category = COALESCE(?, category),
    checked = COALESCE(?, checked), purchase_date = COALESCE(?, purchase_date), storage_location = COALESCE(?, storage_location),
    version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
    .run(req.body.name ?? null, req.body.amount ?? null, req.body.category ?? null, req.body.checked === undefined ? null : req.body.checked ? 1 : 0,
      req.body.purchaseDate ?? null, req.body.storageLocation ?? null, req.params.id, req.userId!, req.body.version);
  if (result.changes !== 1) return res.status(409).json({ error: "采购项已变化，请刷新后重试", code: "SHOPPING_ITEM_VERSION_CONFLICT" });
  return res.json(format(db.prepare("SELECT * FROM shopping_list_items WHERE id = ?").get(req.params.id) as Record<string, unknown>));
});

router.delete("/:id", (req: AuthRequest, res) => {
  const result = db.prepare("UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
    .run(req.params.id, req.userId!);
  if (result.changes !== 1) return res.status(404).json({ error: "采购项不存在", code: "SHOPPING_ITEM_NOT_FOUND" });
  return res.json({ success: true });
});

router.post("/import", validateBody(shoppingListImportSchema), (req: AuthRequest, res) => {
  const insert = db.prepare(`INSERT OR IGNORE INTO shopping_list_items
    (id, user_id, client_id, name, amount, category, checked, purchase_date, storage_location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const item of req.body.items) insert.run(randomUUID(), req.userId!, item.clientId || `${req.body.importKey}:${item.name}:${item.amount}`, item.name, item.amount, item.category, item.checked ? 1 : 0, item.purchaseDate || null, item.storageLocation || null);
  })();
  const rows = db.prepare("SELECT * FROM shopping_list_items WHERE user_id = ? AND deleted_at IS NULL ORDER BY checked ASC, updated_at DESC").all(req.userId!) as Array<Record<string, unknown>>;
  return res.json({ items: rows.map(format) });
});

export default router;
