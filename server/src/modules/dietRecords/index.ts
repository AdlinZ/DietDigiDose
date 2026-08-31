import { recordFunnelEvent } from "../../services/funnelEvents.js";
import { db } from "../../storage/db.js";
import { createDietRecordsRouter } from "./route.js";
import { DietRecordsService } from "./service.js";
import { SqliteDietRecordsRepository } from "./sqliteRepository.js";

const repository = new SqliteDietRecordsRepository(db);
const service = new DietRecordsService(repository, {
  recordCookingCompleted: (userId) => recordFunnelEvent(userId, "cooking_completed"),
});

export default createDietRecordsRouter(service);
