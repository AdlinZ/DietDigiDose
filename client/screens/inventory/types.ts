export interface InventoryItem {
  id: number;
  food_name: string;
  category: string;
  quantity: string;
  expiration_date: string;
  storage_location: string;
  image_url: string | null;
  is_available: boolean;
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
}
