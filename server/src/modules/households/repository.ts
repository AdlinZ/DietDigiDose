import type {
  IntakeRepositoryResult, InventoryCreateInput, InventoryMutationResult, InventoryUpdateInput, JoinResult,
  LeaveResult, Row, ShoppingCreateInput, ShoppingCreateResult, ShoppingDeleteResult, ShoppingIntakeInput,
  ShoppingMutationResult, ShoppingUpdateInput, TransferResult,
} from "./types.js";

export interface HouseholdsRepository {
  create(userId: number, name: string, inviteCode: string): Promise<Row | null>;
  mine(userId: number): Promise<Row[]>;
  join(userId: number, inviteCode: string): Promise<JoinResult>;
  leave(userId: number, householdId: number): Promise<LeaveResult>;
  transferOwner(userId: number, householdId: number, newOwnerUserId: number, version: number): Promise<TransferResult>;
  shoppingList(userId: number, householdId: number): Promise<Row[] | null>;
  createShopping(userId: number, householdId: number, id: string, input: ShoppingCreateInput): Promise<ShoppingCreateResult>;
  updateShopping(userId: number, householdId: number, itemId: string, input: ShoppingUpdateInput): Promise<ShoppingMutationResult>;
  removeShopping(userId: number, householdId: number, itemId: string, version: number): Promise<ShoppingDeleteResult>;
  intake(userId: number, householdId: number, batchId: string, input: ShoppingIntakeInput): Promise<IntakeRepositoryResult>;
  inventory(userId: number, householdId: number): Promise<Row[] | null>;
  createInventory(userId: number, householdId: number, input: InventoryCreateInput): Promise<InventoryMutationResult>;
  updateInventory(userId: number, householdId: number, itemId: number, input: InventoryUpdateInput): Promise<InventoryMutationResult>;
  removeInventory(userId: number, householdId: number, itemId: number): Promise<"not_member" | "not_found" | "removed">;
  history(userId: number, householdId: number): Promise<Row[] | null>;
}
