import { MealPlansError } from "./errors.js";
import type { MealPlansRepository } from "./repository.js";
import type { MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput, MealPlanUpdateInput } from "./types.js";

export class MealPlansService {
  private readonly repository: MealPlansRepository;

  constructor(repository: MealPlansRepository) { this.repository = repository; }

  list(userId: number, includeArchived: boolean) { return this.repository.list(userId, includeArchived); }
  async find(userId: number, id: string, includeArchived: boolean) {
    const plan = await this.repository.find(userId, id, includeArchived);
    if (!plan) throw new MealPlansError(404, "餐单不存在", "MEAL_PLAN_NOT_FOUND");
    return plan;
  }
  async updatePlan(userId: number, id: string, input: MealPlanUpdateInput) {
    const result = await this.repository.updatePlan(userId, id, input);
    if (result.kind === "not_found") throw new MealPlansError(404, "餐单不存在", "MEAL_PLAN_NOT_FOUND");
    if (result.kind === "invalid_date_range") throw new MealPlansError(400, "结束日期不能早于开始日期", "INVALID_DATE_RANGE");
    if (result.kind !== "updated") throw new MealPlansError(409, "餐单已在其他设备更新，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT");
    return result.value;
  }
  async removePlan(userId: number, id: string, version: number) {
    const result = await this.repository.removePlan(userId, id, version);
    if (result === "not_found") throw new MealPlansError(404, "餐单不存在", "MEAL_PLAN_NOT_FOUND");
    if (result === "version_conflict") throw new MealPlansError(409, "餐单已在其他设备更新，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT");
    return { deleted: true };
  }
  async updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput) {
    const result = await this.repository.updateItem(userId, planId, itemId, input);
    if (result.kind === "not_found") throw new MealPlansError(404, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND");
    if (result.kind === "recipe_not_available") throw new MealPlansError(404, "替换菜谱不存在或不可用", "RECIPE_NOT_AVAILABLE");
    if (result.kind !== "updated") throw new MealPlansError(409, "餐单已在其他设备更新，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT");
    return result.value;
  }
  shopping(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.execute("shopping", this.repository.addShopping(userId, planId, itemId, input));
  }
  queue(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.execute("queue", this.repository.enqueue(userId, planId, itemId, input));
  }
  complete(userId: number, planId: string, itemId: string, input: MealPlanCompleteInput) {
    return this.execute("complete", this.repository.complete(userId, planId, itemId, input));
  }
  private async execute(action: "shopping" | "queue" | "complete", operation: ReturnType<MealPlansRepository["enqueue"]>) {
    const result = await operation;
    if (result.kind === "not_found") throw new MealPlansError(404, "餐次不存在", "MEAL_PLAN_ITEM_NOT_FOUND");
    if (result.kind === "version_conflict") throw new MealPlansError(409, "餐单已在其他设备更新，请刷新后重试", "MEAL_PLAN_VERSION_CONFLICT");
    if (result.kind === "recipe_unavailable") throw new MealPlansError(409, "该餐次没有可执行的公开菜谱", "MEAL_PLAN_RECIPE_UNAVAILABLE");
    if (result.kind === "queue_full") throw new MealPlansError(409, "烹饪队列最多保留 30 道菜", "COOKING_QUEUE_FULL");
    if (result.kind === "diet_record_not_found") throw new MealPlansError(404, "饮食记录不存在", "DIET_RECORD_NOT_FOUND");
    return result.value;
  }
}
