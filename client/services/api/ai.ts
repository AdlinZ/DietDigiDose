import { requestJson, type ApiFetch } from "./client";

export const aiApi = {
  chat: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/ai/chat", { method: "POST", body: JSON.stringify(input), timeoutMs: 60_000 }),
  deleteConversation: <T>(apiFetch: ApiFetch, sessionId: string) => requestJson<T>(apiFetch, `/api/v1/ai/chat-conversations/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  commitWriteConfirmation: <T>(apiFetch: ApiFetch, confirmationId: string, idempotencyKey: string) => requestJson<T>(apiFetch, `/api/v1/ai/write-confirmations/${confirmationId}/commit`, { method: "POST", body: JSON.stringify({ idempotencyKey }) }),
  homeRecommendations: <T>(apiFetch: ApiFetch, period: string, signal?: AbortSignal) => requestJson<T>(apiFetch, "/api/v1/ai/home-recommendations", { method: "POST", body: JSON.stringify({ period }), signal, timeoutMs: 15_000 }),
  visionFood: <T>(apiFetch: ApiFetch, image: string, userPrompt?: string) => requestJson<T>(apiFetch, "/api/v1/ai/vision-food", { method: "POST", body: JSON.stringify({ image, userPrompt }), timeoutMs: 60_000 }),
  createInventoryScan: <T>(apiFetch: ApiFetch, image: string, signal?: AbortSignal) => requestJson<T>(apiFetch, "/api/v1/ai/inventory-scan-jobs", { method: "POST", body: JSON.stringify({ image }), signal, timeoutMs: 20_000 }),
  inventoryScan: <T>(apiFetch: ApiFetch, jobId: string) => requestJson<T>(apiFetch, `/api/v1/ai/inventory-scan-jobs/${jobId}`),
  scanReceipt: <T>(apiFetch: ApiFetch, image: string) => requestJson<T>(apiFetch, "/api/v1/ai/scan-receipt", { method: "POST", body: JSON.stringify({ image }), timeoutMs: 60_000 }),
  voiceCommand: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/ai/voice-command", { method: "POST", body: JSON.stringify(input), timeoutMs: 60_000 }),
  transcribe: <T>(apiFetch: ApiFetch, audioBase64: string, mimeType: string) => requestJson<T>(apiFetch, "/api/v1/ai/transcribe", { method: "POST", body: JSON.stringify({ audioBase64, mimeType }), timeoutMs: 60_000 }),
};
