import { db } from "../storage/db.js";
import { currentDateKey, dateKeyAfterDays } from "../utils/date.js";

/**
 * OpenAI Function Calling 工具 Schema 定义
 */
export const aiToolsSchema = [
  {
    type: "function",
    function: {
      name: "record_diet_meal",
      description: "【严格说明：仅当用户明确表达想要‘打卡’或‘记录已吃食物’（如‘我刚才吃了牛肉面’、‘记录今天的午餐’）时才可调用！】若用户是在询问‘想吃...但缺食材’、询问烹饪食谱、提问替代方案或做选择题时，绝对禁止调用此工具！",
      parameters: {
        type: "object",
        properties: {
          mealType: {
            type: "string",
            enum: ["早餐", "午餐", "晚餐", "加餐"],
            description: "餐食类型",
          },
          foodName: {
            type: "string",
            description: "菜品或食物名称，如：香煎鸡胸肉、水饺、黑咖啡、苹果",
          },
          amount: {
            type: "string",
            description: "分量描述，如：200g、1大碗、1份",
          },
          calories: {
            type: "number",
            description: "预估总卡路里 (kcal)",
          },
          protein: {
            type: "number",
            description: "蛋白质克数 (g)",
          },
          carbs: {
            type: "number",
            description: "碳水化合物克数 (g)",
          },
          fat: {
            type: "number",
            description: "脂肪克数 (g)",
          },
        },
        required: ["mealType", "foodName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_missing_ingredients",
      description: "当用户表达想吃某道菜（例如‘想吃西红柿炒蛋’、‘想吃番茄牛腩’），但对比库房库存后发现缺少关键食材时调用此工具。由 Agent 直接精准提取目标菜名与缺失食材，生成【缺料智能采购卡片】。",
      parameters: {
        type: "object",
        properties: {
          dishName: {
            type: "string",
            description: "用户最终想吃的菜品名称（如：西红柿炒蛋），必须准确排除前置否定语",
          },
          missingIngredients: {
            type: "array",
            description: "缺失的食材列表",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "食材名称，如：鲜鸡蛋、西红柿" },
                amount: { type: "string", description: "建议数量，如：3个、200g" },
              },
              required: ["name", "amount"],
            },
          },
        },
        required: ["dishName", "missingIngredients"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_meal_solutions",
      description: "当用户询问‘今晚吃啥’、‘推荐吃什么’、‘有什么建议’或要求对比多个饮食/菜谱方案时调用此工具。大模型直接结构化输出 2~3 个平替方案卡片（包含方案标签、菜品名称、食材列表、烹饪亮点与预估热量营养）。",
      parameters: {
        type: "object",
        properties: {
          introMessage: {
            type: "string",
            description: "给用户的亲切开场白，如：根据您冰箱现有的食材，食语为您精心挑选了以下 3 个平替晚餐方案：",
          },
          solutions: {
            type: "array",
            description: "推荐的方案卡片列表",
            items: {
              type: "object",
              properties: {
                schemeTag: { type: "string", description: "方案编号，如：方案 A、方案 B、方案 C" },
                title: { type: "string", description: "菜品名称，如：香煎三文鱼配紫麦沙拉、蒜香虾仁炒时蔬" },
                ingredients: { type: "string", description: "详细食材搭配，如：挪威三文鱼排 150g + 三色藜麦 50g + 菠菜" },
                cookingTip: { type: "string", description: "烹饪亮点与特色，如：煎香鱼皮，油脂自然渗入藜麦，简单黑胡椒调味" },
                macros: { type: "string", description: "预估热量营养，如：约 605 kcal · 蛋白质 31g" },
              },
              required: ["schemeTag", "title", "ingredients", "cookingTip", "macros"],
            },
          },
        },
        required: ["introMessage", "solutions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_inventory_item",
      description: "当用户表达‘我买了一些...’、‘帮我把...存入冰箱/保鲜库/冷冻库’时调用此工具，自动帮用户将食材存入冰箱库存数据库。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "食材名称，如：希腊酸奶、牛油果、三文鱼",
          },
          category: {
            type: "string",
            description: "食材分类，如：肉禽水产、蔬菜水果、乳品蛋类、主食粮油、调味干货",
          },
          location: {
            type: "string",
            enum: ["保鲜库", "冷冻库", "常温层"],
            description: "存放位置，默认保鲜库",
          },
          quantity: {
            type: "string",
            description: "数量/规格，如：1000g、2盒、5个",
          },
          expireDays: {
            type: "number",
            description: "预计保质期天数，默认 7 天",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_kitchenware_item",
      description: "当用户明确表达自己拥有、刚购买或希望录入某件厨具/厨房家电时调用，将其保存到用户的厨具资产库。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "厨具名称，如：空气炸锅、珐琅铸铁锅、厨师刀",
          },
          category: {
            type: "string",
            enum: ["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"],
            description: "厨具分类",
          },
          status: {
            type: "string",
            enum: ["常用", "良好", "需保养", "维修中", "闲置"],
            description: "当前状态，默认良好",
          },
          note: {
            type: "string",
            description: "型号、容量、规格或用途备注",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_health_log",
      description: "当用户表达‘我今天体重...kg’、‘我喝了...ml水’、‘昨晚睡了...小时’时调用此工具，直接帮用户更新健康数据记录。",
      parameters: {
        type: "object",
        properties: {
          weightKg: {
            type: "number",
            description: "体重 (kg)",
          },
          bodyFatPercentage: {
            type: "number",
            description: "体脂率 (%)",
          },
          waterMl: {
            type: "number",
            description: "今日饮水量 (ml)",
          },
        },
      },
    },
  },
];

/**
 * 执行 AI Function Tool 调用并写入 SQLite 数据库
 */
export async function executeAITool(
  userId: number,
  toolName: string,
  args: any
): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    const todayStr = currentDateKey();

    if (toolName === "record_diet_meal") {
      const mealType = args.mealType || "午餐";
      const foodName = args.foodName || "健康料理";
      const amount = args.amount || "1份";
      const calories = args.calories ?? 300;
      const protein = args.protein ?? 18;
      const carbs = args.carbs ?? 35;
      const fat = args.fat ?? 8;

      const result = db.prepare(`
        INSERT INTO diet_records (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, mealType, foodName, amount, calories, protein, carbs, fat, todayStr);

      return {
        success: true,
        message: `✅ 已成功为你完成【${mealType}】打卡：${foodName} (${amount}, 约 ${calories} kcal)!`,
        details: { id: result.lastInsertRowid, mealType, foodName, calories },
      };
    }

    if (toolName === "add_inventory_item") {
      const name = args.name;
      const category = args.category || "其它";
      const location = args.location || "保鲜库";
      const quantity = args.quantity || "1份";
      const expireDays = args.expireDays ?? 7;

      const expDate = dateKeyAfterDays(expireDays);

      const result = db.prepare(`
        INSERT INTO inventory_items (user_id, food_name, category, storage_location, quantity, expiration_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, name, category, location, quantity, expDate);

      return {
        success: true,
        message: `🧊 已成功帮你把食材【${name}】(${quantity}) 存入冰箱 ${location}！`,
        details: { id: result.lastInsertRowid, name, location, quantity },
      };
    }

    if (toolName === "add_kitchenware_item") {
      const name = String(args.name || "").trim();
      const allowedCategories = new Set(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]);
      const allowedStatuses = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);
      if (!name) return { success: false, message: "请提供厨具名称" };
      const category = allowedCategories.has(args.category) ? args.category : "其他";
      const status = allowedStatuses.has(args.status) ? args.status : "良好";
      const note = String(args.note || "").trim().slice(0, 300);

      const result = db.prepare(`
        INSERT INTO kitchenware_items (user_id, name, category, status, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, name, category, status, note || null);

      return {
        success: true,
        message: `已将厨具【${name}】保存到你的装备库。`,
        details: { id: result.lastInsertRowid, name, category, status },
      };
    }

    if (toolName === "record_health_log") {
      const weight = args.weightKg ?? null;
      const bodyFat = args.bodyFatPercentage ?? null;
      const waterMl = args.waterMl ?? null;

      const existing = db.prepare("SELECT id FROM health_logs WHERE user_id = ? AND recorded_date = ?").get(userId, todayStr) as any;

      if (existing) {
        db.prepare(`
          UPDATE health_logs
          SET weight = COALESCE(?, weight),
              body_fat = COALESCE(?, body_fat),
              water_ml = COALESCE(?, water_ml)
          WHERE id = ?
        `).run(weight, bodyFat, waterMl, existing.id);
      } else {
        db.prepare(`
          INSERT INTO health_logs (user_id, weight, body_fat, water_ml, recorded_date)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, weight, bodyFat, waterMl, todayStr);
      }

      const updatesText = [
        weight ? `体重 ${weight}kg` : null,
        waterMl ? `饮水 ${waterMl}ml` : null,
      ].filter(Boolean).join("，");

      return {
        success: true,
        message: `📊 已为你成功记录健康数据：${updatesText || "数据已同步"}！`,
      };
    }

    return { success: false, message: `未知的工具名称: ${toolName}` };
  } catch (err: any) {
    console.error(`[AI Tool Execution Error] ${toolName}:`, err);
    console.error("[AI Tool Execution Error]", err instanceof Error ? err.message : err);
    return { success: false, message: "执行工具失败，请稍后重试" };
  }
}
