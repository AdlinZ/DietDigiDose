import type { PreparedMealEventInput } from "@dietdigidose/contracts";
import { prepareProduction, prepareMealEvent } from "./preparedMeals.js";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { recordFunnelEvent } from "../../services/funnelEvents.js";
import type { DietRecordsRepository } from "./repository.js";
import type { CookingCompletionInput, DietRecordInput, PreparedDietRecord } from "./types.js";

export class DietRecordsService {
  private readonly repository: DietRecordsRepository;

  constructor(repository: DietRecordsRepository) { this.repository = repository; }

  list(userId: number, date?: string) { return this.repository.list(userId, date); }

  prepareRecord(record: DietRecordInput): PreparedDietRecord {
    const today = currentDateKey();
    const recordedAt = record.recorded_at || today;
    return {
      ...record,
      amount: record.amount || "1份",
      recorded_at: recordedAt,
      recorded_time: record.recorded_time ?? (recordedAt === today ? currentTimeKey() : null),
    };
  }

  create(userId: number, record: DietRecordInput) {
    return this.repository.create(userId, this.prepareRecord(record));
  }

  remove(userId: number, id: number) { return this.repository.remove(userId, id); }

  listPreparedMeals(userId: number) { return this.repository.listPreparedMeals(userId); }
  applyMealEvent(userId: number, mealId: string, input: PreparedMealEventInput) {
    return this.repository.applyMealEvent(userId, mealId, prepareMealEvent(input));
  }

  async completeCooking(userId: number, input: CookingCompletionInput) {
    if (Boolean(input.production) === Boolean(input.diet_record)) throw new Error("请提供制作分配或旧版饮食记录，不能同时提交");
    const result = await this.repository.completeCooking(userId, {
      ...input,
      inventory_item_ids: [...new Set(input.inventory_item_ids)],
      diet_record: input.diet_record ? this.prepareRecord(input.diet_record) : undefined,
      production: input.production ? prepareProduction(input.production) : undefined,
    });
    if (!result.repeated) await recordFunnelEvent(userId, "cooking_completed",
      (eventName, actorHash) => this.repository.recordFunnelEvent(eventName, actorHash));
    return result;
  }
}
