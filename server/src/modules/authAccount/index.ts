import { processMediaCleanupJob } from "../mediaCleanup/index.js";
import { db } from "../../storage/db.js";
import { createAuthAccountRouter as createRouter } from "./route.js";
import { AuthAccountService } from "./service.js";
import { SqliteAuthAccountRepository } from "./sqliteRepository.js";

export function createAuthAccountRouter() {
  return createRouter(new AuthAccountService(new SqliteAuthAccountRepository(db), processMediaCleanupJob));
}
