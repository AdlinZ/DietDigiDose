export interface InventoryItem {
  id: number;
  food_name: string;
  category: string;
  quantity: string;
  expiration_date: string;
  storage_location: string;
  image_url: string | null;
  is_available: boolean;
  scope?: "personal" | "shared";
  quantity_value?: number | null;
  quantity_unit?: "g" | "kg" | "ml" | "l" | "piece" | "serving" | "bag" | "box" | "bottle" | "can" | null;
  package_size_value?: number | null;
  package_size_unit?: "g" | "kg" | "ml" | "l" | "piece" | "serving" | "bag" | "box" | "bottle" | "can" | null;
  batch_code?: string | null;
  version?: number;
  updated_at?: string;
}

export type StorageLocation = "冷藏" | "冷冻" | "常温";

export interface Recipe {
  id: number;
  title: string;
  description: string;
  image_url: string;
  cook_time: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category: string;
  tags: string[];
  quality_status?: "trusted" | "estimated" | "needs_review";
  nutrition_is_estimated?: boolean;
  ingredients?: Array<{ name: string; amount?: string }>;
  required_kitchenware?: string[];
  optional_kitchenware?: string[];
}

export interface KitchenwareItem {
  id: number;
  name: string;
  category: string;
  status: string;
  image_url: string | null;
  note?: string;
  purchase_date?: string;
  last_maintained_at?: string;
}

export interface KitchenwareCatalogItem {
  id: number;
  name: string;
  category: string;
  aliases: string;
  cooking_methods: string;
  care_note: string | null;
}

export interface DetectedFood {
  id: string;
  foodName: string;
  quantity: string;
  suggestedStorageLocation: string;
  estimatedExpireDays: number;
  selected: boolean;
  source?: "barcode" | "receipt" | "image" | "manual" | "recent";
  confidence?: number | null;
  barcode?: string | null;
  expirationDate?: string;
  missingFields?: string[];
}
