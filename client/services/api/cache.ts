import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ApiError, ApiFetch } from "./client";

export const API_CACHE_SCHEMA_VERSION = 2;
export const API_CACHE_STORAGE_PREFIX = `offline_cache_query_v${API_CACHE_SCHEMA_VERSION}:`;
const MAX_PERSISTED_BYTES = 5 * 1024 * 1024;

type CacheScope = "public" | `user:${number}`;

export type ApiCachePolicy = {
  ttlMs: number;
  maxStaleMs: number;
  persistent: boolean;
};

type CacheEntry<T = unknown> = {
  schemaVersion: number;
  logicalKey: string;
  path: string;
  scope: CacheScope;
  data: T;
  etag: string | null;
  fetchedAt: number;
  expiresAt: number;
  maxStaleAt: number;
  lastAccessAt: number;
  byteSize: number;
};

type LoaderResult<T> = { data?: T; etag?: string | null; notModified?: boolean };

export type ApiCacheMetrics = {
  memoryHits: number;
  persistentHits: number;
  misses: number;
  staleFallbacks: number;
  revalidations: number;
  networkRequests: number;
  coalescedRequests: number;
  evictions: number;
  bytes: number;
  coldRenderMs: number[];
  hotRenderMs: number[];
};

const scopes = new WeakMap<ApiFetch, CacheScope>();
const memory = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const scopeEpochs = new Map<CacheScope, number>();
let maintenance: Promise<void> = Promise.resolve();
const metrics: ApiCacheMetrics = {
  memoryHits: 0, persistentHits: 0, misses: 0, staleFallbacks: 0, revalidations: 0,
  networkRequests: 0, coalescedRequests: 0, evictions: 0, bytes: 0,
  coldRenderMs: [], hotRenderMs: [],
};

export function registerApiFetchScope(apiFetch: ApiFetch, userId?: number | null) {
  const numericUserId = Number(userId);
  scopes.set(apiFetch, Number.isInteger(numericUserId) && numericUserId > 0 ? `user:${numericUserId}` : "public");
}

export function getApiFetchScope(apiFetch: ApiFetch): CacheScope {
  return scopes.get(apiFetch) || "public";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function logicalKey(scope: CacheScope, path: string) {
  return `${scope}|schema:${API_CACHE_SCHEMA_VERSION}|GET|${path}`;
}

function storageKey(key: string, scope: CacheScope) {
  const suffix = scope.startsWith("user:") ? `:user:${scope.slice(5)}` : "";
  return `${API_CACHE_STORAGE_PREFIX}${stableHash(key)}${suffix}`;
}

export function apiCachePolicy(path: string): ApiCachePolicy | null {
  if (/^\/api\/v1\/(?:auth|ai|notifications)(?:\/|\?|$)/.test(path)) return null;
  if (/^\/api\/v1\/recipes\/\d+(?:\?|$)/.test(path)) return { ttlMs: 30 * 60_000, maxStaleMs: 7 * 86_400_000, persistent: true };
  if (/^\/api\/v1\/(?:recipes|community)(?:\/|\?|$)/.test(path)) return { ttlMs: 10 * 60_000, maxStaleMs: 24 * 60 * 60_000, persistent: true };
  if (/^\/api\/v1\/(?:inventory|diet-records|health-data)(?:\/|\?|$)/.test(path)) return { ttlMs: 60_000, maxStaleMs: 7 * 86_400_000, persistent: true };
  if (/^\/api\/v1\/(?:kitchenware|shopping-list|cooking-queue|meal-plans|households|insights)(?:\/|\?|$)/.test(path)) {
    return { ttlMs: 2 * 60_000, maxStaleMs: 24 * 60 * 60_000, persistent: true };
  }
  return null;
}

function isUsable(entry: CacheEntry, now: number) {
  return entry.schemaVersion === API_CACHE_SCHEMA_VERSION && now <= entry.maxStaleAt;
}

async function readPersistent<T>(key: string, scope: CacheScope) {
  const raw = await AsyncStorage.getItem(storageKey(key, scope));
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.schemaVersion !== API_CACHE_SCHEMA_VERSION || entry.logicalKey !== key || entry.scope !== scope) {
      await AsyncStorage.removeItem(storageKey(key, scope));
      return null;
    }
    entry.lastAccessAt = Date.now();
    memory.set(key, entry);
    return entry;
  } catch {
    await AsyncStorage.removeItem(storageKey(key, scope));
    return null;
  }
}

function persistEntry(entry: CacheEntry) {
  maintenance = maintenance.then(async () => {
    await AsyncStorage.setItem(storageKey(entry.logicalKey, entry.scope), JSON.stringify(entry));
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(API_CACHE_STORAGE_PREFIX));
    const rows = (await AsyncStorage.multiGet(keys)).flatMap(([key, raw]) => {
      if (!raw) return [];
      try {
        const value = JSON.parse(raw) as CacheEntry;
        return [{ key, bytes: (key.length + raw.length) * 2, lastAccessAt: value.lastAccessAt || value.fetchedAt || 0, logicalKey: value.logicalKey }];
      } catch {
        return [{ key, bytes: (key.length + raw.length) * 2, lastAccessAt: 0, logicalKey: "" }];
      }
    });
    let total = rows.reduce((sum, row) => sum + row.bytes, 0);
    const evicted: string[] = [];
    for (const row of rows.sort((a, b) => a.lastAccessAt - b.lastAccessAt)) {
      if (total <= MAX_PERSISTED_BYTES) break;
      total -= row.bytes;
      evicted.push(row.key);
      if (row.logicalKey) memory.delete(row.logicalKey);
      metrics.evictions += 1;
    }
    if (evicted.length) await AsyncStorage.multiRemove(evicted);
    metrics.bytes = total;
  }).catch(() => undefined);
}

function store<T>(key: string, path: string, scope: CacheScope, policy: ApiCachePolicy, data: T, etag?: string | null, fetchedAt = Date.now()) {
  const entry: CacheEntry<T> = {
    schemaVersion: API_CACHE_SCHEMA_VERSION,
    logicalKey: key,
    path,
    scope,
    data,
    etag: etag || null,
    fetchedAt,
    expiresAt: fetchedAt + policy.ttlMs,
    maxStaleAt: fetchedAt + policy.maxStaleMs,
    lastAccessAt: fetchedAt,
    byteSize: JSON.stringify(data).length * 2,
  };
  memory.set(key, entry);
  if (policy.persistent) persistEntry(entry);
  return data;
}

async function refresh<T>(key: string, path: string, scope: CacheScope, policy: ApiCachePolicy, entry: CacheEntry<T> | null, loader: (etag?: string | null) => Promise<LoaderResult<T>>) {
  const existing = inFlight.get(key);
  if (existing) {
    metrics.coalescedRequests += 1;
    return existing as Promise<T>;
  }
  const startedEpoch = scopeEpochs.get(scope) || 0;
  const request = (async () => {
    metrics.networkRequests += 1;
    try {
      const result = await loader(entry?.etag);
      const wasInvalidated = (scopeEpochs.get(scope) || 0) !== startedEpoch;
      if (result.notModified && entry) return wasInvalidated ? entry.data : store(key, path, scope, policy, entry.data, entry.etag);
      return wasInvalidated ? result.data as T : store(key, path, scope, policy, result.data as T, result.etag);
    } catch (error) {
      const status = (error as ApiError)?.status;
      if (status === 401 || status === 403) await clearApiCacheScope(scope);
      throw error;
    }
  })();
  inFlight.set(key, request);
  void request.finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }).catch(() => undefined);
  return request;
}

export async function cachedApiGet<T>(apiFetch: ApiFetch, path: string, policy: ApiCachePolicy, loader: (etag?: string | null) => Promise<LoaderResult<T>>) {
  const scope = getApiFetchScope(apiFetch);
  const key = logicalKey(scope, path);
  const now = Date.now();
  let entry = memory.get(key) as CacheEntry<T> | undefined;
  if (entry && isUsable(entry, now)) metrics.memoryHits += 1;
  if (!entry && policy.persistent) {
    entry = await readPersistent<T>(key, scope) || undefined;
    if (entry && isUsable(entry, now)) metrics.persistentHits += 1;
  }
  if (entry && isUsable(entry, now)) {
    entry.lastAccessAt = now;
    if (now <= entry.expiresAt) return entry.data;
    metrics.staleFallbacks += 1;
    metrics.revalidations += 1;
    void refresh(key, path, scope, policy, entry, loader).catch(async (error: ApiError) => {
      if (error?.status === 401 || error?.status === 403) await clearApiCacheScope(scope);
    });
    return entry.data;
  }
  metrics.misses += 1;
  return refresh(key, path, scope, policy, entry || null, loader);
}

function invalidationPrefixes(path: string) {
  if (path.startsWith("/api/v1/inventory")) return ["/api/v1/inventory", "/api/v1/insights"];
  if (path.startsWith("/api/v1/diet-records")) return ["/api/v1/diet-records", "/api/v1/health-data"];
  if (path.startsWith("/api/v1/health-data")) return ["/api/v1/health-data"];
  if (path.startsWith("/api/v1/recipes")) return ["/api/v1/recipes"];
  if (path.startsWith("/api/v1/community")) return ["/api/v1/community"];
  if (path.startsWith("/api/v1/shopping-list")) return ["/api/v1/shopping-list"];
  if (path.startsWith("/api/v1/cooking-queue")) return ["/api/v1/cooking-queue"];
  if (path.startsWith("/api/v1/meal-plans")) return ["/api/v1/meal-plans"];
  if (path.startsWith("/api/v1/kitchenware")) return ["/api/v1/kitchenware"];
  if (path.startsWith("/api/v1/households")) return ["/api/v1/households"];
  return [];
}

export async function invalidateApiCacheForMutation(apiFetch: ApiFetch, path: string) {
  const prefixes = invalidationPrefixes(path);
  if (!prefixes.length) return;
  const scope = getApiFetchScope(apiFetch);
  scopeEpochs.set(scope, (scopeEpochs.get(scope) || 0) + 1);
  const logicalKeys = [...memory.entries()].filter(([, entry]) => entry.scope === scope && prefixes.some((prefix) => entry.path.startsWith(prefix))).map(([key]) => key);
  logicalKeys.forEach((key) => memory.delete(key));
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(API_CACHE_STORAGE_PREFIX));
  const rows = await AsyncStorage.multiGet(keys);
  const removals = rows.flatMap(([key, raw]) => {
    try {
      const entry = raw ? JSON.parse(raw) as CacheEntry : null;
      return entry?.scope === scope && prefixes.some((prefix) => entry.path.startsWith(prefix)) ? [key] : [];
    } catch {
      return [key];
    }
  });
  if (removals.length) await AsyncStorage.multiRemove(removals);
}

export async function clearApiCacheScope(scopeOrUserId?: CacheScope | number | null) {
  const scope: CacheScope | null = typeof scopeOrUserId === "number" ? `user:${scopeOrUserId}` : scopeOrUserId || null;
  if (scope) scopeEpochs.set(scope, (scopeEpochs.get(scope) || 0) + 1);
  else for (const knownScope of new Set([...memory.values()].map((entry) => entry.scope))) scopeEpochs.set(knownScope, (scopeEpochs.get(knownScope) || 0) + 1);
  for (const [key, entry] of memory) if (!scope || entry.scope === scope) memory.delete(key);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(API_CACHE_STORAGE_PREFIX));
  if (!scope) {
    if (keys.length) await AsyncStorage.multiRemove(keys);
    metrics.bytes = 0;
    return;
  }
  const scopedKeys = keys.filter((key) => scope === "public" ? !key.includes(":user:") : key.endsWith(`:user:${scope.slice(5)}`));
  if (scopedKeys.length) await AsyncStorage.multiRemove(scopedKeys);
}

export function recordCacheRender(durationMs: number, hot: boolean) {
  const bucket = hot ? metrics.hotRenderMs : metrics.coldRenderMs;
  bucket.push(Math.max(0, durationMs));
  if (bucket.length > 100) bucket.shift();
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue))];
}

export function getApiCacheDiagnostics() {
  const hits = metrics.memoryHits + metrics.persistentHits;
  return {
    ...metrics,
    entries: memory.size,
    hitRate: hits + metrics.misses ? hits / (hits + metrics.misses) : 0,
    render: {
      coldP50: percentile(metrics.coldRenderMs, 0.5), coldP95: percentile(metrics.coldRenderMs, 0.95),
      hotP50: percentile(metrics.hotRenderMs, 0.5), hotP95: percentile(metrics.hotRenderMs, 0.95),
    },
  };
}

export function resetApiCacheForTests() {
  memory.clear();
  inFlight.clear();
  scopeEpochs.clear();
  Object.assign(metrics, {
    memoryHits: 0, persistentHits: 0, misses: 0, staleFallbacks: 0, revalidations: 0,
    networkRequests: 0, coalescedRequests: 0, evictions: 0, bytes: 0, coldRenderMs: [], hotRenderMs: [],
  });
}
