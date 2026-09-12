import { z } from "zod";
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const interventionPreferencesSchema = z.object({
  enabled: z.boolean(), expiry_rescue: z.boolean(), dinner_window: z.boolean(),
  time_zone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("en",{ timeZone: value }).format(0); return true; } catch { return false; }
  },"时区无效"),
  quiet_start: clock, quiet_end: clock, dinner_time: clock,
  dinner_lead_minutes: z.number().int().min(15).max(180),
  daily_push_limit: z.number().int().min(0).max(3),
  cooldown_minutes: z.number().int().min(60).max(10080),
}).strict();
export const interventionPreferencesUpdateSchema = interventionPreferencesSchema.extend({ version: z.number().int().nonnegative() }).strict();
export type InterventionPreferences = z.infer<typeof interventionPreferencesSchema>;
export type InterventionPreferencesUpdate = z.infer<typeof interventionPreferencesUpdateSchema>;
export const defaultInterventionPreferences: InterventionPreferences = {
  enabled: false,expiry_rescue: false,dinner_window: false,time_zone: "Asia/Shanghai",
  quiet_start: "22:00",quiet_end: "07:00",dinner_time: "18:00",dinner_lead_minutes: 60,
  daily_push_limit: 1,cooldown_minutes: 120,
};
