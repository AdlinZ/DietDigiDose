import type {
  InventoryBulkIntakeData,
  InventoryBulkIntakeResponse,
  InventoryConsumptionData,
  InventoryConsumptionResponse,
  InventoryCreateData,
  InventoryHistoryItem,
  InventoryImportData,
  InventoryImportResponse,
  InventoryItem,
  InventoryPreviewCandidate,
  InventoryRemoveResult,
  InventoryUpdatePersistence,
  InventoryUpdateResult,
} from "./types.js";
import type { FunnelEventName } from "../../services/funnelEvents.js";

/** Driver-neutral persistence port. Implementations own atomic database transactions. */
export interface InventoryRepository {
  recordFunnelEvent(eventName: FunnelEventName, actorHash: string): Promise<void>;
  list(userId: number): Promise<InventoryItem[]>;
  findOwned(userId: number, itemId: number): Promise<InventoryItem | null>;
  create(userId: number, input: InventoryCreateData): Promise<InventoryItem>;
  importShoppingList(userId: number, input: InventoryImportData): Promise<InventoryImportResponse>;
  bulkIntake(userId: number, input: InventoryBulkIntakeData): Promise<InventoryBulkIntakeResponse>;
  listPreviewCandidates(userId: number): Promise<InventoryPreviewCandidate[]>;
  consume(userId: number, input: InventoryConsumptionData): Promise<InventoryConsumptionResponse>;
  history(userId: number, itemId: number): Promise<InventoryHistoryItem[] | null>;
  update(
    userId: number,
    itemId: number,
    expectedVersion: number,
    input: InventoryUpdatePersistence,
  ): Promise<InventoryUpdateResult>;
  remove(userId: number, item: InventoryItem): Promise<InventoryRemoveResult>;
}
