export type VerificationSubject = {
  id: number;
  user_id: number | null;
  subject_hmac: string;
  subject_ciphertext: string;
  subject_iv: string;
  subject_auth_tag: string;
};

export type VerificationChallenge = Omit<VerificationSubject, "id"> & {
  id: string;
  subject_id: number;
  purpose: string;
  out_id: string;
  biz_id: string | null;
  status: string;
  attempt_count: number;
  expires_at: string;
  registration_expires_at: string | null;
};

export type VerificationEventInput = {
  subjectId: number;
  challengeId?: string | null;
  eventType: string;
  outcome: string;
  providerCode?: string | null;
  providerMessage?: string | null;
  providerRequestId?: string | null;
  bizId?: string | null;
  outId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
};

export type UsageCounter =
  | "send_requests" | "send_api_calls" | "accepted" | "delivered" | "delivery_failed"
  | "verify_api_calls" | "verify_passed" | "verify_failed" | "local_rate_limited"
  | "provider_errors" | "delivery_units";

export type ChallengeCreate = {
  id: string;
  subjectId: number;
  purpose: "login" | "admin_test";
  outId: string;
  expiresAt: string;
  sourceIp: string | null;
  userAgent: string | null;
};

export type EventFilters = {
  userId?: number;
  username?: string;
  subjectHmac?: string;
  ip?: string;
  outcome?: string;
  providerId?: string;
};

export type EventPage = { rows: Array<Record<string, unknown>>; total: number };
export type RegistrationResult =
  | { status: "created"; userId: number }
  | { status: "invalid_token" }
  | { status: "phone_exists" }
  | { status: "username_exists" };

export type DeliveryReport = {
  bizId: string;
  outId: string;
  providerCode: string;
  providerMessage: string;
  success: boolean;
  units: number;
  details: Record<string, unknown>;
  usageDate: string;
};
