export type AuthReturnTo = {
  pathname: "/" | "/recipe-detail" | "/post-detail" | "/user-profile" | "/cooking-mode" | "/cooking-queue" | "/inventory" | "/favorites" | "/shopping-list" | "/recipe-submit" | "/post-create" | "/feedback";
  params?: Record<string, string | number>;
};

const POSITIVE_ID_PATHS = new Set(["/recipe-detail", "/post-detail", "/user-profile", "/cooking-mode"]);
const PARAMETERLESS_PATHS = new Set(["/", "/favorites", "/shopping-list", "/recipe-submit", "/cooking-queue"]);
const POST_DETAIL_ACTIONS = new Set(["like", "follow", "join", "comment", "comment-like", "collect"]);

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
    const key = candidate.pathname === "/cooking-mode"
      ? "recipeId"
      : candidate.pathname === "/user-profile"
        ? "userId"
        : "id";
    const id = positiveInteger(params[key]);
    if (!id) return null;
    const safeParams: Record<string, string | number> = { [key]: id };
    if (candidate.pathname === "/recipe-detail" && ["favorite", "shopping-list", "queue"].includes(String(params.pendingAction))) {
      safeParams.pendingAction = String(params.pendingAction);
    }
    if (candidate.pathname === "/post-detail" && POST_DETAIL_ACTIONS.has(String(params.pendingAction))) {
      safeParams.pendingAction = String(params.pendingAction);
      if (params.pendingAction === "comment-like") {
        const commentId = positiveInteger(params.commentId);
        if (commentId) safeParams.commentId = commentId;
      }
    }
    if (candidate.pathname === "/user-profile" && params.pendingAction === "follow") {
      safeParams.pendingAction = "follow";
    }
    return { pathname: candidate.pathname as AuthReturnTo["pathname"], params: safeParams };
  }
  if (candidate.pathname === "/inventory") {
    return params.action === "add"
      ? { pathname: "/inventory", params: { action: "add" } }
      : { pathname: "/inventory" };
  }
  if (candidate.pathname === "/post-create") {
    return ["寻味", "榜单", "活动", "问答"].includes(String(params.category))
      ? { pathname: "/post-create", params: { category: String(params.category) } }
      : { pathname: "/post-create" };
  }
  if (candidate.pathname === "/feedback") {
    const safeParams: Record<string, string | number> = {};
    if (["bug", "suggestion", "content", "support"].includes(String(params.category))) {
      safeParams.category = String(params.category);
    }
    if (typeof params.page === "string" && params.page.length <= 80) safeParams.page = params.page;
    return Object.keys(safeParams).length
      ? { pathname: "/feedback", params: safeParams }
      : { pathname: "/feedback" };
  }
  return null;
}

export function createAuthReturnTo(pathname: string, params: Record<string, unknown> = {}) {
  return validateAuthReturnTo({ pathname, params });
}
