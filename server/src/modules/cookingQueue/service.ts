import { randomUUID } from "node:crypto";
import { CookingQueueError } from "./errors.js";
import type { CookingQueueRepository } from "./repository.js";
import type { QueueCreateInput, QueueRow, QueueUpdateInput } from "./types.js";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === "object") return value as T;
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

export function formatQueueItem(row: QueueRow) {
  const snapshot = parseJson<Record<string, unknown>>(row.recipe_snapshot_json, {});
  const currentIngredients = parseJson<unknown[]>(row.current_ingredients_json, []);
  return {
    id: String(row.id),
    recipeId: Number(row.recipe_id),
    position: Number(row.position),
    status: String(row.status),
    mealType: row.meal_type ? String(row.meal_type) : null,
    plannedAt: row.planned_at ? String(row.planned_at) : null,
    version: Number(row.version),
    title: String(row.current_title || snapshot.title || "已失效菜谱"),
    imageUrl: row.current_image_url === null || row.current_image_url === undefined
      ? (typeof snapshot.imageUrl === "string" ? snapshot.imageUrl : null)
      : String(row.current_image_url),
    cookTime: Number(row.current_cook_time ?? snapshot.cookTime ?? 0),
    calories: Number(row.current_calories ?? snapshot.calories ?? 0),
    difficulty: String(row.current_difficulty || snapshot.difficulty || "难度未知"),
    ingredients: currentIngredients.length ? currentIngredients : Array.isArray(snapshot.ingredients) ? snapshot.ingredients : [],
    preparedIngredientNames: parseJson<string[]>(row.prepared_ingredients_json, []),
    shoppingListSyncedAt: row.shopping_list_synced_at ? String(row.shopping_list_synced_at) : null,
    recipeAvailable: Boolean(row.current_title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

const transitions: Record<string, Set<string>> = {
  waiting: new Set(["waiting", "preparing", "ready", "cooking", "cancelled"]),
  preparing: new Set(["waiting", "preparing", "ready", "cooking", "cancelled"]),
  ready: new Set(["preparing", "ready", "cooking", "cancelled"]),
  cooking: new Set(["cooking", "completed", "cancelled"]),
  completed: new Set(["completed"]),
  cancelled: new Set(["cancelled"]),
};

const notFound = () => new CookingQueueError(404, "烹饪队列项不存在", "COOKING_QUEUE_ITEM_NOT_FOUND");
const versionConflict = () => new CookingQueueError(409, "烹饪队列已在其他设备更新，请刷新后重试", "COOKING_QUEUE_VERSION_CONFLICT");
const invalidTransition = (message = "当前烹饪状态不能执行该操作") =>
  new CookingQueueError(409, message, "COOKING_QUEUE_INVALID_TRANSITION");

export class CookingQueueService {
  private readonly repository: CookingQueueRepository;

  constructor(repository: CookingQueueRepository) {
    this.repository = repository;
  }

  async list(userId: number, includeHistory: boolean) {
    return (await this.repository.list(userId, includeHistory)).map(formatQueueItem);
  }

  async create(userId: number, input: QueueCreateInput) {
    const recipe = await this.repository.findApprovedRecipe(input.recipeId);
    if (!recipe) throw new CookingQueueError(404, "菜谱不存在或尚未通过审核", "RECIPE_NOT_AVAILABLE");
    const result = await this.repository.enqueue({
      id: randomUUID(), userId, recipeId: input.recipeId, idempotencyKey: input.idempotencyKey,
      plannedAt: input.plannedAt, mealType: input.mealType,
      snapshot: {
        title: recipe.title, imageUrl: recipe.image_url, cookTime: recipe.cook_time,
        calories: recipe.calories, difficulty: recipe.difficulty,
        ingredients: parseJson<unknown[]>(recipe.ingredients_json, []),
      },
    }, 30);
    if (result.kind === "full") throw new CookingQueueError(409, "烹饪队列最多保留 30 道菜", "COOKING_QUEUE_FULL");
    return { item: formatQueueItem(result.row), added: result.kind === "created" };
  }

  async update(id: string, userId: number, input: QueueUpdateInput) {
    const current = await this.repository.findOwned(id, userId);
    if (!current) throw notFound();
    if (Number(current.version) !== input.version) throw versionConflict();
    if (input.status && !transitions[String(current.status)]?.has(input.status)) throw invalidTransition();
    const nextStatus = input.status ?? String(current.status);
    const updated = await this.repository.update(id, userId, input.version, {
      status: nextStatus as QueueUpdateInput["status"] & string,
      mealType: input.mealType === undefined ? current.meal_type : input.mealType,
      plannedAt: input.plannedAt === undefined ? current.planned_at : input.plannedAt,
      preparedIngredients: input.preparedIngredientNames === undefined
        ? current.prepared_ingredients_json : [...new Set(input.preparedIngredientNames)],
      shoppingListSyncedAt: input.shoppingListSyncedAt === undefined
        ? current.shopping_list_synced_at : input.shoppingListSyncedAt,
      completedAt: nextStatus === "completed" ? new Date().toISOString() : current.completed_at,
    });
    if (!updated) throw versionConflict();
    return formatQueueItem(updated);
  }

  async reorder(userId: number, items: Array<{ id: string; version: number }>) {
    const rows = await this.repository.reorder(userId, items);
    if (!rows) throw versionConflict();
    return rows.map(formatQueueItem);
  }

  async start(id: string, userId: number, version: number) {
    const current = await this.repository.findOwned(id, userId);
    if (!current) throw notFound();
    if (current.status === "cooking") return formatQueueItem(current);
    if (!["waiting", "preparing", "ready"].includes(String(current.status))) throw invalidTransition("这道菜当前不能开始烹饪");
    const updated = await this.repository.transition(id, userId, version, "cooking");
    if (!updated) throw versionConflict();
    return formatQueueItem(updated);
  }

  async complete(id: string, userId: number, version: number) {
    const current = await this.repository.findOwned(id, userId);
    if (!current) throw notFound();
    if (current.status === "completed") return formatQueueItem(current);
    if (current.status !== "cooking") throw invalidTransition("请先开始烹饪再完成");
    const updated = await this.repository.transition(id, userId, version, "completed");
    if (!updated) throw versionConflict();
    return formatQueueItem(updated);
  }

  async cancel(id: string, userId: number) {
    if (!await this.repository.cancel(id, userId)) throw notFound();
    return { success: true as const };
  }

  async cancelAll(userId: number) {
    return { success: true as const, count: await this.repository.cancelAll(userId) };
  }
}
