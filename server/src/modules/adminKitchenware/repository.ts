import type { AssetQuery, AuditContext, CatalogInput, CatalogQuery, Row, WriteResult } from "./types.js";

export interface AdminKitchenwareRepository {
  mappingReviews(status: string): Promise<Row[]>;
  decideMapping(id: number, input: import("./mappingReview.js").MappingDecision, audit: AuditContext): Promise<void>;
  listCatalog(input: CatalogQuery): Promise<Row[]>;
  createCatalog(input: CatalogInput, audit: AuditContext): Promise<{ kind: "created"; item: Row } | { kind: "duplicate" }>;
  updateCatalog(id: number, input: CatalogInput, audit: AuditContext): Promise<WriteResult>;
  removeCatalog(id: number, audit: AuditContext): Promise<boolean>;
  listAssets(input: AssetQuery): Promise<Row[]>;
  updateAssetStatus(id: number, status: string, audit: AuditContext): Promise<boolean>;
  removeAsset(id: number, audit: AuditContext): Promise<boolean>;
}
