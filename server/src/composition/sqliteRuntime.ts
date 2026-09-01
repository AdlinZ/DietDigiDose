import { createAiContextService } from "../modules/aiContext/index.js";
import { configureAiContextService } from "../modules/aiContext/runtime.js";
import { SqliteAiContextRepository } from "../modules/aiContext/sqliteRepository.js";
import { createAiToolDataService } from "../modules/aiToolData/index.js";
import { SqliteAiToolDataRepository } from "../modules/aiToolData/sqliteRepository.js";
import { createAdminAuditService } from "../modules/adminAudit/index.js";
import { SqliteAdminAuditRepository } from "../modules/adminAudit/sqliteRepository.js";
import { createKitchenwareModule } from "../modules/kitchenware/index.js";
import { createRecipesModule } from "../modules/recipes/index.js";
import { createRecommendationsRuntime } from "../modules/recommendations/index.js";
import { configureRecommendationsService } from "../modules/recommendations/runtime.js";
import { db, initDatabase } from "../storage/db.js";
import { configureAiToolDataService } from "../services/aiTools.js";
import { configureAdminAuditService } from "../routes/admin/shared.js";

export function initializeSqliteApplication() {
  initDatabase();
  configureAiContextService(createAiContextService(new SqliteAiContextRepository(db)));
  configureAiToolDataService(createAiToolDataService(new SqliteAiToolDataRepository(db)));
  configureAdminAuditService(createAdminAuditService(new SqliteAdminAuditRepository(db)));
  const recommendations = createRecommendationsRuntime(db);
  configureRecommendationsService(recommendations.service);
  return {
    kitchenwareRoutes: createKitchenwareModule(db),
    recipesRoutes: createRecipesModule(db),
    recommendationRoutes: recommendations.routes,
  };
}

export function initializeSqliteWorker() {
  initDatabase();
}
