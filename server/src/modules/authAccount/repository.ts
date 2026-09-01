import type {
  AccountCredentials, AccountDeletionResult, AdminAudit, AiDataDeletion, AiDataExport, LoginIdentifier,
  LoginUser, ProfileInput, ProfileResult, RegistrationInput, RegistrationResult, Row,
} from "./types.js";

export interface AuthAccountRepository {
  createUser(input: RegistrationInput): Promise<RegistrationResult>;
  findLoginUser(identifier: LoginIdentifier | null, adminUsername: string | null): Promise<LoginUser | null>;
  recordSuccessfulLogin(userId: number, at: string, ipAddress: string): Promise<number>;
  recordFunnelEvent(userId: number, eventName: "account_registered" | "login_succeeded"): Promise<void>;
  recordAdminAudit(audit: AdminAudit): Promise<void>;
  getMe(userId: number): Promise<Row | null>;
  getCredentials(userId: number): Promise<AccountCredentials | null>;
  changePassword(userId: number, passwordHash: string): Promise<boolean>;
  updateProfile(userId: number, input: ProfileInput): Promise<ProfileResult>;
  exportAiData(userId: number): Promise<AiDataExport>;
  deleteAiData(userId: number): Promise<AiDataDeletion>;
  accountMediaUrls(userId: number): Promise<string[]>;
  deleteAccount(userId: number, actorHash: string, urls: string[], objects: unknown[]): Promise<AccountDeletionResult>;
}
