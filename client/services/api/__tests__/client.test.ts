jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

import { requestJson, type ApiFetch } from "../client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import {
  clearApiCacheScope,
  getApiCacheDiagnostics,
  registerApiFetchScope,
  resetApiCacheForTests,
} from "../cache";

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
} as Response);

describe("API client", () => {
  beforeEach(async () => {
    resetApiCacheForTests();
    await AsyncStorage.clear();
  });

  it("coalesces concurrent identical mutations", async () => {
    let calls = 0;
    let resolveResponse: ((value: Response) => void) | undefined;
    const apiFetch: ApiFetch = jest.fn(async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { resolveResponse = resolve; });
    });
    const options = { method: "POST", body: JSON.stringify({ food_name: "番茄" }) };

    const first = requestJson<{ id: number }>(apiFetch, "/api/v1/inventory", options);
    const second = requestJson<{ id: number }>(apiFetch, "/api/v1/inventory", options);
    expect(calls).toBe(1);

    resolveResponse?.({
      ok: true,
      status: 201,
      json: async () => ({ id: 42 }),
    } as Response);
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 42 }, { id: 42 }]);
    expect(calls).toBe(1);
  });

  it("never coalesces mutations across authenticated fetch contexts", async () => {
    const firstFetch: ApiFetch = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ owner: "first" }),
    } as Response));
    const secondFetch: ApiFetch = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ owner: "second" }),
    } as Response));
    const options = { method: "POST", body: JSON.stringify({ food_name: "番茄" }) };

    await expect(Promise.all([
      requestJson<{ owner: string }>(firstFetch, "/api/v1/inventory", options),
      requestJson<{ owner: string }>(secondFetch, "/api/v1/inventory", options),
    ])).resolves.toEqual([{ owner: "first" }, { owner: "second" }]);
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent GETs and reuses the persistent cache", async () => {
    let calls = 0;
    let resolveResponse: ((value: Response) => void) | undefined;
    const apiFetch: ApiFetch = jest.fn(async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { resolveResponse = resolve; });
    });
    registerApiFetchScope(apiFetch, 101);

    const first = requestJson<{ value: number }>(apiFetch, "/api/v1/inventory");
    const second = requestJson<{ value: number }>(apiFetch, "/api/v1/inventory");
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveResponse?.(jsonResponse({ value: 1 }));
    await expect(Promise.all([first, second])).resolves.toEqual([{ value: 1 }, { value: 1 }]);
    expect(calls).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 0));
    resetApiCacheForTests();
    await expect(requestJson<{ value: number }>(apiFetch, "/api/v1/inventory")).resolves.toEqual({ value: 1 });
    expect(calls).toBe(1);
    expect(getApiCacheDiagnostics().persistentHits).toBe(1);
  });

  it("isolates persisted GET data by user and clears only the selected account", async () => {
    const firstFetch: ApiFetch = jest.fn(async () => jsonResponse({ owner: "first" }));
    const secondFetch: ApiFetch = jest.fn(async () => jsonResponse({ owner: "second" }));
    registerApiFetchScope(firstFetch, 201);
    registerApiFetchScope(secondFetch, 202);

    await expect(Promise.all([
      requestJson(firstFetch, "/api/v1/inventory"),
      requestJson(secondFetch, "/api/v1/inventory"),
    ])).resolves.toEqual([{ owner: "first" }, { owner: "second" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await clearApiCacheScope(201);
    resetApiCacheForTests();

    await requestJson(firstFetch, "/api/v1/inventory");
    await requestJson(secondFetch, "/api/v1/inventory");
    expect(firstFetch).toHaveBeenCalledTimes(2);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it("serves stale data immediately and revalidates it in the background", async () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const apiFetch: ApiFetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ version: 2 }));
    registerApiFetchScope(apiFetch, 301);

    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 1 });
    now += 61_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(getApiCacheDiagnostics().staleFallbacks).toBe(1);
    jest.restoreAllMocks();
  });

  it("invalidates only affected resource keys after a successful write", async () => {
    const apiFetch: ApiFetch = jest.fn(async (input, init) => {
      const url = String(input);
      if ((init?.method || "GET") === "POST") return jsonResponse({ id: 1 }, 201);
      if (url.includes("/inventory")) return jsonResponse([{ id: 1 }]);
      return jsonResponse({ items: [{ id: 9 }], nextCursor: null });
    });
    registerApiFetchScope(apiFetch, 401);
    await requestJson(apiFetch, "/api/v1/inventory");
    await requestJson(apiFetch, "/api/v1/recipes?pageSize=10");
    await requestJson(apiFetch, "/api/v1/inventory", { method: "POST", body: "{}" });
    await requestJson(apiFetch, "/api/v1/inventory");
    await requestJson(apiFetch, "/api/v1/recipes?pageSize=10");

    const urls = (apiFetch as jest.Mock).mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes("/inventory"))).toHaveLength(3);
    expect(urls.filter((url) => url.includes("/recipes"))).toHaveLength(1);
  });

  it("does not let an in-flight stale refresh repopulate a cache invalidated by a write", async () => {
    let now = 2_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    let resolveRefresh: ((response: Response) => void) | undefined;
    let getCount = 0;
    const apiFetch: ApiFetch = jest.fn(async (_input, init) => {
      if ((init?.method || "GET") === "POST") return jsonResponse({ id: 1 }, 201);
      getCount += 1;
      if (getCount === 1) return jsonResponse({ version: 1 });
      if (getCount === 2) return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
      return jsonResponse({ version: 3 });
    });
    registerApiFetchScope(apiFetch, 501);
    await requestJson(apiFetch, "/api/v1/inventory");
    now += 61_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 1 });
    await requestJson(apiFetch, "/api/v1/inventory", { method: "POST", body: "{}" });
    resolveRefresh?.(jsonResponse({ version: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 3 });
    jest.restoreAllMocks();
  });

  it("purges a private cache after a background 401 and does not expose it to the next request", async () => {
    let now = 3_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const apiFetch: ApiFetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ private: "cached" }))
      .mockResolvedValueOnce(jsonResponse({ error: "expired", code: "TOKEN_EXPIRED" }, 401))
      .mockResolvedValueOnce(jsonResponse({ private: "fresh" }));
    registerApiFetchScope(apiFetch, 601);
    await requestJson(apiFetch, "/api/v1/inventory");
    now += 61_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ private: "cached" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetApiCacheForTests();
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ private: "fresh" });
    expect(apiFetch).toHaveBeenCalledTimes(3);
    jest.restoreAllMocks();
  });

  it("refuses cache entries beyond the maximum offline age", async () => {
    let now = 4_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const apiFetch: ApiFetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ version: 1 }))
      .mockRejectedValueOnce(new Error("offline"));
    registerApiFetchScope(apiFetch, 701);
    await requestJson(apiFetch, "/api/v1/inventory");
    now += 8 * 86_400_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).rejects.toThrow("offline");
    jest.restoreAllMocks();
  });

  it("rejects malformed runtime responses before they enter the API cache", async () => {
    const apiFetch: ApiFetch = jest.fn(async () => jsonResponse({ id: "not-a-number" }));
    registerApiFetchScope(apiFetch, 801);
    const responseSchema = z.object({ id: z.number() }).strict();

    await expect(requestJson(apiFetch, "/api/v1/inventory", {}, responseSchema)).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
      status: 0,
    });
    await expect(requestJson(apiFetch, "/api/v1/inventory", {}, responseSchema)).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
