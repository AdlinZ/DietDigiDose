/** Identifiers only: workers reload current facts rather than applying stale event snapshots. */
export type MaintenanceEvent = {
  userId: number;
  kind: "inventory_created" | "cooking_completion" | "production" | "eat" | "discard" | "reschedule" | "intake_correction";
  sourceId: string;
  subjectId: string;
  details?: { version?: number; planItemId?: string | null; inventoryItemIds?: number[]; mode?: string };
};
