import crypto from "node:crypto";
import { HouseholdsError } from "./errors.js";
import { formatInventory, formatShoppingItem, normalizeItemName } from "./formatters.js";
import type { HouseholdsRepository } from "./repository.js";
import type { InventoryCreateInput, InventoryUpdateInput, ShoppingCreateInput, ShoppingIntakeInput, ShoppingUpdateInput } from "./types.js";

function inviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

export class HouseholdsService {
  private readonly repository: HouseholdsRepository;
  private readonly codeFactory: () => string;

  constructor(repository: HouseholdsRepository, codeFactory: () => string = inviteCode) {
    this.repository = repository; this.codeFactory = codeFactory;
  }

  async create(userId: number, rawName: unknown) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) throw new HouseholdsError(400, "请输入家庭空间名称", "INVALID_NAME");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const household = await this.repository.create(userId, name, this.codeFactory());
      if (household) return household;
    }
    throw new Error("Unable to allocate a unique household invite code");
  }

  mine(userId: number) { return this.repository.mine(userId); }

  async join(userId: number, rawCode: unknown) {
    const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    if (!code) throw new HouseholdsError(400, "请输入 8 位家庭邀请码", "INVALID_CODE");
    const result = await this.repository.join(userId, code);
    if (result.kind === "not_found") throw new HouseholdsError(440, "未找到对应的家庭空间，请检查邀请码是否正确", "HOUSEHOLD_NOT_FOUND");
    return { status: result.kind === "joined" ? 201 : 200,
      body: { message: result.kind === "joined" ? "加入家庭空间成功" : "你已经是该家庭空间的成员", household: result.household } };
  }

  async leave(userId: number, householdId: number) {
    const result = await this.repository.leave(userId, householdId);
    if (result.kind === "not_member") throw new HouseholdsError(404, "你不是该家庭空间的成员", "NOT_MEMBER");
    if (result.kind === "transferred") return { message: "已转移所有者并退出家庭空间", new_owner_user_id: result.newOwnerUserId };
    if (result.kind === "dissolved") return { message: "家庭空间已解散" };
    return { message: "已退出家庭空间" };
  }

  async transferOwner(userId: number, householdId: number, input: { newOwnerUserId: number; version: number }) {
    const result = await this.repository.transferOwner(userId, householdId, input.newOwnerUserId, input.version);
    if (result.kind === "not_owner") throw new HouseholdsError(404, "家庭空间不存在或你不是所有者", "HOUSEHOLD_NOT_FOUND");
    if (result.kind === "target_not_member") throw new HouseholdsError(400, "新所有者必须是当前家庭成员", "TARGET_NOT_MEMBER");
    if (result.kind === "version_conflict") throw new HouseholdsError(409, "家庭空间已更新，请刷新后重试", "HOUSEHOLD_VERSION_CONFLICT");
    return { transferred: true, new_owner_user_id: input.newOwnerUserId, version: result.version };
  }

  async shoppingList(userId: number, householdId: number) {
    const rows = await this.repository.shoppingList(userId, householdId);
    if (!rows) throw this.shoppingNotFound();
    return rows.map(formatShoppingItem);
  }

  async createShopping(userId: number, householdId: number, id: string, input: ShoppingCreateInput) {
    const result = await this.repository.createShopping(userId, householdId, id, input);
    if (result.kind === "not_member") throw this.shoppingNotFound();
    const normalized = normalizeItemName(input.name);
    const mergeCandidates = result.active.filter((item) => normalizeItemName(String(item.name)) === normalized)
      .map((item) => ({ id: String(item.id), name: String(item.name), amount: String(item.amount), category: String(item.category) }));
    return { item: formatShoppingItem(result.item), mergeCandidates };
  }

  async updateShopping(userId: number, householdId: number, itemId: string, input: ShoppingUpdateInput) {
    const result = await this.repository.updateShopping(userId, householdId, itemId, input);
    if (result.kind === "not_member" || result.kind === "not_found") throw this.shoppingItemNotFound();
    if (result.kind === "version_conflict") throw this.shoppingConflict();
    return formatShoppingItem(result.item);
  }

  async removeShopping(userId: number, householdId: number, itemId: string, version: number) {
    if (!Number.isInteger(version) || version < 1) throw new HouseholdsError(400, "缺少有效版本号", "INVALID_VERSION");
    const result = await this.repository.removeShopping(userId, householdId, itemId, version);
    if (result === "not_member" || result === "not_found") throw this.shoppingItemNotFound();
    if (result === "version_conflict") throw this.shoppingConflict();
    return { deleted: true };
  }

  async intake(userId: number, householdId: number, batchId: string, input: ShoppingIntakeInput) {
    const result = await this.repository.intake(userId, householdId, batchId, input);
    if (result.kind === "not_member") throw this.shoppingNotFound();
    if (result.kind === "version_conflict") throw new HouseholdsError(409,
      "部分采购项已被修改、取消勾选或入库，请刷新后重试", "HOUSEHOLD_SHOPPING_VERSION_CONFLICT");
    return { status: result.kind === "created" ? 201 : 200, body: result.value };
  }

  async inventory(userId: number, householdId: number) {
    const rows = await this.repository.inventory(userId, householdId);
    if (!rows) throw new HouseholdsError(403, "你无权查看该家庭保鲜仓", "FORBIDDEN");
    return rows.map(formatInventory);
  }

  async createInventory(userId: number, householdId: number, input: InventoryCreateInput) {
    if (!input.food_name || !input.expiration_date) throw new HouseholdsError(400, "食材名称与到期日为必填项", "INVALID_INPUT");
    const result = await this.repository.createInventory(userId, householdId, input);
    if (result.kind !== "completed") throw new HouseholdsError(403, "无权向该家庭添加食材", "FORBIDDEN");
    return formatInventory(result.item);
  }

  async updateInventory(userId: number, householdId: number, itemId: number, input: InventoryUpdateInput) {
    const result = await this.repository.updateInventory(userId, householdId, itemId, input);
    if (result.kind === "not_member") throw new HouseholdsError(403, "无权修改该家庭食材", "FORBIDDEN");
    if (result.kind === "not_found") throw new HouseholdsError(404, "食材不存在", "NOT_FOUND");
    return formatInventory(result.item);
  }

  async removeInventory(userId: number, householdId: number, itemId: number) {
    const result = await this.repository.removeInventory(userId, householdId, itemId);
    if (result === "not_member") throw new HouseholdsError(403, "无权操作该家庭食材", "FORBIDDEN");
    if (result === "not_found") throw new HouseholdsError(404, "食材不存在", "NOT_FOUND");
    return { message: "家庭食材已用完下架" };
  }

  async history(userId: number, householdId: number) {
    const rows = await this.repository.history(userId, householdId);
    if (!rows) throw new HouseholdsError(403, "无权查看该家庭变动日志", "FORBIDDEN");
    return rows;
  }

  private shoppingNotFound() { return new HouseholdsError(404, "家庭采购清单不存在", "HOUSEHOLD_SHOPPING_NOT_FOUND"); }
  private shoppingItemNotFound() { return new HouseholdsError(404, "家庭采购项不存在", "HOUSEHOLD_SHOPPING_ITEM_NOT_FOUND"); }
  private shoppingConflict() { return new HouseholdsError(409, "采购项已被其他成员更新，请刷新后重试", "HOUSEHOLD_SHOPPING_VERSION_CONFLICT"); }
}
