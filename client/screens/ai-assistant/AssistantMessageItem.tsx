import { ActivityIndicator, Image, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { AIMarkdown } from "@/components/AIMarkdown";
import { getAvatarSource } from "@/utils/defaultAvatar";
import type {
  DietRecordActionCard,
  DietRecordMissingCard,
  InventoryScanCard,
  InventoryScanFood,
  Message,
} from "./types";

type AssistantMessageItemProps = {
  message: Message;
  userAvatarUrl?: string | null;
  userAvatarSeed?: number | string;
  handleConfirmRecordCard: (messageId: string, card: DietRecordActionCard, isTomorrow?: boolean) => void | Promise<void>;
  handleOpenEditModal: (messageId: string, card: DietRecordActionCard) => void;
  toggleInventoryScanItem: (messageId: string, itemId: string) => void;
  openInventoryScanEditor: (messageId: string, item: InventoryScanFood) => void;
  confirmInventoryScanCard: (messageId: string, card: InventoryScanCard) => void | Promise<void>;
  handleSaveToShoppingList: (messageId: string, card: DietRecordMissingCard) => void | Promise<void>;
  handleSendMessage: (text: string) => void | Promise<void>;
  onOpenInventory: () => void;
  onOpenInventoryAdd: () => void;
};

export function AssistantMessageItem({
  message: msg,
  userAvatarUrl,
  userAvatarSeed,
  handleConfirmRecordCard,
  handleOpenEditModal,
  toggleInventoryScanItem,
  openInventoryScanEditor,
  confirmInventoryScanCard,
  handleSaveToShoppingList,
  handleSendMessage,
  onOpenInventory,
  onOpenInventoryAdd,
}: AssistantMessageItemProps) {
  return (
                <View
                  key={msg.id}
                  className={`mb-4 flex-row ${
                    msg.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.sender === "ai" && (
                    <Image
                      source={require("@/assets/shiyu-avatar.jpg")}
                      className="w-9 h-9 rounded-full border border-[#E9C46A] mr-2.5 mt-0.5 shadow-xs"
                      resizeMode="cover"
                    />
                  )}

                  <View
                    className={`${msg.inventoryScanCard ? "max-w-[90%]" : "max-w-[78%]"} p-4 rounded-3xl shadow-xs ${
                      msg.sender === "user"
                        ? "bg-[#2D6A4F] rounded-tr-none"
                        : "bg-white border border-[#EBE3D5] rounded-tl-none"
                    }`}
                  >
                    {msg.imageUri && (
                      <Image
                        source={{ uri: msg.imageUri }}
                        className="w-48 h-36 rounded-2xl mb-2.5 border border-white/20"
                        resizeMode="cover"
                      />
                    )}
                    {msg.sender === "ai" ? (
                      <AIMarkdown content={msg.text} />
                    ) : (
                      <Text className="text-xs leading-6 font-bold text-white">
                        {msg.text}
                      </Text>
                    )}

                    {/* Pre-filled Diet Record Action Card */}
                    {msg.actionCard && (
                      <View className="mt-3 bg-[#FDF8F0] p-3.5 rounded-2xl border border-[#E9C46A]/60 shadow-xs">
                        <View className="flex-row items-center justify-between mb-2 pb-1.5 border-b border-[#EBE3D5]">
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome6 name="wand-magic-sparkles" size={12} color="#2D6A4F" />
                            <Text className="text-xs font-black text-[#3D3229]">AI 自动识别待确认卡片</Text>
                          </View>
                          <View className="bg-[#2D6A4F] px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] font-bold text-white">{msg.actionCard.mealType}</Text>
                          </View>
                        </View>

                        <Text className="text-xs font-black text-[#3D3229] mb-1">
                          {msg.actionCard.foodName} ({msg.actionCard.amount})
                        </Text>
                        <Text className="text-[11px] text-[#8B7D6B] leading-4 mb-3">
                          预估热量: {msg.actionCard.calories} kcal | 蛋白质: {msg.actionCard.protein}g | 碳水: {msg.actionCard.carbs}g | 脂肪: {msg.actionCard.fat}g
                        </Text>

                        {msg.actionCard.saved ? (
                          <View className="bg-emerald-100 py-2 rounded-xl flex-row items-center justify-center gap-1.5 border border-emerald-300">
                            <FontAwesome6 name="circle-check" size={13} color="#2D6A4F" />
                            <Text className="text-xs font-bold text-[#2D6A4F]">已成功保存至饮食日志</Text>
                          </View>
                        ) : (
                          <View className="gap-2">
                            <View className="flex-row items-center gap-2">
                              <TouchableOpacity
                                onPress={() => handleConfirmRecordCard(msg.id, msg.actionCard!, false)}
                                className="flex-1 bg-[#2D6A4F] py-2 rounded-xl items-center shadow-xs active:opacity-90 flex-row justify-center gap-1"
                              >
                                <FontAwesome6 name="check" size={11} color="#FFF" />
                                <Text className="text-xs font-bold text-white">记为今日已吃</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                onPress={() => handleConfirmRecordCard(msg.id, msg.actionCard!, true)}
                                className="bg-[#D4A276] px-3 py-2 rounded-xl items-center active:opacity-90 flex-row justify-center gap-1 shadow-2xs"
                              >
                                <FontAwesome6 name="calendar-plus" size={11} color="#FFF" />
                                <Text className="text-xs font-bold text-white">存为明日计划</Text>
                              </TouchableOpacity>
                            </View>

                            <TouchableOpacity
                              onPress={() => handleOpenEditModal(msg.id, msg.actionCard!)}
                              className="bg-white py-1.5 rounded-xl border border-[#EBE3D5] items-center active:opacity-90 flex-row justify-center gap-1"
                            >
                              <FontAwesome6 name="pen-to-square" size={10} color="#8B7D6B" />
                              <Text className="text-[11px] font-bold text-[#8B7D6B]">弹出微调数据</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    {msg.inventoryScanCard && (
                      <View className="mt-3 rounded-2xl border border-[#2D6A4F]/25 bg-[#F7FAF8] p-3.5">
                        <View className="flex-row items-center justify-between border-b border-[#DDE8E1] pb-2.5">
                          <View className="flex-row items-center gap-2">
                            <View className="h-7 w-7 items-center justify-center rounded-xl bg-[#2D6A4F]">
                              <FontAwesome6 name="basket-shopping" size={11} color="#FFF" />
                            </View>
                            <View>
                              <Text className="text-xs font-black text-[#3D3229]">食材识别确认</Text>
                              <Text className="mt-0.5 text-[9px] text-[#8B7D6B]">
                                {msg.inventoryScanCard.status === "processing" ? "后台识别中，可停留查看进度" : `共 ${msg.inventoryScanCard.items.length} 项，可逐项修改`}
                              </Text>
                            </View>
                          </View>
                          <View className="rounded-full bg-white px-2 py-1">
                            <Text className="text-[9px] font-bold text-[#2D6A4F]">
                              {msg.inventoryScanCard.status === "processing" ? "识别中" : msg.inventoryScanCard.status === "saved" ? "已入库" : "待确认"}
                            </Text>
                          </View>
                        </View>

                        {msg.inventoryScanCard.status === "processing" ? (
                          <View className="items-center py-6">
                            <ActivityIndicator color="#2D6A4F" />
                            <Text className="mt-3 text-[11px] font-bold text-[#3D3229]">食语正在整理照片中的食材</Text>
                            <Text className="mt-1 text-[9px] text-[#8B7D6B]">识别完成后会自动出现确认卡，不需要重复拍摄</Text>
                          </View>
                        ) : msg.inventoryScanCard.status === "failed" ? (
                          <View className="py-4">
                            <Text className="text-[11px] leading-5 text-[#C2413A]">{msg.inventoryScanCard.error}</Text>
                            <TouchableOpacity
                              onPress={() => onOpenInventoryAdd()}
                              className="mt-3 items-center rounded-xl bg-[#2D6A4F] py-2.5"
                            >
                              <Text className="text-xs font-bold text-white">重新拍摄</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View className="mt-2.5 gap-2">
                            {msg.inventoryScanCard.items.map((item) => (
                              <View
                                key={item.id}
                                className={`flex-row items-center rounded-xl border px-2.5 py-2.5 ${item.selected ? "border-[#C9DED0] bg-white" : "border-[#EBE3D5] bg-[#F5EFE6] opacity-55"}`}
                              >
                                <TouchableOpacity
                                  onPress={() => toggleInventoryScanItem(msg.id, item.id)}
                                  disabled={msg.inventoryScanCard?.status !== "review"}
                                  className={`mr-2.5 h-5 w-5 items-center justify-center rounded-full ${item.selected ? "bg-[#2D6A4F]" : "border border-[#B9AE9F] bg-white"}`}
                                >
                                  {item.selected ? <FontAwesome6 name="check" size={9} color="#FFF" /> : null}
                                </TouchableOpacity>
                                <View className="flex-1">
                                  <Text className="text-[11px] font-black text-[#3D3229]" numberOfLines={1}>{item.foodName}</Text>
                                  <Text className="mt-0.5 text-[9px] text-[#8B7D6B]" numberOfLines={1}>
                                    {item.quantity} · {item.suggestedStorageLocation} · {item.estimatedExpireDays} 天
                                  </Text>
                                </View>
                                {msg.inventoryScanCard?.status === "review" ? (
                                  <TouchableOpacity
                                    onPress={() => openInventoryScanEditor(msg.id, item)}
                                    className="ml-2 h-7 w-7 items-center justify-center rounded-lg bg-[#2D6A4F]/10"
                                  >
                                    <FontAwesome6 name="pen" size={10} color="#2D6A4F" />
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            ))}

                            {msg.inventoryScanCard.status === "saved" ? (
                              <TouchableOpacity
                                onPress={() => onOpenInventory()}
                                className="mt-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-emerald-100 py-2.5"
                              >
                                <FontAwesome6 name="circle-check" size={12} color="#2D6A4F" />
                                <Text className="text-xs font-black text-[#2D6A4F]">已入库 · 查看食材库</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                onPress={() => confirmInventoryScanCard(msg.id, msg.inventoryScanCard!)}
                                disabled={msg.inventoryScanCard.status === "saving"}
                                className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-[#2D6A4F] py-3 disabled:opacity-60"
                              >
                                {msg.inventoryScanCard.status === "saving" ? <ActivityIndicator size="small" color="#FFF" /> : <FontAwesome6 name="check" size={11} color="#FFF" />}
                                <Text className="text-xs font-black text-white">
                                  {msg.inventoryScanCard.status === "saving"
                                    ? "正在加入食材库…"
                                    : `确认加入 ${msg.inventoryScanCard.items.filter((item) => item.selected).length} 项`}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    )}

                    {/* Missing Ingredients Shopping Card */}
                    {msg.missingCard && (
                      <View className="mt-3 bg-amber-500/10 p-3.5 rounded-2xl border border-amber-500/30 shadow-xs">
                        <View className="flex-row items-center justify-between mb-2 pb-1.5 border-b border-amber-500/20">
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome6 name="basket-shopping" size={12} color="#D4A276" />
                            <Text className="text-xs font-black text-[#3D3229]">缺料智能采购卡片</Text>
                          </View>
                          <View className="bg-amber-600 px-2 py-0.5 rounded-full">
                            <Text className="text-[10px] font-bold text-white">缺食材预警</Text>
                          </View>
                        </View>

                        <Text className="text-xs font-black text-[#3D3229] mb-1.5">
                          想吃菜品: 【{msg.missingCard.dishName}】
                        </Text>

                        {/* 缺失食材列表 Chips */}
                        <View className="flex-row flex-wrap gap-1.5 mb-3">
                          {msg.missingCard.missingIngredients.map((item, idx) => (
                            <View key={idx} className="bg-white px-2.5 py-1 rounded-xl border border-amber-500/30 flex-row items-center gap-1">
                              <FontAwesome6 name="circle-exclamation" size={9} color="#E76F51" />
                              <Text className="text-[10px] font-bold text-[#3D3229]">{item.name}</Text>
                              <Text className="text-[9px] text-[#8B7D6B] font-medium">({item.amount})</Text>
                            </View>
                          ))}
                        </View>

                        {msg.missingCard.savedToList ? (
                          <View className="bg-amber-100 py-2 rounded-xl flex-row items-center justify-center gap-1.5 border border-amber-300">
                            <FontAwesome6 name="circle-check" size={13} color="#D4A276" />
                            <Text className="text-xs font-bold text-[#8B7D6B]">已存入采购清单</Text>
                          </View>
                        ) : (
                          <View className="flex-row items-center gap-2">
                            <TouchableOpacity
                              onPress={() => handleSaveToShoppingList(msg.id, msg.missingCard!)}
                              className="flex-1 bg-[#D4A276] py-2 rounded-xl items-center shadow-xs active:opacity-90 flex-row justify-center gap-1"
                            >
                              <FontAwesome6 name="cart-plus" size={11} color="#FFF" />
                              <Text className="text-xs font-bold text-white">一键存入采购清单</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => handleSendMessage(`我冰箱里只有现有食材，请为我用冰箱里的食材替代推荐适合的料理！`)}
                              className="bg-white px-3 py-2 rounded-xl border border-[#EBE3D5] items-center active:opacity-90 flex-row justify-center gap-1"
                            >
                              <FontAwesome6 name="wand-magic-sparkles" size={10} color="#2D6A4F" />
                              <Text className="text-[11px] font-bold text-[#2D6A4F]">用现有食材替代</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Option Choices Action Card (仅在无方案卡片时显示) */}
                    {msg.optionsCard && (!msg.solutionCards || msg.solutionCards.length === 0) && (
                      <View className="mt-3 bg-white p-3 rounded-2xl border border-[#2D6A4F]/30 shadow-xs">
                        <Text className="text-xs font-black text-[#2D6A4F] mb-2 px-1">
                          {msg.optionsCard.title}
                        </Text>
                        <View className="gap-2">
                          {msg.optionsCard.options.map((opt, idx) => (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => handleSendMessage(opt.actionText)}
                              className="bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 py-2.5 px-3 rounded-xl flex-row items-center justify-between active:opacity-80"
                            >
                              <Text className="text-xs font-bold text-[#3D3229] flex-1 mr-2" numberOfLines={1}>
                                {opt.label}
                              </Text>
                              <View className="bg-[#2D6A4F] px-2 py-0.5 rounded-lg flex-row items-center gap-1">
                                <Text className="text-[10px] font-bold text-white">选择此方案</Text>
                                <FontAwesome6 name="chevron-right" size={8} color="#FFF" />
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Rich Bento Solution Cards List (包含完整食材与做法细节) */}
                    {msg.solutionCards && msg.solutionCards.length > 0 && (
                      <View className="mt-3 gap-2.5">
                        <Text className="text-xs font-black text-[#2D6A4F] px-1">
                          推荐的平替解决方案卡片（含完整食材与亮点）：
                        </Text>
                        {msg.solutionCards.map((card) => (
                          <View
                            key={card.id}
                            className="bg-white rounded-2xl p-3.5 border border-[#2D6A4F]/25 shadow-xs"
                          >
                            {/* 头部：方案 Tag + 菜名 */}
                            <View className="flex-row items-center justify-between mb-2 gap-2">
                              <View className="bg-[#2D6A4F] px-2.5 py-0.5 rounded-full shrink-0">
                                <Text className="text-[10px] font-black text-white">{card.schemeTag}</Text>
                              </View>
                              <Text className="text-xs font-black text-[#3D3229] flex-1 text-right" numberOfLines={1}>
                                {card.title}
                              </Text>
                            </View>

                            {/* 第二行：营养数据独占一行胶囊 */}
                            <View className="bg-[#2D6A4F]/10 px-2.5 py-1 rounded-xl border border-[#2D6A4F]/20 mb-2.5 flex-row items-center gap-1.5 self-start">
                              <FontAwesome6 name="fire" size={10} color="#2D6A4F" />
                              <Text className="text-[10px] font-bold text-[#2D6A4F]">
                                {card.macros}
                              </Text>
                            </View>

                            {/* 方案细节卡片内集成展示 */}
                            <View className="bg-[#F6F4F0] p-2.5 rounded-xl mb-3 border border-[#EBE3D5] gap-1.5">
                              <View className="flex-row items-start gap-1.5">
                                <FontAwesome6 name="carrot" size={10} color="#2D6A4F" className="mt-0.5" />
                                <Text className="text-[11px] font-medium text-[#3D3229] flex-1 leading-relaxed">
                                  {card.ingredients}
                                </Text>
                              </View>
                              {card.cookingTip ? (
                                <View className="flex-row items-start gap-1.5 pt-1.5 border-t border-[#EBE3D5]/60">
                                  <FontAwesome6 name="fire-burner" size={10} color="#D4A276" className="mt-0.5" />
                                  <Text className="text-[10px] text-[#8B7D6B] flex-1 leading-relaxed">
                                    {card.cookingTip}
                                  </Text>
                                </View>
                              ) : null}
                            </View>

                            <TouchableOpacity
                              onPress={() => handleSendMessage(card.actionText)}
                              className="bg-[#2D6A4F] py-2 rounded-xl items-center flex-row justify-center gap-1.5 shadow-2xs active:opacity-90"
                            >
                              <FontAwesome6 name="utensils" size={10} color="#FFF" />
                              <Text className="text-xs font-bold text-white">选择【{card.schemeTag}】制作</Text>
                              <FontAwesome6 name="chevron-right" size={9} color="#FFF" />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>

                  {msg.sender === "user" && (
                    <View className="w-9 h-9 rounded-full bg-[#2D6A4F] items-center justify-center ml-2.5 mt-0.5 shadow-xs overflow-hidden border border-white">
                      <Image
                        source={getAvatarSource(userAvatarUrl, userAvatarSeed)}
                        className="w-9 h-9 rounded-full"
                        resizeMode="cover"
                      />
                    </View>
                  )}
                </View>
  );
}

