import type { AIUsageWrite } from "./types.js";

export interface AIRuntimeRepository {
  settings(keys: string[]): Promise<Record<string, string>>;
  saveSettings(entries: Array<{ key: string; value: string }>): Promise<void>;
  recordUsage(input: AIUsageWrite): Promise<void>;
}
