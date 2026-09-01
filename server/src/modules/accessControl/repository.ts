import type { StoredAccessUser } from "./types.js";

export interface AccessControlRepository {
  user(userId: number): Promise<StoredAccessUser | null>;
}
