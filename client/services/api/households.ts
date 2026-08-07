import { requestJson, type ApiFetch } from "./client";

export interface HouseholdMember {
  user_id: number;
  username: string;
  nickname: string;
  avatar_url?: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
}

export interface Household {
  id: number;
  name: string;
  invite_code: string;
  owner_id: number;
  created_at: string;
  my_role: "owner" | "admin" | "member";
  members: HouseholdMember[];
}

export interface HouseholdInventoryItem {
  id: number;
  household_id: number;
  created_by_user_id: number;
  creator_name: string;
  food_name: string;
  category: string;
  quantity: string;
  expiration_date: string;
  storage_location: string;
  image_url?: string | null;
  is_available: boolean;
  created_at: string;
}

export interface HouseholdActivityLog {
  id: number;
  household_id: number;
  operator_user_id: number;
  operator_name: string;
  operator_avatar?: string;
  action: "add" | "consume" | "expire_clear" | "edit";
  food_name: string;
  quantity: string;
  storage_location: string;
  created_at: string;
}

export const householdApi = {
  create: (apiFetch: ApiFetch, name: string) =>
    requestJson<Household>(apiFetch, "/api/v1/households", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  mine: (apiFetch: ApiFetch) => requestJson<Household[]>(apiFetch, "/api/v1/households/mine"),

  join: (apiFetch: ApiFetch, inviteCode: string) =>
    requestJson<{ message: string; household: Household }>(apiFetch, "/api/v1/households/join", {
      method: "POST",
      body: JSON.stringify({ invite_code: inviteCode }),
    }),

  leave: (apiFetch: ApiFetch, householdId: number) =>
    requestJson<{ message: string }>(apiFetch, `/api/v1/households/${householdId}/leave`, {
      method: "POST",
    }),

  inventoryList: (apiFetch: ApiFetch, householdId: number) =>
    requestJson<HouseholdInventoryItem[]>(apiFetch, `/api/v1/households/${householdId}/inventory`),

  inventoryCreate: (apiFetch: ApiFetch, householdId: number, input: unknown) =>
    requestJson<HouseholdInventoryItem>(apiFetch, `/api/v1/households/${householdId}/inventory`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  inventoryUpdate: (apiFetch: ApiFetch, householdId: number, itemId: number, input: unknown) =>
    requestJson<HouseholdInventoryItem>(apiFetch, `/api/v1/households/${householdId}/inventory/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  inventoryRemove: (apiFetch: ApiFetch, householdId: number, itemId: number) =>
    requestJson<{ message: string }>(apiFetch, `/api/v1/households/${householdId}/inventory/${itemId}`, {
      method: "DELETE",
    }),

  historyList: (apiFetch: ApiFetch, householdId: number) =>
    requestJson<HouseholdActivityLog[]>(apiFetch, `/api/v1/households/${householdId}/history`),
};
