import { z } from "zod";

export const ACCOUNT_SECURITY_CAPABILITY = "passwordless-v1";
export const reauthPurposeSchema = z.enum(["password_update", "account_delete"]);
export type ReauthPurpose = z.infer<typeof reauthPurposeSchema>;
export const ACCOUNT_PASSWORD_MAX_UTF8_BYTES = 72;
export const ACCOUNT_PASSWORD_REQUIREMENTS = "密码至少6位，包含字母和数字，且 UTF-8 编码不超过72字节";
// Deliberately independent of Buffer/TextEncoder so the same rule works in React Native.
// Lone surrogates, like a UTF-8 encoder's replacement character, occupy three bytes.
export function isPasswordWithinByteLimit(password: string): boolean {
  let bytes = 0;
  for (const character of password) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > ACCOUNT_PASSWORD_MAX_UTF8_BYTES) return false;
  }
  return true;
}
// This schema is for NEW credentials only. Existing password proofs retain their legacy limits.
export const accountPasswordSchema = z.string().min(6, ACCOUNT_PASSWORD_REQUIREMENTS).max(128, ACCOUNT_PASSWORD_REQUIREMENTS)
  .regex(/[A-Za-z]/, ACCOUNT_PASSWORD_REQUIREMENTS).regex(/\d/, ACCOUNT_PASSWORD_REQUIREMENTS)
  .refine(isPasswordWithinByteLimit, ACCOUNT_PASSWORD_REQUIREMENTS);
export const reauthSendSchema = z.object({ purpose: reauthPurposeSchema }).strict();
export const reauthVerifySchema = z.object({ purpose: reauthPurposeSchema, challengeId: z.string().min(1).max(100), code: z.string().regex(/^\d{6}$/) }).strict();
export const setAccountPasswordSchema = z.object({ newPassword: accountPasswordSchema, reauthToken: z.string().min(32).max(256) }).strict();
export const accountDeletionSchema = z.union([
  z.object({ password: z.string().min(1).max(128), confirmation: z.literal("DELETE") }).strict(),
  z.object({ reauthToken: z.string().min(32).max(256), confirmation: z.literal("DELETE") }).strict(),
]);
export type AccountDeletionProof = { password: string } | { reauthToken: string };

export const passwordRecoverySendSchema = z.object({ phone: z.string().regex(/^1[3-9]\d{9}$/) }).strict();
export const passwordRecoveryVerifySchema = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict();
export const passwordRecoveryTokenSchema = z.string().regex(/^[1-9]\d{0,15}\.[A-Za-z0-9_-]{43}$/)
  .refine((token) => Number.isSafeInteger(Number(token.split(".")[0])));
export const passwordRecoveryResetSchema = z.object({ recoveryToken: passwordRecoveryTokenSchema, newPassword: accountPasswordSchema }).strict();
