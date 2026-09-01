import { db } from "../../storage/db.js";
import { RateLimitsService } from "./service.js";
import { SqliteRateLimitsRepository } from "./sqliteRepository.js";

export const rateLimitsService = new RateLimitsService(new SqliteRateLimitsRepository(db));
export { hashRateLimitKey } from "./service.js";
