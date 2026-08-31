import { KitchenwareService } from "../kitchenware/service.js";
import { SqliteKitchenwareRepository } from "../kitchenware/sqliteRepository.js";
import { createRecommendationsRouter } from "./route.js";
import { RecommendationsService } from "./service.js";
import { SqliteRecommendationsRepository } from "./sqliteRepository.js";

export function createRecommendationsModule(database: ConstructorParameters<typeof SqliteRecommendationsRepository>[0]) {
  const kitchenware = new KitchenwareService(new SqliteKitchenwareRepository(database));
  return createRecommendationsRouter(new RecommendationsService(new SqliteRecommendationsRepository(database), kitchenware));
}
