const recognized = (present: boolean) => ({ status: present ? "estimated" as const : "unknown" as const,
  source: present ? "recognition" as const : "unknown" as const });

export function normalizeInventoryScanItems(items: unknown) {
  return (Array.isArray(items) ? items : [])
    .filter((item: { foodName?: unknown }) => item != null && typeof item.foodName === "string" && item.foodName.trim())
    .slice(0, 30)
    .map((item: { foodName: string; quantity?: string; suggestedStorageLocation?: string; estimatedExpireDays?: number; confidence?: number }) => ({
      fieldEvidence: {
        food_name: recognized(true),
        quantity: recognized(typeof item.quantity === "string" && !!item.quantity.trim()),
        storage_location: recognized(["冷藏", "冷冻", "常温"].includes(item.suggestedStorageLocation || "")),
        expiration_date: recognized(typeof item.estimatedExpireDays === "number" && Number.isInteger(item.estimatedExpireDays) && item.estimatedExpireDays >= 1 && item.estimatedExpireDays <= 365),
      },
      foodName: item.foodName.trim(),
      quantity: typeof item.quantity === "string" ? item.quantity.trim() : "",
      suggestedStorageLocation: ["冷藏", "冷冻", "常温"].includes(item.suggestedStorageLocation || "") ? item.suggestedStorageLocation! : "",
      estimatedExpireDays: typeof item.estimatedExpireDays === "number" && Number.isInteger(item.estimatedExpireDays) && item.estimatedExpireDays >= 1 && item.estimatedExpireDays <= 365 ? item.estimatedExpireDays : null,
      confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1 ? item.confidence : null,
      missingFields: [
        ...(typeof item.quantity !== "string" || !item.quantity.trim() ? ["数量"] : []),
        ...(!["冷藏", "冷冻", "常温"].includes(item.suggestedStorageLocation || "") ? ["存放位置"] : []),
        ...(!(typeof item.estimatedExpireDays === "number" && Number.isInteger(item.estimatedExpireDays) && item.estimatedExpireDays >= 1 && item.estimatedExpireDays <= 365) ? ["保质期"] : []),
      ],
    }));
}

