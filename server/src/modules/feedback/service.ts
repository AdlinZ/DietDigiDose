import type { FeedbackRepository } from "./repository.js";
import type { FeedbackCreateData, FeedbackReceipt } from "./types.js";

export class FeedbackService {
  private readonly repository: FeedbackRepository;

  constructor(repository: FeedbackRepository) {
    this.repository = repository;
  }

  async create(userId: number, input: FeedbackCreateData): Promise<FeedbackReceipt> {
    return {
      id: await this.repository.create(userId, input),
      status: "received",
    };
  }
}
