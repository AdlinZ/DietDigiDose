export type FeedbackCategory = "issue" | "suggestion" | "support";

export type FeedbackContext = {
  page?: string;
  recipeId?: number;
  recipeTitle?: string;
};

export type FeedbackCreateData = {
  category: FeedbackCategory;
  content: string;
  context?: FeedbackContext;
};

export type FeedbackReceipt = {
  id: number;
  status: "received";
};
