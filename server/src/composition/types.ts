import type { Router } from "express";
import type { CommunityService } from "../modules/community/service.js";
import type { MediaCleanupService } from "../modules/mediaCleanup/service.js";
import type { WorkerRuntime } from "../modules/worker/service.js";

export type DatabaseDriver = "sqlite" | "postgresql";

export type ApplicationRoutes = {
  auth: Router;
  webhooks: Router;
  inventory: Router;
  dietRecords: Router;
  healthData: Router;
  recipes: Router;
  foods: Router;
  community: Router;
  admin: Router;
  realtimeVoice: Router;
  voicePacks: Router;
  ai: Router;
  agentRuns: Router;
  shopping: Router;
  cookingQueue: Router;
  mealPlans: Router;
  insights: Router;
  recommendations: Router;
  kitchenware: Router;
  notifications: Router;
  media: Router;
  households: Router;
  feedback: Router;
};

export type ApplicationRuntime = {
  driver: DatabaseDriver;
  routes: ApplicationRoutes;
  communityService: Pick<CommunityService, "resolveShare">;
  close(): Promise<void>;
};

export type WorkerRuntimeBundle = {
  driver: DatabaseDriver;
  worker: WorkerRuntime;
  mediaCleanup: MediaCleanupService;
  close(): Promise<void>;
};
