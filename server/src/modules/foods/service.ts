import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { FoodDomainError } from "./errors.js";
import type { FoodRepository } from "./repository.js";
import type { CustomFoodCreateData, ExternalFood, FoodLibraryRecord } from "./types.js";

type FoodServiceDependencies = {
  searchExternal: (query: string) => Promise<ExternalFood[]>;
};

function publicFood<T extends object>(food: T): Omit<T, "micronutrients_json"> & { micronutrients: unknown } {
  const { micronutrients_json: micronutrientsJson, ...result } = food as T & { micronutrients_json?: unknown };
  let micronutrients: unknown = null;
  if (typeof micronutrientsJson === "string") {
    try {
      micronutrients = JSON.parse(micronutrientsJson);
    } catch {
      micronutrients = null;
    }
  } else if (micronutrientsJson && typeof micronutrientsJson === "object") {
    micronutrients = micronutrientsJson;
  }
  return { ...result, micronutrients } as Omit<T, "micronutrients_json"> & { micronutrients: unknown };
}

export class FoodService {
  private readonly repository: FoodRepository;
  private readonly dependencies: FoodServiceDependencies;

  constructor(repository: FoodRepository, dependencies: FoodServiceDependencies) {
    this.repository = repository;
    this.dependencies = dependencies;
  }

  findByBarcode(barcode: string) {
    return this.repository.findByBarcode(barcode);
  }

  async search(query: string) {
    const normalizedQuery = normalizeContentTerm(query);
    if (!normalizedQuery) throw new FoodDomainError("搜索词不能为空");

    const localFoods = await this.repository.searchTrusted(normalizedQuery, 10);
    if (localFoods.length >= 5) return localFoods.map(publicFood);

    if (!localFoods.length) await this.repository.recordSearchGap(normalizedQuery, query);
    const externalFoods = await this.dependencies.searchExternal(query);
    const suggestions = externalFoods.map((food) => ({
      ...food,
      id: null,
      quality_status: "external_unverified",
      cacheable: false,
      requires_review: true,
    }));
    return [...localFoods.map(publicFood), ...suggestions.map(publicFood)].slice(0, 15);
  }

  async createCustom(userId: number, input: CustomFoodCreateData) {
    return {
      success: true,
      id: await this.repository.createCustom(userId, input),
      message: "提交成功，等待管理员审核后将公开",
    };
  }
}
