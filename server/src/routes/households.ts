import { Router } from "express";
import crypto from "node:crypto";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { sendError } from "../utils/http.js";
import { validateBody } from "../middleware/validate.js";
import { inventoryUpdateSchema } from "../validation/schemas.js";

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
      db.prepare("UPDATE household_members SET role = 'owner' WHERE id = ?").run(otherMembers[0].id);
    } else {
      db.prepare("DELETE FROM households WHERE id = ?").run(householdId);
      return res.json({ message: "家庭空间已解散" });
    }
  }

  db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").run(householdId, userId);
  res.json({ message: "已退出家庭空间" });
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
