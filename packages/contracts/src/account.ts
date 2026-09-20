import { z } from "zod";

export const ACCOUNT_SECURITY_CAPABILITY = "passwordless-v1";
export const reauthPurposeSchema = z.enum(["password_update", "account_delete"]);
export type ReauthPurpose = z.infer<typeof reauthPurposeSchema>;
export const accountPasswordSchema = z.string().min(6).max(128).regex(/[A-Za-z]/).regex(/\d/);
export const reauthSendSchema = z.object({ purpose: reauthPurposeSchema }).strict();
export const reauthVerifySchema = z.object({ purpose: reauthPurposeSchema, challengeId: z.string().min(1).max(100), code: z.string().regex(/^\d{6}$/) }).strict();
export const setAccountPasswordSchema = z.object({ newPassword: accountPasswordSchema, reauthToken: z.string().min(32).max(256) }).strict();
export const accountDeletionSchema = z.union([
  z.object({ password: z.string().min(1).max(128), confirmation: z.literal("DELETE") }).strict(),
  z.object({ reauthToken: z.string().min(32).max(256), confirmation: z.literal("DELETE") }).strict(),
]);
export type AccountDeletionProof = { password: string } | { reauthToken: string };
