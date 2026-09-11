import { maintenanceRunSummary } from "./runSummary.js";
import type { Row } from "../mealPlans/formatters.js";
export function maintenanceNotice(row: Row) {
  const summary = maintenanceRunSummary(row);
  if (summary.status === "failed") return { title: "计划检查未完成",body: "自动重试已结束，原安排保留。请打开检查结果核对。",action: true };
  if (summary.status !== "completed" || !(summary.applied || summary.suggested || summary.kept || summary.checks.length)) return null;
  return { title: "计划检查有新结果",body: `已调整 ${summary.applied} 项，提出建议 ${summary.suggested} 项，待核对 ${summary.checks.length} 项。打开查看检查结果。`,action: Boolean(summary.suggested || summary.checks.length || summary.kept) };
}
