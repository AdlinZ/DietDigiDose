import { z } from "zod";

const key = z.string().trim().min(1).max(60);
/** Reviewed bounds for one batch; smaller batches use the same duration bounds. */
export const recipeExecutionProfileSchema = z.object({
  version: z.literal(1),
  maxBatchServings: z.number().finite().positive().max(30),
  reference: z.string().trim().min(5).max(2000),
  tools: z.array(z.object({
    key, name: z.string().trim().min(1).max(100), catalogId: z.number().int().positive(),
    capacity: z.discriminatedUnion("kind", [z.object({ kind: z.literal("not_applicable") }).strict(),
      z.object({ kind: z.literal("volume"), mlPerServing: z.number().finite().positive().max(1_000_000) }).strict()]),
  }).strict()).max(10),
  tasks: z.array(z.object({
    id: key, title: z.string().trim().min(1).max(200), phase: z.enum(["preparation", "cooking", "cleanup"]),
    minutes: z.number().int().nonnegative().max(1440), active: z.boolean(),
    dependsOn: z.array(key).max(30), tools: z.array(key).max(10),
  }).strict()).min(3).max(30),
}).strict().superRefine((profile, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const tasks = new Map(profile.tasks.map(task => [task.id, task]));
  const tools = new Set(profile.tools.map(tool => tool.key));
  if (tasks.size !== profile.tasks.length || tools.size !== profile.tools.length) issue("任务和设备标识不能重复");
  if (!["preparation", "cooking", "cleanup"].every(phase => profile.tasks.some(task => task.phase === phase))) issue("必须明确准备、烹饪和收尾任务");
  if (profile.tasks.every(task => task.minutes === 0)) issue("制作流程总时长须大于零");
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const task = tasks.get(id);
    if (!task) return false;
    visiting.add(id);
    if (!task.dependsOn.every(visit)) return false;
    visiting.delete(id); visited.add(id); return true;
  };
  for (const task of profile.tasks) {
    if (!visit(task.id)) issue("任务依赖必须存在且不能形成循环");
    if (new Set(task.dependsOn).size !== task.dependsOn.length || new Set(task.tools).size !== task.tools.length) issue("任务依赖或设备不能重复");
    if (task.tools.some(tool => !tools.has(tool))) issue("任务只能使用已声明设备");
    if (task.phase !== "cooking" && !task.active) issue("准备和收尾需计入人工占用");
  }
  if (profile.tools.some(tool => !profile.tasks.some(task => task.tools.includes(tool.key)))) issue("声明的设备必须对应实际任务");
  // Every operation must reach cleanup, so completion never silently omits it.
  for (const task of profile.tasks.filter(task => task.phase !== "cleanup")) {
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      return profile.tasks.some(next => next.dependsOn.includes(id) && (next.phase === "cleanup" || reaches(next.id, seen)));
    };
    if (!reaches(task.id)) issue("每项准备或烹饪操作都必须有后续收尾任务");
  }
});
export type RecipeExecutionProfile = z.infer<typeof recipeExecutionProfileSchema>;
export const recipeExecutionReviewSchema = z.object({
  recipeKey: z.string().regex(/^[a-f0-9]{64}$/), reviewKey: z.string().regex(/^[a-f0-9]{64}$/), profile: recipeExecutionProfileSchema.nullable(),
}).strict();
export const reviewedRecipeExecutionSchema = z.object({
  recipeKey: z.string().regex(/^[a-f0-9]{64}$/), profile: recipeExecutionProfileSchema,
  reviewedBy: z.number().int().positive(), reviewedAt: z.string().datetime(),
}).strict();
export type ReviewedRecipeExecution = z.infer<typeof reviewedRecipeExecutionSchema>;

export const cookingScheduleSchema = z.object({
  complete: z.boolean(), elapsedMinutes: z.number().finite().nonnegative().nullable(),
  sequentialMinutes: z.number().finite().nonnegative(),
  missing: z.array(z.string().max(200)).max(100), conflicts: z.array(z.string().max(500)).max(100),
  batches: z.array(z.object({
    id: key, targetMealId: z.string().max(80), recipeId: z.number().int().positive(), servings: z.number().finite().positive(),
    reference: z.string().max(2000), devices: z.array(z.object({ key, id: z.number().int().positive(), name: z.string().max(100) })).max(10),
  })).max(500),
  tasks: z.array(z.object({
    id: z.string().max(130), batchId: key, title: z.string().max(200), phase: z.enum(["preparation", "cooking", "cleanup"]),
    active: z.boolean(), startMinute: z.number().finite().nonnegative(), endMinute: z.number().finite().nonnegative(),
    dependsOn: z.array(z.string().max(130)).max(30), deviceIds: z.array(z.number().int().positive()).max(10),
  })).max(5000),
}).superRefine((schedule, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (schedule.complete !== (schedule.missing.length === 0 && schedule.conflicts.length === 0) || schedule.complete !== (schedule.elapsedMinutes !== null)) issue("未知或有冲突的排程不能声明完整时长");
  const tasks = new Map(schedule.tasks.map(task => [task.id, task]));
  const batches = new Set(schedule.batches.map(batch => batch.id));
  if (tasks.size !== schedule.tasks.length || batches.size !== schedule.batches.length) issue("排程标识不能重复");
  const overlaps = (left: typeof schedule.tasks[number], right: typeof left) => left.startMinute < right.endMinute && right.startMinute < left.endMinute && left.endMinute > left.startMinute && right.endMinute > right.startMinute;
  for (const [index, task] of schedule.tasks.entries()) {
    if (!batches.has(task.batchId) || task.endMinute < task.startMinute) issue("排程任务的批次或时间无效");
    if (task.dependsOn.some(id => !tasks.has(id) || tasks.get(id)!.endMinute > task.startMinute)) issue("排程不能跳过依赖任务");
    if (schedule.tasks.slice(0, index).some(other => overlaps(task, other) && ((task.active && other.active) || task.deviceIds.some(id => other.deviceIds.includes(id))))) issue("排程不能同时占用同一人工或设备");
    const batch = schedule.batches.find(batch => batch.id === task.batchId);
    if (task.deviceIds.some(id => !batch?.devices.some(device => device.id === id))) issue("任务设备必须属于该批已声明设备");
  }
  if (schedule.complete && schedule.batches.some(batch => {
    const operations = schedule.tasks.filter(task => task.batchId === batch.id);
    return !["preparation", "cooking", "cleanup"].every(phase => operations.some(task => task.phase === phase)) || operations.every(task => task.endMinute === task.startMinute);
  })) issue("完整排程须包含每批的准备、烹饪和收尾任务");
  if (schedule.complete && schedule.elapsedMinutes !== Math.max(0, ...schedule.tasks.map(task => task.endMinute))) issue("排程总时长必须覆盖全部任务");
});
export type CookingSchedule = z.infer<typeof cookingScheduleSchema>;
