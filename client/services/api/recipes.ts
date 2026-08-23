import { requestJson, publicFetch, type ApiFetch } from "./client";
import type { Recipe } from "./types";

export const recipesApi = {
  list: <T = Recipe>(query = "") => requestJson<T[]>(publicFetch, `/api/v1/recipes${query}`),
  listPage: <T = Recipe>(query = "") => requestJson<{ items: T[]; total?: number; nextCursor: string | null }>(publicFetch, `/api/v1/recipes${query}`),
  detail: (id: number) => requestJson<Recipe>(publicFetch, `/api/v1/recipes/${id}`),
  mine: <T = Recipe>(apiFetch: ApiFetch) => requestJson<T[]>(apiFetch, "/api/v1/recipes/mine"),
  favorites: (apiFetch: ApiFetch) => requestJson<Recipe[]>(apiFetch, "/api/v1/recipes/favorites"),
  favoriteCount: (apiFetch: ApiFetch) => requestJson<{ count: number }>(apiFetch, "/api/v1/recipes/favorites/count"),
  favorite: (apiFetch: ApiFetch, id: number) => requestJson<{ is_favorited: boolean }>(apiFetch, `/api/v1/recipes/${id}/favorite`, { method: "POST" }),
  unfavorite: (apiFetch: ApiFetch, id: number) => requestJson<{ is_favorited: boolean }>(apiFetch, `/api/v1/recipes/${id}/favorite`, { method: "DELETE" }),
  favoriteState: (apiFetch: ApiFetch, id: number) => requestJson<{ is_favorited: boolean }>(apiFetch, `/api/v1/recipes/${id}/favorite`),
  submit: (apiFetch: ApiFetch, input: unknown, id?: number) => requestJson<{ id: number; message: string }>(apiFetch, id ? `/api/v1/recipes/submissions/${id}` : "/api/v1/recipes/submissions", {
    method: id ? "PUT" : "POST", body: JSON.stringify(input),
  }),
  withdraw: (apiFetch: ApiFetch, id: number) => requestJson<{ message: string }>(apiFetch, `/api/v1/recipes/submissions/${id}`, { method: "DELETE" }),
};
