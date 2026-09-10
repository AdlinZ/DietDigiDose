export function quantityEvidenceStatus(metadata: unknown, currentVersion: unknown): "known" | "estimated" | "unknown" | undefined {
  if (metadata == null) return undefined; // Older/manual records have no recognition evidence.
  let value: Record<string, any>;
  try { value = typeof metadata === "string" ? JSON.parse(metadata) : metadata as Record<string, any>; }
  catch { return "unknown"; }
  const status = value?.field_evidence?.quantity?.status;
  if (!status || Number(value.inventory_version) !== Number(currentVersion)) return "unknown";
  return status === "known" || status === "estimated" ? status : "unknown";
}
