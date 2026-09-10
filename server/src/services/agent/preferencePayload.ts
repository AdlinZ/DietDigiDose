import { kitchenPreferencesSchema } from "@dietdigidose/contracts";
import { z } from "zod";

export const permanentPreferencePayloadSchema = z.object({
  scope: z.literal("persistent"),
  preferences: kitchenPreferencesSchema.refine(value => Object.keys(value).length > 0, "请提供需要长期修改的偏好"),
}).strict();

export function hasPermanentPreferenceIntent(text: string) {
  if (/(?:不要|不用|别|不必|不想).{0,12}(?:保存|记住|长期|默认|以后)/.test(text)) return false;
  return /(?:以后|今后|从今).{0,20}(?:都|按|固定)|(?:长期|默认|平时|通常|习惯|记住)/.test(text);
}
