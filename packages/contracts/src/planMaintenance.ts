import { z } from "zod";

const timeZone = z.string().trim().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "请选择有效时区");
export const planMaintenanceSettingsSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.number().int().nonnegative(), enabled: z.literal(true), timeZone,
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "请选择每日检查时间") }).strict(),
  z.object({ version: z.number().int().nonnegative(), enabled: z.literal(false) }).strict(),
]);
export type PlanMaintenanceSettingsInput = z.infer<typeof planMaintenanceSettingsSchema>;

export const planMaintenanceStateSchema = z.object({
  enabled: z.boolean(),timeZone: timeZone.nullable(),localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  nextCheckAt: z.string().refine(value => Number.isFinite(Date.parse(value)), "检查时间无效").nullable(),nextLocalDate: z.string().nullable(),lastCompletedLocalDate: z.string().nullable(),
  version: z.number().int().nonnegative(),
});
export type PlanMaintenanceState = z.infer<typeof planMaintenanceStateSchema>;
