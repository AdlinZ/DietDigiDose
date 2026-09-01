export type IngredientQualityIssue =
  | "missing_source"
  | "missing_license"
  | "invalid_calories"
  | "invalid_macronutrient"
  | "implausible_macronutrient_total"
  | "invalid_edible_ratio"
  | "missing_source_version";

/** Pure ingredient governance validation shared by driver-neutral services. */
export function validateIngredientQuality(input: {
  calories100g: number;
  protein100g?: number | null;
  carbs100g?: number | null;
  fat100g?: number | null;
  edibleRatio?: number | null;
  source?: string | null;
  dataLicense?: string | null;
  sourceVersion?: string | null;
}) {
  const issues = new Set<IngredientQualityIssue>();
  if (!input.source?.trim()) issues.add("missing_source");
  if (!input.dataLicense?.trim()) issues.add("missing_license");
  if (!input.sourceVersion?.trim()) issues.add("missing_source_version");
  if (!Number.isFinite(input.calories100g) || input.calories100g < 0 || input.calories100g > 1_000) issues.add("invalid_calories");
  const macros = [input.protein100g, input.carbs100g, input.fat100g].map((value) => Number(value || 0));
  if (macros.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) issues.add("invalid_macronutrient");
  if (macros.reduce((sum, value) => sum + value, 0) > 105) issues.add("implausible_macronutrient_total");
  const edibleRatio = Number(input.edibleRatio ?? 1);
  if (!Number.isFinite(edibleRatio) || edibleRatio <= 0 || edibleRatio > 1) issues.add("invalid_edible_ratio");
  return [...issues];
}
