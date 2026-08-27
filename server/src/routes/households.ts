import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { sendError } from "../utils/http.js";
import { validateBody } from "../middleware/validate.js";
import {
  householdShoppingCreateSchema,
  householdShoppingIntakeSchema,
  householdShoppingUpdateSchema,
  householdTransferOwnerSchema,
  inventoryUpdateSchema,
} from "../validation/schemas.js";

const router = Router();
router.use(authMiddleware);

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function checkHouseholdMember(householdId: number, userId: number) {
  return db
    .prepare("SELECT * FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(householdId, userId);
}

function normalizeItemName(value: string) {
  return value.toLocaleLowerCase().replace(/\([^)]*\)|（[^）]*）/g, "").replace(/[\d\s.,，。克千毫升斤个只颗片份盒包袋瓶罐根勺]/g, "");
}

function logActivity(householdId: number, userId: number, action: string, name: string, quantity: string, location = "") {
  db.prepare(`INSERT INTO household_activity_logs
    (household_id, operator_user_id, action, food_name, quantity, storage_location) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(householdId, userId, action, name, quantity, location || "-");
}

const householdShoppingSelect = `
  SELECT hs.*,
    COALESCE(creator.nickname, creator.username) AS creator_name,
    COALESCE(editor.nickname, editor.username) AS updater_name,
    COALESCE(buyer.nickname, buyer.username) AS purchaser_name
  FROM household_shopping_items hs
  JOIN users creator ON creator.id = hs.created_by_user_id
  JOIN users editor ON editor.id = hs.updated_by_user_id
  LEFT JOIN users buyer ON buyer.id = hs.purchased_by_user_id
`;

function formatShoppingItem(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    householdId: Number(row.household_id),
    name: String(row.name),
    amount: String(row.amount),
    category: String(row.category),
    checked: Boolean(row.checked),
    storageLocation: row.storage_location ? String(row.storage_location) : null,
    expirationDate: row.expiration_date ? String(row.expiration_date) : null,
    createdByUserId: Number(row.created_by_user_id),
    updatedByUserId: Number(row.updated_by_user_id),
    purchasedByUserId: row.purchased_by_user_id === null ? null : Number(row.purchased_by_user_id),
    creatorName: String(row.creator_name),
    updaterName: String(row.updater_name),
    purchaserName: row.purchaser_name ? String(row.purchaser_name) : null,
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// POST /api/v1/households - 创建家庭空间
router.post("/", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    return sendError(res, 400, "请输入家庭空间名称", "INVALID_NAME");
  }

  let code = generateInviteCode();
  while (db.prepare("SELECT id FROM households WHERE invite_code = ?").get(code)) {
    code = generateInviteCode();
  }

  const result = db.transaction(() => {
    const insertHousehold = db.prepare(`
      INSERT INTO households (name, invite_code, owner_id) VALUES (?, ?, ?)
    `);
    const hResult = insertHousehold.run(name, code, userId);
    const householdId = Number(hResult.lastInsertRowid);

    db.prepare(`
      INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')
    `).run(householdId, userId);

    return db.prepare("SELECT * FROM households WHERE id = ?").get(householdId);
  })();

  res.status(201).json(result);
});

// GET /api/v1/households/mine - 获取我的家庭空间
router.get("/mine", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const households: any[] = db
    .prepare(`
      SELECT h.*, hm.role AS my_role
      FROM households h
      JOIN household_members hm ON h.id = hm.household_id
      WHERE hm.user_id = ?
      ORDER BY h.created_at DESC
    `)
    .all(userId);

  const result = households.map((h) => {
    const members = db
      .prepare(`
        SELECT u.id AS user_id, u.username, COALESCE(u.nickname, u.username) AS nickname, u.avatar_url, hm.role, hm.joined_at
        FROM household_members hm
        JOIN users u ON hm.user_id = u.id
        WHERE hm.household_id = ?
        ORDER BY hm.joined_at ASC
      `)
      .all(h.id);

    return { ...h, members };
  });

  res.json(result);
});

// POST /api/v1/households/join - 通过邀请码加入家庭
router.post("/join", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const rawCode = typeof req.body.invite_code === "string" ? req.body.invite_code.trim().toUpperCase() : "";
  if (!rawCode) {
    return sendError(res, 400, "请输入 8 位家庭邀请码", "INVALID_CODE");
  }

  const household: any = db.prepare("SELECT * FROM households WHERE invite_code = ?").get(rawCode);
  if (!household) {
    return sendError(res, 440, "未找到对应的家庭空间，请检查邀请码是否正确", "HOUSEHOLD_NOT_FOUND");
  }

  const existing = checkHouseholdMember(household.id, userId);
  if (existing) {
    return res.json({ message: "你已经是该家庭空间的成员", household });
  }

  db.prepare(`
    INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')
  `).run(household.id, userId);

  res.status(201).json({ message: "加入家庭空间成功", household });
});

// POST /api/v1/households/:id/leave - 退出家庭
router.post("/:id/leave", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const householdId = Number(req.params.id);

  const member: any = checkHouseholdMember(householdId, userId);
  if (!member) {
    return sendError(res, 404, "你不是该家庭空间的成员", "NOT_MEMBER");
  }

  if (member.role === "owner") {
    const otherMembers: any[] = db
      .prepare("SELECT * FROM household_members WHERE household_id = ? AND user_id <> ?")
      .all(householdId, userId);
    if (otherMembers.length > 0) {
      db.transaction(() => {
        db.prepare("UPDATE household_members SET role = 'owner' WHERE id = ?").run(otherMembers[0].id);
        db.prepare("UPDATE households SET owner_id = ?, version = version + 1 WHERE id = ?").run(otherMembers[0].user_id, householdId);
        db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").run(householdId, userId);
        logActivity(householdId, userId, "owner_transfer_leave", "家庭所有者", "1次");
      })();
      return res.json({ message: "已转移所有者并退出家庭空间", new_owner_user_id: otherMembers[0].user_id });
    } else {
      db.prepare("DELETE FROM households WHERE id = ?").run(householdId);
      return res.json({ message: "家庭空间已解散" });
    }
  }

  db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").run(householdId, userId);
  res.json({ message: "已退出家庭空间" });
});

router.post("/:id/transfer-owner", validateBody(householdTransferOwnerSchema), (req: AuthRequest, res) => {
  const householdId = Number(req.params.id);
  const userId = req.userId!;
  const household = db.prepare("SELECT * FROM households WHERE id = ? AND owner_id = ?").get(householdId, userId) as any;
  if (!household) return sendError(res, 404, "家庭空间不存在或你不是所有者", "HOUSEHOLD_NOT_FOUND");
  const target = checkHouseholdMember(householdId, req.body.newOwnerUserId) as any;
  if (!target) return sendError(res, 400, "新所有者必须是当前家庭成员", "TARGET_NOT_MEMBER");
  const changed = db.transaction(() => {
    const update = db.prepare("UPDATE households SET owner_id = ?, version = version + 1 WHERE id = ? AND owner_id = ? AND version = ?")
      .run(req.body.newOwnerUserId, householdId, userId, req.body.version);
    if (update.changes !== 1) return false;
    db.prepare("UPDATE household_members SET role = 'member' WHERE household_id = ? AND user_id = ?").run(householdId, userId);
    db.prepare("UPDATE household_members SET role = 'owner' WHERE household_id = ? AND user_id = ?").run(householdId, req.body.newOwnerUserId);
    logActivity(householdId, userId, "owner_transfer", "家庭所有者", "1次");
    return true;
  })();
  if (!changed) return sendError(res, 409, "家庭空间已更新，请刷新后重试", "HOUSEHOLD_VERSION_CONFLICT");
  return res.json({ transferred: true, new_owner_user_id: req.body.newOwnerUserId, version: Number(household.version) + 1 });
});

router.get("/:id/shopping-list", (req: AuthRequest, res) => {
  const householdId = Number(req.params.id);
  if (!checkHouseholdMember(householdId, req.userId!)) {
    return sendError(res, 404, "家庭采购清单不存在", "HOUSEHOLD_SHOPPING_NOT_FOUND");
  }
  const rows = db.prepare(`${householdShoppingSelect}
    WHERE hs.household_id = ? AND hs.deleted_at IS NULL AND hs.transferred_at IS NULL
    ORDER BY hs.checked ASC, hs.updated_at DESC`).all(householdId) as Array<Record<string, unknown>>;
  return res.json(rows.map(formatShoppingItem));
});

router.post("/:id/shopping-list", validateBody(householdShoppingCreateSchema), (req: AuthRequest, res) => {
  const householdId = Number(req.params.id);
  const userId = req.userId!;
  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 404, "家庭采购清单不存在", "HOUSEHOLD_SHOPPING_NOT_FOUND");
  }
  const active = db.prepare(`SELECT id, name, amount, category FROM household_shopping_items
    WHERE household_id = ? AND deleted_at IS NULL AND transferred_at IS NULL`).all(householdId) as Array<Record<string, unknown>>;
  const normalized = normalizeItemName(req.body.name);
  const mergeCandidates = active.filter((item) => normalizeItemName(String(item.name)) === normalized)
    .map((item) => ({ id: String(item.id), name: String(item.name), amount: String(item.amount), category: String(item.category) }));
  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO household_shopping_items
      (id, household_id, name, amount, category, storage_location, expiration_date, created_by_user_id, updated_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, householdId, req.body.name, req.body.amount, req.body.category, req.body.storageLocation ?? null, req.body.expirationDate ?? null, userId, userId);
    logActivity(householdId, userId, "shopping_add", req.body.name, req.body.amount, req.body.storageLocation);
  })();
  const row = db.prepare(`${householdShoppingSelect} WHERE hs.id = ? AND hs.household_id = ?`).get(id, householdId) as Record<string, unknown>;
  return res.status(201).json({ item: formatShoppingItem(row), mergeCandidates });
});

router.patch("/:id/shopping-list/:itemId", validateBody(householdShoppingUpdateSchema), (req: AuthRequest, res) => {
  const householdId = Number(req.params.id);
  const userId = req.userId!;
  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 404, "家庭采购项不存在", "HOUSEHOLD_SHOPPING_ITEM_NOT_FOUND");
  }
  const current = db.prepare("SELECT * FROM household_shopping_items WHERE id = ? AND household_id = ? AND deleted_at IS NULL AND transferred_at IS NULL")
    .get(req.params.itemId, householdId) as any;
  if (!current) return sendError(res, 404, "家庭采购项不存在", "HOUSEHOLD_SHOPPING_ITEM_NOT_FOUND");
  const nextChecked = req.body.checked === undefined ? Boolean(current.checked) : req.body.checked;
  const changed = db.prepare(`UPDATE household_shopping_items SET
    name = ?, amount = ?, category = ?, checked = ?, storage_location = ?, expiration_date = ?,
    updated_by_user_id = ?, purchased_by_user_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND household_id = ? AND version = ? AND deleted_at IS NULL AND transferred_at IS NULL`)
    .run(
      req.body.name ?? current.name, req.body.amount ?? current.amount, req.body.category ?? current.category,
      nextChecked ? 1 : 0, req.body.storageLocation ?? current.storage_location, req.body.expirationDate ?? current.expiration_date,
      userId, nextChecked ? (req.body.checked === true ? userId : current.purchased_by_user_id) : null,
      req.params.itemId, householdId, req.body.version,
    );
  if (changed.changes !== 1) return sendError(res, 409, "采购项已被其他成员更新，请刷新后重试", "HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
  logActivity(householdId, userId, req.body.checked === undefined ? "shopping_edit" : nextChecked ? "shopping_purchase" : "shopping_uncheck", req.body.name ?? current.name, req.body.amount ?? current.amount, req.body.storageLocation ?? current.storage_location);
  const row = db.prepare(`${householdShoppingSelect} WHERE hs.id = ? AND hs.household_id = ?`).get(req.params.itemId, householdId) as Record<string, unknown>;
  return res.json(formatShoppingItem(row));
});

router.delete("/:id/shopping-list/:itemId", (req: AuthRequest, res) => {
  const householdId = Number(req.params.id);
  const userId = req.userId!;
  const version = Number(req.query.version);
  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 404, "家庭采购项不存在", "HOUSEHOLD_SHOPPING_ITEM_NOT_FOUND");
  }
  if (!Number.isInteger(version) || version < 1) return sendError(res, 400, "缺少有效版本号", "INVALID_VERSION");
  const item = db.prepare("SELECT * FROM household_shopping_items WHERE id = ? AND household_id = ? AND deleted_at IS NULL AND transferred_at IS NULL")
    .get(req.params.itemId, householdId) as any;
  if (!item) return sendError(res, 404, "家庭采购项不存在", "HOUSEHOLD_SHOPPING_ITEM_NOT_FOUND");
  const changed = db.prepare(`UPDATE household_shopping_items SET deleted_at = CURRENT_TIMESTAMP,
    updated_by_user_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND household_id = ? AND version = ? AND deleted_at IS NULL AND transferred_at IS NULL`)
    .run(userId, req.params.itemId, householdId, version);
  if (changed.changes !== 1) return sendError(res, 409, "采购项已被其他成员更新，请刷新后重试", "HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
  logActivity(householdId, userId, "shopping_delete", item.name, item.amount, item.storage_location);
  return res.json({ deleted: true });
});

router.post("/:id/shopping-list/intake", validateBody(householdShoppingIntakeSchema), (req: AuthRequest, res) => {
  const householdId = Number(req.params.id);
  const userId = req.userId!;
  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 404, "家庭采购清单不存在", "HOUSEHOLD_SHOPPING_NOT_FOUND");
  }
  const existing = db.prepare("SELECT result_json FROM household_shopping_intake_batches WHERE household_id = ? AND idempotency_key = ?")
    .get(householdId, req.body.idempotencyKey) as { result_json: string } | undefined;
  if (existing) return res.json({ ...JSON.parse(existing.result_json), repeated: true });
  try {
    const response = db.transaction(() => {
      const batchId = crypto.randomUUID();
      const inventoryIds: number[] = [];
      for (const confirmed of req.body.items as Array<{ id: string; version: number; quantity: string; expirationDate: string; storageLocation: string }>) {
        const item = db.prepare(`SELECT * FROM household_shopping_items WHERE id = ? AND household_id = ?
          AND checked = 1 AND deleted_at IS NULL AND transferred_at IS NULL`).get(confirmed.id, householdId) as any;
        if (!item || Number(item.version) !== confirmed.version) throw new Error("VERSION_CONFLICT");
        const inserted = db.prepare(`INSERT INTO household_inventory_items
          (household_id, created_by_user_id, food_name, category, quantity, expiration_date, storage_location, image_url, is_available)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)`)
          .run(householdId, userId, item.name, item.category, confirmed.quantity, confirmed.expirationDate, confirmed.storageLocation);
        inventoryIds.push(Number(inserted.lastInsertRowid));
        const moved = db.prepare(`UPDATE household_shopping_items SET transferred_at = CURRENT_TIMESTAMP, intake_batch_id = ?,
          updated_by_user_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND household_id = ? AND version = ? AND transferred_at IS NULL`)
          .run(batchId, userId, item.id, householdId, confirmed.version);
        if (moved.changes !== 1) throw new Error("VERSION_CONFLICT");
        logActivity(householdId, userId, "shopping_intake", item.name, confirmed.quantity, confirmed.storageLocation);
      }
      const result = { batchId, inventoryIds, count: inventoryIds.length, repeated: false };
      db.prepare(`INSERT INTO household_shopping_intake_batches
        (id, household_id, user_id, idempotency_key, result_json) VALUES (?, ?, ?, ?, ?)`)
        .run(batchId, householdId, userId, req.body.idempotencyKey, JSON.stringify(result));
      return result;
    })();
    return res.status(201).json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "VERSION_CONFLICT") {
      return sendError(res, 409, "部分采购项已被修改、取消勾选或入库，请刷新后重试", "HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
    }
    throw error;
  }
});

// GET /api/v1/households/:id/inventory - 获取家庭共享库存
router.get("/:id/inventory", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const householdId = Number(req.params.id);

  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 403, "你无权查看该家庭保鲜仓", "FORBIDDEN");
  }

  const items = db
    .prepare(`
      SELECT hi.*, COALESCE(u.nickname, u.username) AS creator_name
      FROM household_inventory_items hi
      LEFT JOIN users u ON hi.created_by_user_id = u.id
      WHERE hi.household_id = ? AND hi.is_available = 1
      ORDER BY hi.expiration_date ASC
    `)
    .all(householdId);

  res.json(items.map((i: any) => ({ ...i, is_available: Boolean(i.is_available) })));
});

// POST /api/v1/households/:id/inventory - 添加家庭共享食材
router.post("/:id/inventory", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const householdId = Number(req.params.id);

  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 403, "无权向该家庭添加食材", "FORBIDDEN");
  }

  const { food_name, category, quantity, expiration_date, storage_location, image_url } = req.body;
  if (!food_name || !expiration_date) {
    return sendError(res, 400, "食材名称与到期日为必填项", "INVALID_INPUT");
  }

  const result = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO household_inventory_items (household_id, created_by_user_id, food_name, category, quantity, expiration_date, storage_location, image_url, is_available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      householdId,
      userId,
      food_name,
      category || "蔬菜",
      quantity || "1份",
      expiration_date,
      storage_location || "冷藏",
      image_url || null
    );

    db.prepare(`
      INSERT INTO household_activity_logs (household_id, operator_user_id, action, food_name, quantity, storage_location)
      VALUES (?, ?, 'add', ?, ?, ?)
    `).run(householdId, userId, food_name, quantity || "1份", storage_location || "冷藏");

    return db.prepare(`
      SELECT hi.*, COALESCE(u.nickname, u.username) AS creator_name
      FROM household_inventory_items hi
      LEFT JOIN users u ON hi.created_by_user_id = u.id
      WHERE hi.id = ?
    `).get(insert.lastInsertRowid);
  })();

  res.status(201).json(result);
});

// PUT /api/v1/households/:id/inventory/:itemId - 更新家庭共享食材
router.put("/:id/inventory/:itemId", validateBody(inventoryUpdateSchema), (req: AuthRequest, res) => {
  const userId = req.userId!;
  const householdId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 403, "无权修改该家庭食材", "FORBIDDEN");
  }

  const item: any = db.prepare("SELECT * FROM household_inventory_items WHERE id = ? AND household_id = ?").get(itemId, householdId);
  if (!item) return sendError(res, 404, "食材不存在", "NOT_FOUND");

  const { food_name, category, quantity, expiration_date, storage_location, image_url, is_available } = req.body;
  db.prepare(`
    UPDATE household_inventory_items
    SET food_name = COALESCE(?, food_name), category = COALESCE(?, category),
        quantity = COALESCE(?, quantity), expiration_date = COALESCE(?, expiration_date),
        storage_location = COALESCE(?, storage_location), image_url = COALESCE(?, image_url),
        is_available = COALESCE(?, is_available)
    WHERE id = ? AND household_id = ?
  `).run(food_name, category, quantity, expiration_date, storage_location, image_url,
    is_available === undefined ? null : (is_available ? 1 : 0), itemId, householdId);
  db.prepare(`INSERT INTO household_activity_logs (household_id, operator_user_id, action, food_name, quantity, storage_location)
    VALUES (?, ?, 'edit', ?, ?, ?)`)
    .run(householdId, userId, food_name || item.food_name, quantity || item.quantity, storage_location || item.storage_location);
  const updated: any = db.prepare("SELECT * FROM household_inventory_items WHERE id = ?").get(itemId);
  res.json({ ...updated, is_available: Boolean(updated.is_available) });
});

// DELETE /api/v1/households/:id/inventory/:itemId - 用完/扣减家庭食材
router.delete("/:id/inventory/:itemId", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const householdId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 403, "无权操作该家庭食材", "FORBIDDEN");
  }

  const item: any = db.prepare("SELECT * FROM household_inventory_items WHERE id = ? AND household_id = ?").get(itemId, householdId);
  if (!item) {
    return sendError(res, 404, "食材不存在", "NOT_FOUND");
  }

  db.transaction(() => {
    db.prepare("DELETE FROM household_inventory_items WHERE id = ?").run(itemId);
    db.prepare(`
      INSERT INTO household_activity_logs (household_id, operator_user_id, action, food_name, quantity, storage_location)
      VALUES (?, ?, 'consume', ?, ?, ?)
    `).run(householdId, userId, item.food_name, item.quantity, item.storage_location);
  })();

  res.json({ message: "家庭食材已用完下架" });
});

// GET /api/v1/households/:id/history - 获取家庭变动操作日志
router.get("/:id/history", (req: AuthRequest, res) => {
  const userId = req.userId!;
  const householdId = Number(req.params.id);

  if (!checkHouseholdMember(householdId, userId)) {
    return sendError(res, 403, "无权查看该家庭变动日志", "FORBIDDEN");
  }

  const logs = db
    .prepare(`
      SELECT hl.*, COALESCE(u.nickname, u.username) AS operator_name, u.avatar_url AS operator_avatar
      FROM household_activity_logs hl
      LEFT JOIN users u ON hl.operator_user_id = u.id
      WHERE hl.household_id = ?
      ORDER BY hl.created_at DESC
      LIMIT 100
    `)
    .all(householdId);

  res.json(logs);
});

export default router;
