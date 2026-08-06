export type InventoryItem = {
  id: number;
  food_name: string;
  category: string;
  quantity: string;
  expiration_date: string;
  storage_location: string;
  image_url: string | null;
  is_available: boolean;
};

export type DietRecord = {
  id: number;
  meal_type: string;
  food_name: string;
  amount: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  recorded_at: string;
  image_url: string | null;
};

export type HealthLog = {
  id: number;
  weight: number | null;
  body_fat: number | null;
  water_ml: number | null;
  height_cm?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  resting_heart_rate?: number | null;
  blood_pressure_systolic?: number | null;
  blood_pressure_diastolic?: number | null;
  blood_glucose_mmol?: number | null;
  cycle_status?: string | null;
  sleep_hours?: number | null;
  recorded_date: string;
};

export type Recipe = {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  cook_time: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category: string;
  tags: string[];
  steps: string[];
  ingredients: Array<{ name: string; amount: string; group?: string }>;
  status?: "pending" | "approved" | "rejected";
};

export type CommunityPost = {
  id: number;
  user_id: number;
  username: string;
  nickname?: string | null;
  avatar_url?: string | null;
  content: string;
  image_url: string | null;
  image_urls?: string[];
  likes_count: number;
  created_at: string;
  category?: string;
  is_liked?: boolean;
};
