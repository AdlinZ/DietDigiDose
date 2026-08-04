export interface DietRecordActionCard {
  mealType: string;
  foodName: string;
  amount: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  saved?: boolean;
}

export interface AIWriteConfirmation {
  confirmationId: string;
  action: "record_diet_meal" | "add_inventory_item" | "add_kitchenware_item" | "record_health_log";
  payload: Record<string, unknown>;
  expiresAt: string;
  committed?: boolean;
}

export interface DietRecordMissingCard {
  dishName: string;
  missingIngredients: Array<{ name: string; amount: string }>;
  savedToList?: boolean;
}

export interface DietRecordOptionsCard {
  title: string;
  options: Array<{ label: string; actionText: string }>;
}

export interface SolutionCard {
  id: string;
  schemeTag: string;
  title: string;
  ingredients: string;
  cookingTip: string;
  macros: string;
  actionText: string;
}

export interface InventoryScanFood {
  id: string;
  foodName: string;
  quantity: string;
  suggestedStorageLocation: "冷藏" | "冷冻" | "常温";
  estimatedExpireDays: number;
  selected: boolean;
}

export interface InventoryScanCard {
  jobId: string;
  status: "processing" | "review" | "saving" | "saved" | "failed";
  items: InventoryScanFood[];
  error?: string;
}

export interface Message {
  id: string;
  sender: "ai" | "user";
  text: string;
  imageUri?: string;
  actionCard?: DietRecordActionCard;
  writeConfirmation?: AIWriteConfirmation;
  missingCard?: DietRecordMissingCard;
  optionsCard?: DietRecordOptionsCard;
  solutionCards?: SolutionCard[];
  inventoryScanCard?: InventoryScanCard;
  time: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}
