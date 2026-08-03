import { requestJson, publicFetch, type ApiFetch } from "./client";
import type { CommunityPost } from "./types";

export const communityApi = {
  posts: <T = CommunityPost>(query = "", apiFetch: ApiFetch = publicFetch) => requestJson<T[]>(apiFetch, `/api/v1/community/posts${query}`),
  users: <T>(apiFetch: ApiFetch, query: string) => requestJson<T[]>(apiFetch, `/api/v1/community/users?query=${encodeURIComponent(query)}`),
  post: <T = CommunityPost>(id: number, apiFetch: ApiFetch = publicFetch) => requestJson<T>(apiFetch, `/api/v1/community/posts/${id}`),
  createPost: (apiFetch: ApiFetch, input: unknown) => requestJson<CommunityPost>(apiFetch, "/api/v1/community/posts", { method: "POST", body: JSON.stringify(input) }),
  toggleLike: (apiFetch: ApiFetch, id: number) => requestJson<{ is_liked: boolean; likes_count: number }>(apiFetch, `/api/v1/community/posts/${id}/like`, { method: "POST" }),
  toggleJoin: (apiFetch: ApiFetch, id: number) => requestJson<{ is_joined: boolean; participant_count: number }>(apiFetch, `/api/v1/community/posts/${id}/join`, { method: "POST" }),
  comments: <T>(id: number, apiFetch: ApiFetch = publicFetch) => requestJson<T[]>(apiFetch, `/api/v1/community/posts/${id}/comments`),
  createComment: <T>(apiFetch: ApiFetch, id: number, input: unknown) => requestJson<T>(apiFetch, `/api/v1/community/posts/${id}/comments`, { method: "POST", body: JSON.stringify(input) }),
  acceptComment: <T = { success: boolean }>(apiFetch: ApiFetch, postId: number, commentId: number) => requestJson<T>(apiFetch, `/api/v1/community/posts/${postId}/comments/${commentId}/accept`, { method: "POST" }),
  toggleCommentLike: (apiFetch: ApiFetch, id: number) => requestJson<{ is_liked: boolean; likes_count: number }>(apiFetch, `/api/v1/community/comments/${id}/like`, { method: "POST" }),
};
