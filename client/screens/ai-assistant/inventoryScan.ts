import type { InventoryScanFood } from "./types";

export const normalizeInventoryScanFoods = (items: unknown, jobId: string): InventoryScanFood[] =>
  (Array.isArray(items) ? items : [])
    .filter((item: { foodName?: unknown }) => typeof item.foodName === "string" && item.foodName.trim())
    .slice(0, 30)
    .map((item: {
      foodName: string;
      quantity?: string;
      suggestedStorageLocation?: string;
      estimatedExpireDays?: number;
    }, index: number) => ({
      id: `${jobId}-${index}`,
      foodName: item.foodName.trim(),
      quantity: item.quantity || "1份",
      suggestedStorageLocation: (["冷藏", "冷冻", "常温"].includes(item.suggestedStorageLocation || "")
        ? item.suggestedStorageLocation
        : "冷藏") as InventoryScanFood["suggestedStorageLocation"],
      estimatedExpireDays: Math.max(1, Math.min(Number(item.estimatedExpireDays) || 7, 365)),
      selected: true,
    }));

export const inferInventoryCategory = (name: string) => {
  if (/[牛猪鸡羊鱼虾蟹贝肉]|培根|火腿/.test(name)) return "肉食";
  if (/奶|芝士|黄油/.test(name)) return "乳制品";
  if (/苹果|香蕉|[橙柚梨桃]|葡萄|草莓|蓝莓|西瓜/.test(name)) return "水果";
  if (/[酱油醋盐糖米面粉豆]|罐头|披萨|泡芙/.test(name)) return "粮油干货";
  return "蔬菜";
};
