import { createAiContextService } from "../modules/aiContext/index.js";
import { configureAiContextService } from "../modules/aiContext/runtime.js";
import { SqliteAiContextRepository } from "../modules/aiContext/sqliteRepository.js";
import { createAIConversationsService } from "../modules/aiConversations/index.js";
import { configureAIConversationsService } from "../modules/aiConversations/runtime.js";
import { SqliteAIConversationsRepository } from "../modules/aiConversations/sqliteRepository.js";
import { createAIRuntimeService } from "../modules/aiRuntime/index.js";
import { configureAIRuntimeService } from "../modules/aiRuntime/runtime.js";
import { SqliteAIRuntimeRepository } from "../modules/aiRuntime/sqliteRepository.js";
import { createAuthVerificationService } from "../modules/authVerification/index.js";
import { configureAuthVerificationService } from "../modules/authVerification/runtime.js";
import { SqliteAuthVerificationRepository } from "../modules/authVerification/sqliteRepository.js";
import { createNotificationsService } from "../modules/notifications/index.js";
import { configureNotificationsService } from "../modules/notifications/runtime.js";
import { SqliteNotificationsRepository } from "../modules/notifications/sqliteRepository.js";
import { createAiToolDataService } from "../modules/aiToolData/index.js";
import { SqliteAiToolDataRepository } from "../modules/aiToolData/sqliteRepository.js";
import { createAIWriteConfirmationsService } from "../modules/aiWriteConfirmations/index.js";
import { configureAIWriteConfirmationsService } from "../modules/aiWriteConfirmations/runtime.js";
import { SqliteAIWriteConfirmationsRepository } from "../modules/aiWriteConfirmations/sqliteRepository.js";
import { createAdminAuditService } from "../modules/adminAudit/index.js";
import { SqliteAdminAuditRepository } from "../modules/adminAudit/sqliteRepository.js";
import { createAgentSchedulingService } from "../modules/agentScheduling/index.js";
import { configureAgentSchedulingService } from "../modules/agentScheduling/runtime.js";
import { SqliteAgentSchedulingRepository } from "../modules/agentScheduling/sqliteRepository.js";
import { createAgentOperationsService } from "../modules/agentOperations/index.js";
import { configureAgentOperationsService } from "../modules/agentOperations/runtime.js";
import { SqliteAgentOperationsRepository } from "../modules/agentOperations/sqliteRepository.js";
import { createAgentRunsService } from "../modules/agentRuns/index.js";
import { configureAgentRunsService } from "../modules/agentRuns/runtime.js";
import { SqliteAgentRunsRepository } from "../modules/agentRuns/sqliteRepository.js";
import { createKitchenwareModule } from "../modules/kitchenware/index.js";
import { createRecipesModule } from "../modules/recipes/index.js";
import { createRecommendationsRuntime } from "../modules/recommendations/index.js";
import { configureRecommendationsService } from "../modules/recommendations/runtime.js";
import { createRealtimeVoiceModule } from "../modules/realtimeVoice/index.js";
import { db, initDatabase } from "../storage/db.js";
import { configureAiToolDataService } from "../services/aiTools.js";
import { configureAdminAuditService } from "../routes/admin/shared.js";

export function initializeSqliteApplication() {
  initDatabase();
  configureAiContextService(createAiContextService(new SqliteAiContextRepository(db)));
  configureAIConversationsService(createAIConversationsService(new SqliteAIConversationsRepository(db)));
  configureAIRuntimeService(createAIRuntimeService(new SqliteAIRuntimeRepository(db)));
  configureAuthVerificationService(createAuthVerificationService(new SqliteAuthVerificationRepository(db)));
  configureNotificationsService(createNotificationsService(new SqliteNotificationsRepository(db)));
  configureAiToolDataService(createAiToolDataService(new SqliteAiToolDataRepository(db)));
  configureAIWriteConfirmationsService(createAIWriteConfirmationsService(new SqliteAIWriteConfirmationsRepository(db)));
  configureAdminAuditService(createAdminAuditService(new SqliteAdminAuditRepository(db)));
  configureAgentSchedulingService(createAgentSchedulingService(new SqliteAgentSchedulingRepository(db)));
  configureAgentOperationsService(createAgentOperationsService(new SqliteAgentOperationsRepository(db)));
  configureAgentRunsService(createAgentRunsService(new SqliteAgentRunsRepository(db)));
  const recommendations = createRecommendationsRuntime(db);
  configureRecommendationsService(recommendations.service);
  return {
    kitchenwareRoutes: createKitchenwareModule(db),
    recipesRoutes: createRecipesModule(db),
    recommendationRoutes: recommendations.routes,
    realtimeVoiceRoutes: createRealtimeVoiceModule(db),
  };
}

export function initializeSqliteWorker() {
  initDatabase();
  configureNotificationsService(createNotificationsService(new SqliteNotificationsRepository(db)));
}
