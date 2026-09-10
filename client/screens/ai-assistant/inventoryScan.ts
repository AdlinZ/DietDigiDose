import { normalizeDetectedFoods } from "@/screens/inventory/scan";
import type { InventoryScanFood } from "./types";

export const normalizeInventoryScanFoods = (items: unknown, jobId: string): InventoryScanFood[] =>
  normalizeDetectedFoods(items, jobId).map(item => ({ ...item,
    suggestedStorageLocation: item.suggestedStorageLocation as InventoryScanFood["suggestedStorageLocation"],
  }));

export const inferInventoryCategory = (name: string) => {
  if (/[牛猪鸡羊鱼虾蟹贝肉]|培根|火腿/.test(name)) return "肉食";
  if (/奶|芝士|黄油/.test(name)) return "乳制品";
  if (/苹果|香蕉|[橙柚梨桃]|葡萄|草莓|蓝莓|西瓜/.test(name)) return "水果";
  if (/[酱油醋盐糖米面粉豆]|罐头|披萨|泡芙/.test(name)) return "粮油干货";
  return "蔬菜";
};

export const getSuggestedShelfLifeDays = (category: string, name: string = ""): number => {
  if (/蛋/.test(name)) return 14;
  if (/海鲜|[鱼虾蟹贝]/.test(name)) return 3;
  switch (category) {
    case "蔬菜":
      return 4;
    case "水果":
      return 5;
    case "肉食":
      return 7;
    case "乳制品":
      return 10;
    case "粮油干货":
    case "调味品":
      return 180;
    default:
      return 7;
  }
};
