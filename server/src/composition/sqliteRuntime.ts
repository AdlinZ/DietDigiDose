import { createKitchenwareModule } from "../modules/kitchenware/index.js";
import { createRecipesModule } from "../modules/recipes/index.js";
import { createRecommendationsModule } from "../modules/recommendations/index.js";
import { db, initDatabase } from "../storage/db.js";

export function initializeSqliteApplication() {
  initDatabase();
  return {
    kitchenwareRoutes: createKitchenwareModule(db),
    recipesRoutes: createRecipesModule(db),
    recommendationRoutes: createRecommendationsModule(db),
  };
}

export function initializeSqliteWorker() {
  initDatabase();
}
