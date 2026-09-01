import type {
  AdminAudit, AdminRecipeQuery, AdminRecipeSummary, AdminRecipeWrite, AuditContext, CoverageData, DuplicateWrite, RequirementWrite, Row,
} from "./types.js";

export interface AdminRecipesRepository {
  list(input: AdminRecipeQuery): Promise<{ rows: Row[]; summary: AdminRecipeSummary }>;
  duplicateSources(excludeRecipeId?: number): Promise<Row[]>;
  create(input: AdminRecipeWrite, audit: AuditContext): Promise<number>;
  update(recipeId: number, input: AdminRecipeWrite, audit: AuditContext): Promise<boolean>;
  find(recipeId: number): Promise<Row | null>;
  replaceKitchenware(recipeId: number, required: unknown[], optional: unknown[], requirements: RequirementWrite[], audit: AdminAudit): Promise<boolean>;
  scanDuplicates(recipeId: number, duplicates: DuplicateWrite[], audit: AdminAudit): Promise<void>;
  coverage(): Promise<CoverageData>;
  approve(recipeId: number, reviewerId: number, audit: AdminAudit): Promise<boolean>;
  reviewQuality(recipeId: number, status: "trusted" | "needs_review", reason: string, audit: AdminAudit): Promise<boolean>;
  reject(recipeId: number, reviewerId: number, reason: string, audit: AdminAudit): Promise<boolean>;
  remove(recipeId: number, reviewerId: number, audit: AdminAudit): Promise<boolean>;
}
