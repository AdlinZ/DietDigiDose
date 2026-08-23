import { createAuthReturnTo, validateAuthReturnTo } from "./authReturnTo";

describe("login returnTo allowlist", () => {
  it("accepts the core internal continuation routes", () => {
    expect(createAuthReturnTo("/cooking-mode", { recipeId: 12 })).toEqual({
      pathname: "/cooking-mode",
      params: { recipeId: 12 },
    });
    expect(createAuthReturnTo("/inventory", { action: "add", ignored: "value" })).toEqual({
      pathname: "/inventory",
      params: { action: "add" },
    });
    expect(createAuthReturnTo("/cooking-queue", { ignored: "value" })).toEqual({
      pathname: "/cooking-queue",
    });
  });

  it("rejects external, login and malformed destinations", () => {
    expect(validateAuthReturnTo("https://evil.example")).toBeNull();
    expect(validateAuthReturnTo({ pathname: "https://evil.example" })).toBeNull();
    expect(validateAuthReturnTo({ pathname: "/login" })).toBeNull();
    expect(validateAuthReturnTo({ pathname: "/cooking-mode", params: { recipeId: "nope" } })).toBeNull();
  });

  it("drops unknown parameters from an allowed destination", () => {
    expect(validateAuthReturnTo({
      pathname: "/recipe-detail",
      params: { id: 8, pendingAction: "favorite", redirect: "https://evil.example" },
    })).toEqual({ pathname: "/recipe-detail", params: { id: 8, pendingAction: "favorite" } });
    expect(validateAuthReturnTo({ pathname: "/recipe-detail", params: { id: 8, pendingAction: "queue" } }))
      .toEqual({ pathname: "/recipe-detail", params: { id: 8, pendingAction: "queue" } });
  });
});
