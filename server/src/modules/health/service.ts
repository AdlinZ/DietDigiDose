import { currentDateKey } from "../../utils/date.js";
import type { HealthRepository } from "./repository.js";
import type { HealthLogInput, HealthProfileInput, HealthProfilePatch } from "./types.js";

function parseJson(value: unknown, fallback: unknown) {
  if (value !== null && typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

function serializeProfile(profile: Record<string, unknown>) {
  const {
    allergies_json: allergiesJson,
    medical_conditions_json: conditionsJson,
    dietary_restrictions_json: restrictionsJson,
    kitchen_constraints_json: kitchenJson,
    nutrition_targets_json: targetsJson,
    ...fields
  } = profile;
  return {
    ...fields,
    allergies: parseJson(allergiesJson, []),
    medical_conditions: parseJson(conditionsJson, []),
    dietary_restrictions: parseJson(restrictionsJson, []),
    kitchen_constraints: parseJson(kitchenJson, {}),
    nutrition_targets: parseJson(targetsJson, {}),
    tracking_enabled: Boolean(profile.tracking_enabled),
  };
}

export class HealthService {
  private readonly repository: HealthRepository;

  constructor(repository: HealthRepository) {
    this.repository = repository;
  }

  latestLog(userId: number) {
    return this.repository.latestLog(userId);
  }

  listLogs(userId: number) {
    return this.repository.listLogs(userId, 30);
  }

  upsertLog(userId: number, input: HealthLogInput) {
    return this.repository.upsertLog(userId, input.recorded_date || currentDateKey(), input);
  }

  removeLog(userId: number, id: number) {
    return this.repository.removeLog(userId, id);
  }

  async getProfile(userId: number) {
    return serializeProfile(await this.repository.getOrCreateProfile(userId));
  }

  async upsertProfile(userId: number, input: HealthProfileInput) {
    const patch: HealthProfilePatch = {
      gender: input.gender,
      age: input.age,
      height: input.height,
      weight: input.weight,
      target_weight: input.target_weight,
      health_goal: input.health_goal,
      activity_level: input.activity_level,
      dietary_preference: input.dietary_preference,
      allergies_json: input.allergies,
      medications: input.medications,
      medical_conditions_json: input.medical_conditions,
      medical_notes: input.medical_notes,
      dietary_restrictions_json: input.dietary_restrictions,
      disliked_foods: input.disliked_foods,
      kitchen_constraints_json: input.kitchen_constraints,
      nutrition_targets_json: input.nutrition_targets,
      tracking_enabled: input.tracking_enabled,
    };
    return serializeProfile(await this.repository.upsertProfile(userId, patch));
  }
}
