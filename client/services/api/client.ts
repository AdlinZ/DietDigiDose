import { API_BASE } from "@/utils/config";

export type ApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  requestId?: string;

  constructor(message: string, status: number, body?: Record<string, unknown> | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : undefined;
    this.details = body?.details;
    this.requestId = typeof body?.requestId === "string" ? body.requestId : undefined;
  }
}

export const apiUrl = (path: string) => {
  if (/^https?:\/\//.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE.replace(/\/$/, "")}${normalizedPath}`;
};

const inFlightMutations = new Map<string, Promise<unknown>>();
const fetchIdentities = new WeakMap<ApiFetch, number>();
let nextFetchIdentity = 1;

function getFetchIdentity(apiFetch: ApiFetch) {
  const existing = fetchIdentities.get(apiFetch);
  if (existing) return existing;
  const identity = nextFetchIdentity;
  nextFetchIdentity += 1;
  fetchIdentities.set(apiFetch, identity);
  return identity;
}

export function requestJson<T>(
  apiFetch: ApiFetch,
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const mutationKey = method === "GET" || method === "HEAD"
    ? null
    : `${getFetchIdentity(apiFetch)}:${method}:${path}:${typeof options.body === "string" ? options.body : ""}`;
  const existing = mutationKey ? inFlightMutations.get(mutationKey) : undefined;
  if (existing) return existing as Promise<T>;

  const request = executeJsonRequest<T>(apiFetch, path, options);
  if (mutationKey) {
    inFlightMutations.set(mutationKey, request);
    void request.finally(() => {
      if (inFlightMutations.get(mutationKey) === request) inFlightMutations.delete(mutationKey);
    }).catch(() => undefined);
  }
  return request;
}

async function executeJsonRequest<T>(
  apiFetch: ApiFetch,
  path: string,
  options: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 15_000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const callerSignal = requestOptions.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const response = await apiFetch(apiUrl(path), {
      ...requestOptions,
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as T | Record<string, unknown> | null;
    if (!response.ok) {
      const errorBody = body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null;
      throw new ApiError(
        typeof errorBody?.error === "string" ? errorBody.error : `请求失败（${response.status}）`,
        response.status,
        errorBody,
      );
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export const publicFetch: ApiFetch = (input, init) => fetch(input, init);
