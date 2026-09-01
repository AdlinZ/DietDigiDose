export function stringValue(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

export function nonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function nonNegativeInteger(value: unknown) {
  const parsed = nonNegativeNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

export function arrayValue(value: unknown, fallback: unknown[] = []) {
  return Array.isArray(value) ? value : fallback;
}

export function timestampMs(value: unknown) {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  const normalized = String(value).replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
}

export const reversibleAgentActions = new Set([
  "create_meal_plan",
  "update_meal_plan",
  "add_shopping_items",
  "update_shopping_item",
]);
