export type Row = Record<string, unknown>;

export type KitchenwareInput = {
  name: string;
  category: string;
  status: string;
  note: string;
  imageUrl: string;
  purchaseDate: string;
};

export type StoredKitchenwareInput = KitchenwareInput & {
  originalName: string | null;
  catalogId: number | null;
};

export type ResolvedCatalog = {
  id: number;
  name: string;
  category: string;
  confidence: number;
  attributes: Row;
  capabilities: Array<{ code: string; name: string; safetyLevel: string; constraints: Row }>;
};

export type KitchenwareRequirement = {
  role: string;
  catalogId: number | null;
  catalogName: string | null;
  capabilityCode: string | null;
  confidence: number;
  notes: string;
};
