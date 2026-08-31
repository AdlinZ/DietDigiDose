import { db } from "../../storage/db.js";
import { recordFunnelEvent } from "../../services/funnelEvents.js";
import { createInventoryRouter } from "./route.js";
import { InventoryService } from "./service.js";
import { SqliteInventoryRepository } from "./sqliteRepository.js";

const repository = new SqliteInventoryRepository(db);
const service = new InventoryService(repository, {
  recordInventoryAdded: (userId) => recordFunnelEvent(userId, "inventory_added"),
});

export default createInventoryRouter(service);
