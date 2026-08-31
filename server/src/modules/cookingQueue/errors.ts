export type CookingQueueErrorCode =
  | "RECIPE_NOT_AVAILABLE"
  | "COOKING_QUEUE_FULL"
  | "COOKING_QUEUE_ITEM_NOT_FOUND"
  | "COOKING_QUEUE_VERSION_CONFLICT"
  | "COOKING_QUEUE_INVALID_TRANSITION";

export class CookingQueueError extends Error {
  readonly status: 404 | 409;
  readonly code: CookingQueueErrorCode;

  constructor(status: 404 | 409, message: string, code: CookingQueueErrorCode) {
    super(message);
    this.name = "CookingQueueError";
    this.status = status;
    this.code = code;
  }
}
