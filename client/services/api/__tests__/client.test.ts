import { requestJson, type ApiFetch } from "../client";

describe("API client", () => {
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
});
