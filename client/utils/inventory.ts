import { parseDateKey, toLocalDateKey } from "./date";

export type InventoryFreshness = "used_up" | "expired" | "expiring" | "fresh" | "invalid";

export type InventoryStatus = {
  freshness: InventoryFreshness;
  daysRemaining: number | null;
};

export const daysUntilDateKey = (expirationDate: string, today = new Date()): number | null => {
  const expiration = parseDateKey(expirationDate);
  const todayDate = parseDateKey(toLocalDateKey(today));
  if (!expiration || !todayDate) return null;
  const expirationUtc = Date.UTC(expiration.getFullYear(), expiration.getMonth(), expiration.getDate());
  const todayUtc = Date.UTC(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
  return Math.round((expirationUtc - todayUtc) / 86_400_000);
};

export const getInventoryStatus = (
  item: { expiration_date: string; is_available: boolean },
  today = new Date(),
): InventoryStatus => {
  if (!item.is_available) return { freshness: "used_up", daysRemaining: null };
  const daysRemaining = daysUntilDateKey(item.expiration_date, today);
  if (daysRemaining === null) return { freshness: "invalid", daysRemaining: null };
  if (daysRemaining < 0) return { freshness: "expired", daysRemaining };
  if (daysRemaining <= 3) return { freshness: "expiring", daysRemaining };
  return { freshness: "fresh", daysRemaining };
};
