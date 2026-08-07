import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useCSSVariable } from "uniwind";

import type { DetectedFood, KitchenwareCatalogItem } from "./types";
import { COMMON_INGREDIENTS, type CommonIngredient } from "@/utils/ingredientRules";
import type { InventoryLogEntry } from "@/utils/inventoryHistory";

interface BatchReviewModalProps {
  visible: boolean;
  foods: DetectedFood[];
  saving: boolean;
  onClose: () => void;
  onChange: (foods: DetectedFood[]) => void;
  onSave: () => void;
  onAddItem?: (item: CommonIngredient) => void;
}

export function BatchReviewModal({ visible, foods, saving, onClose, onChange, onSave, onAddItem }: BatchReviewModalProps) {
  const [brand, muted] = useCSSVariable(["--color-brand", "--color-copy-muted"]) as string[];
  const allSelected = foods.length > 0 && foods.every((food) => food.selected);
  const selectedCount = foods.filter((food) => food.selected).length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[88%] rounded-t-[32px] bg-surface px-page pt-page pb-6" accessibilityViewIsModal>
          <View className="flex-row items-start justify-between border-b border-line pb-4">
            <View className="flex-1 pr-3">
              <Text className="text-lg font-black text-ink" accessibilityRole="header">批量确认识别结果</Text>
              <Text className="mt-1 text-caption leading-4 text-copy-muted">已添加 {foods.length} 种食材；取消勾选不需要入库的项目。</Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭识别结果" className="min-h-touch min-w-touch items-center justify-center rounded-full bg-canvas">
              <FontAwesome6 name="xmark" size={17} color={muted} />
            </TouchableOpacity>
          </View>

          {onAddItem && (
            <View className="mt-3">
              <Text className="text-xs font-bold text-copy-muted mb-1.5">快捷加一项</Text>
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                  {COMMON_INGREDIENTS.slice(0, 10).map((item) => (
                  <TouchableOpacity
                    key={item.name}
                    onPress={() => onAddItem(item)}
                    className="flex-row items-center gap-1.5 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5"
                  >
                    <FontAwesome6 name="plus" size={10} color="#2D6A4F" />
                    <Text className="text-xs font-bold text-brand">{item.name}</Text>
                  </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          )}

          <ScrollView className="mt-3" showsVerticalScrollIndicator={false} contentContainerClassName="gap-2 pb-3" accessibilityLiveRegion="polite">
            {foods.map((item) => (
              <TouchableOpacity
                key={item.id}
                onPress={() => onChange(foods.map((food) => food.id === item.id ? { ...food, selected: !food.selected } : food))}
                className={`flex-row items-center rounded-card border p-3.5 ${item.selected ? "border-brand/30 bg-brand-soft" : "border-line bg-canvas opacity-disabled"}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.selected }}
                accessibilityLabel={`${item.foodName}，${item.quantity}，${item.suggestedStorageLocation}`}
              >
                <View className={`mr-3 h-6 w-6 items-center justify-center rounded-full ${item.selected ? "bg-brand" : "border border-line bg-surface"}`}>
                  {item.selected && <FontAwesome6 name="check" size={11} color="#FFF" />}
                </View>
                <View className="flex-1">
                  <Text className="text-body font-black text-ink">{item.foodName}</Text>
                  <Text className="mt-1 text-caption text-copy-muted">{item.quantity} · {item.suggestedStorageLocation} · 建议 {item.estimatedExpireDays} 天内食用</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View className="mt-3 flex-row gap-3">
            <TouchableOpacity
              onPress={() => onChange(foods.map((item) => ({ ...item, selected: !allSelected })))}
              className="min-h-touch items-center justify-center rounded-control border border-line bg-canvas px-4"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allSelected }}
              accessibilityLabel="全选识别结果"
            >
              <Text className="text-caption font-bold text-copy-muted">全选</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSave}
              disabled={saving || selectedCount === 0}
              className="flex-1 min-h-touch items-center justify-center rounded-control bg-brand active:bg-accent-hover disabled:opacity-disabled"
              accessibilityRole="button"
              accessibilityLabel={`一键批量入库 ${selectedCount} 项`}
              accessibilityState={{ disabled: saving || selectedCount === 0, busy: saving }}
            >
              {saving ? <ActivityIndicator color="#FFF" /> : <Text className="text-base font-black text-white">一键批量入库 {selectedCount} 项</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function QuickAddPresetChips({ onSelect }: { onSelect: (ingredient: CommonIngredient) => void }) {
  return (
    <View className="mb-3">
      <Text className="text-xs font-bold text-copy-muted mb-2">常用食材快捷添加</Text>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {COMMON_INGREDIENTS.map((item) => (
          <TouchableOpacity
            key={item.name}
            onPress={() => onSelect(item)}
            className="flex-row items-center gap-1.5 rounded-2xl border border-line bg-canvas px-3 py-2 active:bg-brand-soft active:border-brand/40"
            accessibilityRole="button"
            accessibilityLabel={`快捷添加${item.name}`}
          >
            <Text className="text-xs font-bold text-ink">{item.name}</Text>
            <Text className="text-[10px] text-copy-muted">{item.storageLocation}</Text>
          </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

interface InventoryHistoryModalProps {
  visible: boolean;
  logs: InventoryLogEntry[];
  onClose: () => void;
  onClear: () => void;
}

export function InventoryHistoryModal({ visible, logs, onClose, onClear }: InventoryHistoryModalProps) {
  const [muted] = useCSSVariable(["--color-copy-muted"]) as string[];

  const getActionBadge = (action: InventoryLogEntry["action"]) => {
    switch (action) {
      case "add":
        return { text: "录入", bg: "bg-emerald-100", textColor: "text-emerald-800" };
      case "consume":
        return { text: "用完", bg: "bg-amber-100", textColor: "text-amber-800" };
      case "expire_clear":
        return { text: "清理", bg: "bg-rose-100", textColor: "text-rose-800" };
      default:
        return { text: "修改", bg: "bg-blue-100", textColor: "text-blue-800" };
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hours}:${mins}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="max-h-[85%] rounded-t-[32px] bg-surface px-5 pt-5 pb-6">
          <View className="flex-row items-center justify-between border-b border-line pb-3">
            <View className="flex-1">
              <Text className="text-lg font-black text-ink">库存变动历史</Text>
              <Text className="mt-0.5 text-xs text-copy-muted">记录你的每一次录入、用完扣减与清理</Text>
            </View>
            <View className="flex-row items-center gap-2">
              {logs.length > 0 && (
                <TouchableOpacity onPress={onClear} className="px-3 py-1.5 rounded-full bg-canvas border border-line">
                  <Text className="text-xs font-bold text-copy-muted">清空历史</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-full bg-canvas">
                <FontAwesome6 name="xmark" size={16} color={muted} />
              </TouchableOpacity>
            </View>
          </View>

          {logs.length === 0 ? (
            <View className="py-12 items-center">
              <FontAwesome6 name="clock-rotate-left" size={32} color="#D4A276" />
              <Text className="mt-3 text-xs font-bold text-copy-muted">暂无变动记录</Text>
              <Text className="mt-1 text-[11px] text-copy-muted">录入或扣减食材后会在此处自动记录</Text>
            </View>
          ) : (
            <ScrollView className="mt-3" showsVerticalScrollIndicator={false} contentContainerClassName="gap-2.5 pb-4">
              {logs.map((log) => {
                const badge = getActionBadge(log.action);
                return (
                  <View key={log.id} className="flex-row items-center justify-between rounded-2xl border border-line bg-canvas p-3.5">
                    <View className="flex-row items-center gap-3">
                      <View className={`px-2.5 py-1 rounded-full ${badge.bg}`}>
                        <Text className={`text-[11px] font-black ${badge.textColor}`}>{badge.text}</Text>
                      </View>
                      <View>
                        <Text className="text-sm font-black text-ink">{log.foodName}</Text>
                        <Text className="mt-0.5 text-[11px] text-copy-muted">{log.quantity} · {log.storageLocation}</Text>
                      </View>
                    </View>
                    <Text className="text-[10px] font-medium text-copy-muted">{formatTime(log.timestamp)}</Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

interface CatalogDetailModalProps {
  item: KitchenwareCatalogItem | null;
  saving: boolean;
  owned: boolean;
  onClose: () => void;
  onAdd: (item: KitchenwareCatalogItem) => void;
}

export function CatalogDetailModal({ item, saving, owned, onClose, onAdd }: CatalogDetailModalProps) {
  const [muted] = useCSSVariable(["--color-copy-muted"]) as string[];
  if (!item) return null;
  const aliases = parseCatalogList(item.aliases);
  const cookingMethods = parseCatalogList(item.cooking_methods);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 p-page">
        <View className="w-full rounded-[28px] bg-surface p-page" accessibilityViewIsModal>
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-lg font-black text-ink" accessibilityRole="header">{item.name}</Text>
              <Text className="mt-1 text-caption font-bold text-brand">官方标准库 · {item.category}</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="min-h-touch min-w-touch items-center justify-center" accessibilityRole="button" accessibilityLabel={`关闭${item.name}详情`}>
              <FontAwesome6 name="xmark" size={17} color={muted} />
            </TouchableOpacity>
          </View>
          {aliases.length ? <View className="mt-4"><Text className="text-caption font-bold text-copy-muted">常用别名</Text><Text className="mt-1 text-caption text-ink">{aliases.join("、")}</Text></View> : null}
          <View className="mt-4"><Text className="text-caption font-bold text-copy-muted">适用方式</Text><Text className="mt-1 text-caption text-ink">{cookingMethods.join("、") || "暂未标注"}</Text></View>
          <View className="mt-4 rounded-card bg-background-secondary p-3"><Text className="text-caption font-bold text-copy-muted">官方保养提示</Text><Text className="mt-1 text-caption leading-5 text-ink">{item.care_note || "保持清洁干燥，按产品说明书进行保养。"}</Text></View>
          <TouchableOpacity
            disabled={saving || owned}
            onPress={() => onAdd(item)}
            className="mt-5 min-h-touch items-center justify-center rounded-control bg-brand disabled:opacity-disabled"
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || owned, busy: saving }}
            accessibilityLabel={owned ? `${item.name}已在我的装备库` : `将${item.name}加入我的装备`}
          >
            <Text className="text-body font-black text-white">{saving ? "添加中…" : owned ? "已在我的装备库" : "加入我的装备"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function parseCatalogList(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
