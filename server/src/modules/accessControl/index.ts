import { db } from "../../storage/db.js";
import { AccessControlService } from "./service.js";
import { SqliteAccessControlRepository } from "./sqliteRepository.js";

export const accessControlService = new AccessControlService(new SqliteAccessControlRepository(db));
export const signUserToken = (userId: number) => accessControlService.signUserToken(userId);
export const ensureUserInitialState = (userId: number) => accessControlService.ensureUserInitialState(userId);
export const recordFunnelEvent = (userId: number, eventName: "account_registered" | "login_succeeded") =>
  accessControlService.recordFunnelEvent(userId, eventName);
export type { SessionTokenClaims } from "./types.js";
