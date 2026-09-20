import type { AgentActionProposal } from "./types";
export type ApprovalField = { key: string; label: string; numeric?: boolean };
const fields: Record<string, ApprovalField[]> = {
  add_inventory_item: [{ key: "name", label: "食材名称" }, { key: "quantityValue", label: "数量", numeric: true }, { key: "quantityUnit", label: "单位（g / ml / piece / serving）" }, { key: "expirationDate", label: "到期日期" }],
  update_inventory_item: [{ key: "quantityValue", label: "数量", numeric: true }, { key: "quantityUnit", label: "单位（g / ml / piece / serving）" }],
  record_diet_meal: [{ key: "foodName", label: "食物名称" }, { key: "amount", label: "食用量（含单位）" }, { key: "mealType", label: "餐次" }, { key: "recordedAt", label: "日期" }],
  record_health_log: [{ key: "weightKg", label: "体重（公斤）", numeric: true }, { key: "bodyFatPercentage", label: "体脂率（%）", numeric: true }, { key: "waterMl", label: "饮水量（毫升）", numeric: true }],
};
export function approvalFields(action: AgentActionProposal) { return fields[action.actionType] || []; }
export function editApprovalField(action: AgentActionProposal, field: ApprovalField, value: string): AgentActionProposal {
  return { ...action, payload: { ...action.payload, [field.key]: field.numeric && value !== "" ? Number(value) : value } };
}
