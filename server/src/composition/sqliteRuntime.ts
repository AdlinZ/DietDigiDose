import { createAiToolDataService } from "../modules/aiToolData/index.js";
import { SqliteAiToolDataRepository } from "../modules/aiToolData/sqliteRepository.js";
import { createKitchenwareModule } from "../modules/kitchenware/index.js";
import { createRecipesModule } from "../modules/recipes/index.js";
import { createRecommendationsModule } from "../modules/recommendations/index.js";
import { db, initDatabase } from "../storage/db.js";
import { configureAiToolDataService } from "../services/aiTools.js";

export function initializeSqliteApplication() {
  initDatabase();
  configureAiToolDataService(createAiToolDataService(new SqliteAiToolDataRepository(db)));
  return {
    kitchenwareRoutes: createKitchenwareModule(db),
    recipesRoutes: createRecipesModule(db),
    recommendationRoutes: createRecommendationsModule(db),
  };
}

export function initializeSqliteWorker() {
  initDatabase();
}
