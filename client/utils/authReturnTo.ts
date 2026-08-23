export type AuthReturnTo = {
  pathname: "/" | "/recipe-detail" | "/cooking-mode" | "/cooking-queue" | "/inventory" | "/favorites" | "/shopping-list" | "/recipe-submit";
  params?: Record<string, string | number>;
};

const POSITIVE_ID_PATHS = new Set(["/recipe-detail", "/cooking-mode"]);
const PARAMETERLESS_PATHS = new Set(["/", "/favorites", "/shopping-list", "/recipe-submit", "/cooking-queue"]);

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateAuthReturnTo(value: unknown): AuthReturnTo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { pathname?: unknown; params?: unknown };
  if (typeof candidate.pathname !== "string" || !candidate.pathname.startsWith("/")) return null;

  if (PARAMETERLESS_PATHS.has(candidate.pathname)) {
    return { pathname: candidate.pathname as AuthReturnTo["pathname"] };
  }
  const params = candidate.params && typeof candidate.params === "object" && !Array.isArray(candidate.params)
    ? candidate.params as Record<string, unknown>
    : {};
  if (POSITIVE_ID_PATHS.has(candidate.pathname)) {
    const key = candidate.pathname === "/cooking-mode" ? "recipeId" : "id";
    const id = positiveInteger(params[key]);
    if (!id) return null;
    const safeParams: Record<string, string | number> = { [key]: id };
    if (candidate.pathname === "/recipe-detail" && ["favorite", "shopping-list", "queue"].includes(String(params.pendingAction))) {
      safeParams.pendingAction = String(params.pendingAction);
    }
    return { pathname: candidate.pathname as AuthReturnTo["pathname"], params: safeParams };
  }
  if (candidate.pathname === "/inventory") {
    return params.action === "add"
      ? { pathname: "/inventory", params: { action: "add" } }
      : { pathname: "/inventory" };
  }
  return null;
}

export function createAuthReturnTo(pathname: string, params: Record<string, unknown> = {}) {
  return validateAuthReturnTo({ pathname, params });
}
