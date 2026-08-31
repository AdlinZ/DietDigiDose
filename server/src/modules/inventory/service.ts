import {
  inventoryBulkIntakeResponseSchema,
  inventoryConsumptionPreviewResponseSchema,
  inventoryConsumptionResponseSchema,
  inventoryDeleteResponseSchema,
  inventoryHistoryResponseSchema,
  inventoryImportResponseSchema,
  inventoryItemSchema,
  inventoryListResponseSchema,
  type InventoryUnit,
} from "@dietdigidose/contracts";
import {
  buildFefoConsumptionPreviewFromCandidates,
  InventoryQuantityError,
} from "../../services/inventoryQuantity.js";
import { InventoryDomainError, type InventoryDomainErrorCode } from "./errors.js";
import type { InventoryRepository } from "./repository.js";
import type {
  InventoryBulkIntakeData,
  InventoryConsumptionData,
  InventoryConsumptionPreviewData,
  InventoryCreateData,
  InventoryImportData,
  InventoryUpdateData,
} from "./types.js";

type InventoryServiceDependencies = {
  recordInventoryAdded?: (userId: number) => void;
};

export class InventoryService {
  private readonly repository: InventoryRepository;
  private readonly dependencies: InventoryServiceDependencies;

  constructor(
    repository: InventoryRepository,
    dependencies: InventoryServiceDependencies = {},
  ) {
    this.repository = repository;
    this.dependencies = dependencies;
  }

  async list(userId: number) {
    return inventoryListResponseSchema.parse(await this.repository.list(userId));
  }

  async create(userId: number, input: InventoryCreateData) {
    const item = inventoryItemSchema.parse(await this.repository.create(userId, input));
    this.dependencies.recordInventoryAdded?.(userId);
    return item;
  }

  async importShoppingList(userId: number, input: InventoryImportData) {
    const response = inventoryImportResponseSchema.parse(await this.repository.importShoppingList(userId, input));
    if (!response.repeated && response.items.length > 0) this.dependencies.recordInventoryAdded?.(userId);
    return response;
  }

  async bulkIntake(userId: number, input: InventoryBulkIntakeData) {
    const response = inventoryBulkIntakeResponseSchema.parse(await this.repository.bulkIntake(userId, input));
    if (!response.repeated && response.items.length > 0) this.dependencies.recordInventoryAdded?.(userId);
    return response;
  }

  async previewConsumption(userId: number, input: InventoryConsumptionPreviewData) {
    const candidates = await this.repository.listPreviewCandidates(userId);
    return inventoryConsumptionPreviewResponseSchema.parse({
      items: buildFefoConsumptionPreviewFromCandidates(candidates, input.items),
    });
  }

  async consume(userId: number, input: InventoryConsumptionData) {
    try {
      return inventoryConsumptionResponseSchema.parse(await this.repository.consume(userId, input));
    } catch (error) {
      if (error instanceof InventoryQuantityError) {
        throw new InventoryDomainError(error.code as InventoryDomainErrorCode, error.message);
      }
      throw error;
    }
  }

  async history(userId: number, itemId: number) {
    const history = await this.repository.history(userId, itemId);
    if (!history) throw new InventoryDomainError("INVENTORY_NOT_FOUND", "食材不存在或无权查看");
    return inventoryHistoryResponseSchema.parse(history);
  }

  async update(userId: number, itemId: number, patch: InventoryUpdateData) {
    const item = await this.repository.findOwned(userId, itemId);
    if (!item) throw new InventoryDomainError("INVENTORY_NOT_FOUND", "食材不存在或无权修改");

    const has = (key: keyof InventoryUpdateData) => Object.prototype.hasOwnProperty.call(patch, key);
    const nextQuantityValue = has("quantity_value") ? patch.quantity_value ?? null : item.quantity_value ?? null;
    const nextQuantityUnit = has("quantity_unit") ? patch.quantity_unit ?? null : item.quantity_unit ?? null;
    if ((nextQuantityValue == null) !== (nextQuantityUnit == null)) {
      throw new InventoryDomainError("INVALID_STRUCTURED_QUANTITY", "结构化数量和单位必须同时填写");
    }
    if (patch.version !== undefined && item.version !== patch.version) {
      throw new InventoryDomainError("INVENTORY_VERSION_CONFLICT", "库存已在其他设备更新，请刷新后重试");
    }

    const result = await this.repository.update(userId, itemId, item.version, {
      patch,
      nextQuantityValue,
      nextQuantityUnit: nextQuantityUnit as InventoryUnit | null,
    });
    if (result.kind === "conflict") {
      throw new InventoryDomainError("INVENTORY_VERSION_CONFLICT", "库存已变化，请刷新后重试");
    }
    return inventoryItemSchema.parse(result.item);
  }

  async remove(userId: number, itemId: number) {
    const item = await this.repository.findOwned(userId, itemId);
    if (!item) throw new InventoryDomainError("INVENTORY_NOT_FOUND", "未找到相关食材");
    const result = await this.repository.remove(userId, item);
    if (result.kind === "not_found") throw new InventoryDomainError("INVENTORY_NOT_FOUND", "未找到相关食材");
    return inventoryDeleteResponseSchema.parse({ message: "删除成功" });
  }
}
