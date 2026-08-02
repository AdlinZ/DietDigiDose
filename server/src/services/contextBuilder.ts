import { db } from "../storage/db.js";
import dayjs from "dayjs";

export interface UserContext {
  userId: number;
  nickname?: string;
  dailyCaloriesTarget: number;
  inventory: Array<{ food_name: string; quantity: string; expiration_date: string; storage_location: string }>;
  kitchenware: Array<{ name: string; category: string; status: string }>;
  todayDiet: Array<{ meal_type: string; food_name: string; calories: number; protein: number }>;
  latestHealth?: { weight?: number; body_fat?: number; water_ml?: number };
}

/**
 * 获取并组装指定用户的上下文数据
 */
export function buildUserContext(userId: number): UserContext {
  // 1. 用户信息
  const user = db.prepare("SELECT nickname, daily_calories_target FROM users WHERE id = ?").get(userId) as any;
  const nickname = user?.nickname || "用户";
  const dailyCaloriesTarget = user?.daily_calories_target || 2000;

  // 2. 冰箱现有可用食材 (前 15 条)
  const inventory = db
    .prepare(
      "SELECT food_name, quantity, expiration_date, storage_location FROM inventory_items WHERE user_id = ? AND is_available = 1 ORDER BY expiration_date ASC LIMIT 15"
    )
    .all(userId) as any[];

  // 3. 用户当前可用厨具
  const kitchenware = db
    .prepare(
      "SELECT name, category, status FROM kitchenware_items WHERE user_id = ? AND deleted_at IS NULL AND status != '维修中' ORDER BY updated_at DESC LIMIT 20"
    )
    .all(userId) as any[];

  // 4. 今日已记录的饮食 (按当前日期)
  const todayStr = dayjs().format("YYYY-MM-DD");
  const todayDiet = db
    .prepare(
      "SELECT meal_type, food_name, calories, protein FROM diet_records WHERE user_id = ? AND recorded_at LIKE ? ORDER BY id DESC"
    )
    .all(userId, `${todayStr}%`) as any[];

  // 5. 最新健康体征
  const latestHealth = db
    .prepare("SELECT weight, body_fat, water_ml FROM health_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(userId) as any;

  return {
    userId,
    nickname,
    dailyCaloriesTarget,
    inventory: inventory || [],
    kitchenware: kitchenware || [],
    todayDiet: todayDiet || [],
    latestHealth,
  };
}

/**
 * 将 UserContext 转为大模型的 System Prompt
 */
export function generateSystemPrompt(ctx: UserContext): string {
  const totalCaloriesToday = ctx.todayDiet.reduce((sum, item) => sum + (item.calories || 0), 0);
  const totalProteinToday = ctx.todayDiet.reduce((sum, item) => sum + (item.protein || 0), 0);

  const inventorySummary = ctx.inventory.length > 0
    ? ctx.inventory.map(i => `- ${i.food_name} (${i.quantity}, ${i.storage_location}, 保质期至 ${i.expiration_date})`).join("\n")
    : "暂无记录的冰箱食材";

  const kitchenwareSummary = ctx.kitchenware.length > 0
    ? ctx.kitchenware.map(item => `- ${item.name}（${item.category}，${item.status}）`).join("\n")
    : "暂无记录的厨具";

  const dietSummary = ctx.todayDiet.length > 0
    ? ctx.todayDiet.map(d => `- [${d.meal_type}] ${d.food_name} (${d.calories || 0} kcal, 蛋白 ${d.protein || 0}g)`).join("\n")
    : "今日尚未记录饮食";

  return `你是一个专业、温暖且贴心的【食光 AI 营养大厨 — 食语】。
你的任务是根据用户的每日身体目标、今日已摄入卡路里/三大营养素以及冰箱保鲜库中的现有食材，为用户提供智能食材配餐、减脂/增肌建议以及烹饪解答。

请基于以下用户的真实数据回答疑问或提供食谱建议：

【用户基础信息】
- 称呼：${ctx.nickname}
- 每日目标热量：${ctx.dailyCaloriesTarget} kcal

【今日已摄入数据】
- 今日总热量：${totalCaloriesToday} / ${ctx.dailyCaloriesTarget} kcal
- 今日总蛋白质：${totalProteinToday} g
- 今日餐食记录：
${dietSummary}

【冰箱保鲜库/冷冻库库存】
${inventorySummary}

【可用厨具与厨房设备】
${kitchenwareSummary}

【回答要求】
1. 语气温暖专业、条理清晰，鼓励健康饮食。
2. 推荐食谱时，优先帮用户清理冰箱里即将到期的食材，并确保烹饪方法匹配用户现有且可用的厨具，精细估算热量与蛋白质。
3. 当用户询问‘想吃某菜但缺少食材’或要求推荐替代方案时，请提供 2~3 个明确选项，并统一采用以下格式输出，以便前端自动生成交互式选择按钮：
   - 方案 A：[简短方案名称]，描述...
   - 方案 B：[简短方案名称]，描述...
   - 方案 C：[简短方案名称]，描述...
4. 严格工具调用规则：仅当用户明确要求‘打卡’或‘记录食物’时才可调用 record_diet_meal 工具；用户咨询食谱、寻找替代方案或做选择时，切勿调用 record_diet_meal 工具！`;
}
