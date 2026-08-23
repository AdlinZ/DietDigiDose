import { useState, useCallback, useEffect, useRef, type ComponentProps } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { inferCategoryByName } from "@/utils/ingredientRules";
import { Screen } from "@/components/Screen";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { RecipeCover } from "@/components/RecipeCover";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { healthApi, inventoryApi, recipesApi, shoppingListApi, type InventoryItem } from "@/services/api";
import { ingredientNamesMatch } from "@/utils/ingredients";
import { getInventoryStatus } from "@/utils/inventory";
import { ALLERGY_LABELS, findRecipeAllergyRisks, hasSafetyProfile, safetySummary, type HealthProfile } from "@/utils/healthProfile";
import { getRecipeNutritionPresentation } from "@/utils/recipeQuality";
import { addToCookingQueue, getCookingQueue } from "@/utils/cookingQueue";

type IconName = ComponentProps<typeof FontAwesome6>["name"];

type NutritionItem = {
  key: string;
  label: string;
  value: number;
  unit: string;
};

type IngredientGroup = "主料" | "辅料" | "调味料";
type RecipeIngredient = { name: string; amount: string; group?: IngredientGroup };

interface Recipe {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  ingredients: RecipeIngredient[];
  steps: string[];
  cook_time: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutrition?: NutritionItem[];
  category: string;
  tags: string[];
  source?: string;
  author_username?: string;
  author_avatar_url?: string;
  quality_status: "trusted" | "estimated" | "needs_review";
  nutrition_basis: "source" | "ingredient_estimate" | "category_fallback";
  nutrition_is_estimated: boolean;
}

export default function RecipeDetailScreen() {
  const router = useSafeRouter();
  const { id, pendingAction } = useSafeSearchParams<{ id: number; pendingAction?: "favorite" | "shopping-list" | "queue" }>();
  const { isAuthenticated, user } = useAuth();
  const userId = user?.id;
  const authFetch = useAuthFetch();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [nutritionExpanded, setNutritionExpanded] = useState(false);
  const [preparedIngredients, setPreparedIngredients] = useState<Set<string>>(() => new Set());
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [favoriteNotice, setFavoriteNotice] = useState<string | null>(null);
  const favoriteNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(null);
  const [isQueued, setIsQueued] = useState(false);
  const [queueSaving, setQueueSaving] = useState(false);

  const showFavoriteNotice = useCallback((message: string) => {
    if (favoriteNoticeTimer.current) clearTimeout(favoriteNoticeTimer.current);
    setFavoriteNotice(message);
    favoriteNoticeTimer.current = setTimeout(() => {
      setFavoriteNotice(null);
      favoriteNoticeTimer.current = null;
    }, 2200);
  }, []);

  useEffect(() => () => {
    if (favoriteNoticeTimer.current) clearTimeout(favoriteNoticeTimer.current);
  }, []);

  const fetchRecipe = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setRecipe(await recipesApi.detail(Number(id)) as Recipe);
    } catch (error) {
      console.error("Failed to fetch recipe:", error);
      setRecipe(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchRecipe();
  }, [fetchRecipe]);

  useEffect(() => {
    if (!id || !isAuthenticated) {
      setIsFavorited(false);
      return;
    }
    void recipesApi.favoriteState(authFetch, Number(id))
      .then((data) => setIsFavorited(Boolean(data?.is_favorited)))
      .catch(() => setIsFavorited(false));
  }, [authFetch, id, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !pendingAction) return;
    const notice = pendingAction === "favorite"
      ? "已返回菜谱，请再次点击收藏"
      : pendingAction === "queue"
        ? "已返回菜谱，请确认加入烹饪队列"
        : "已返回菜谱，请确认加入采购清单";
    showFavoriteNotice(notice);
    router.setParams({ pendingAction: undefined });
  }, [isAuthenticated, pendingAction, showFavoriteNotice]);

  useFocusEffect(useCallback(() => {
    if (!userId || !id) {
      setIsQueued(false);
      return;
    }
    let active = true;
    void getCookingQueue(userId)
      .then((items) => {
        if (active) setIsQueued(items.some((item) => item.recipeId === Number(id)));
      })
      .catch(() => {
        if (active) setIsQueued(false);
      });
    return () => {
      active = false;
    };
  }, [id, userId]));

  useEffect(() => {
    if (!isAuthenticated) {
      setInventory([]);
      setHealthProfile(null);
      return;
    }
    void Promise.all([
      inventoryApi.list(authFetch).catch(() => []),
      healthApi.profile<HealthProfile>(authFetch).catch(() => null),
    ]).then(([items, profile]) => {
      setInventory(items);
      setHealthProfile(profile);
    });
  }, [authFetch, isAuthenticated]);

  if (loading) {
    return (
      <Screen backgroundColor="#F6F1E8">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2D6A4F" />
          <Text className="mt-3 text-sm text-[#7A7165]">正在准备菜谱…</Text>
        </View>
      </Screen>
    );
  }

  if (!recipe) {
    return (
      <Screen backgroundColor="#F6F1E8">
        <View className="flex-1 items-center justify-center px-6">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-[#E4EEE7]">
            <FontAwesome6 name="utensils" size={22} color="#2D6A4F" />
          </View>
          <Text className="mt-4 text-base font-bold text-[#27352D]">菜谱暂时找不到</Text>
          <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-full bg-brand px-6 py-3">
            <Text className="font-bold text-white">返回上一页</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const tags = (recipe.tags || []).filter(Boolean).slice(0, 3);
  const nutritionPresentation = getRecipeNutritionPresentation(recipe.nutrition_is_estimated);
  const nutrition = (recipe.nutrition?.length ? recipe.nutrition : [
    { key: "protein", label: "蛋白质", value: recipe.protein, unit: "g" },
    { key: "carbs", label: "碳水", value: recipe.carbs, unit: "g" },
    { key: "fat", label: "脂肪", value: recipe.fat, unit: "g" },
  ]).filter((item) => Number.isFinite(Number(item.value)));
  const visibleNutrition = nutritionExpanded ? nutrition : nutrition.slice(0, 6);
  const nutritionColumns = visibleNutrition.length === 4 ? 2 : Math.min(Math.max(visibleNutrition.length, 1), 3);
  const nutritionRows: NutritionItem[][] = [];
  for (let index = 0; index < visibleNutrition.length; index += nutritionColumns) {
    nutritionRows.push(visibleNutrition.slice(index, index + nutritionColumns));
  }
  const groupedIngredients = (["主料", "辅料", "调味料"] as IngredientGroup[]).map((group) => ({
    group,
    items: (recipe.ingredients || [])
      .map((ingredient, index) => ({ ingredient, index, key: `${group}-${ingredient.name}-${index}` }))
      .filter(({ ingredient }) => (ingredient.group || "辅料") === group),
  })).filter(({ items }) => items.length > 0);
  const ingredientAvailability = (recipe.ingredients || []).map((ingredient) => {
    const matchingItem = inventory.find((item) =>
      item.is_available && ingredientNamesMatch(ingredient.name, item.food_name),
    );
    return {
      name: ingredient.name,
      matchingItem,
      isExpiring: matchingItem ? getInventoryStatus(matchingItem).freshness === "expiring" : false,
    };
  });
  const matchedIngredients = ingredientAvailability.filter((item) => item.matchingItem);
  const missingIngredients = ingredientAvailability.filter((item) => !item.matchingItem);
  const expiringIngredients = ingredientAvailability.filter((item) => item.isExpiring);
  const allergyRisks = findRecipeAllergyRisks((recipe.ingredients || []).map((item) => item.name), healthProfile?.allergies);
  const safetyNotes = safetySummary(healthProfile);
  const hasAllergyRisk = allergyRisks.length > 0;
  const hasSevereRisk = allergyRisks.some((item) => item.severity === "severe");
  const requestSafeReplacement = () => router.push({
    pathname: "/ai-assistant",
    params: {
      prompt: `我想做【${recipe.title}】，但我的安全档案中有${allergyRisks.map((item) => `${item.name}（${ALLERGY_LABELS[item.severity]}）`).join("、") || "饮食或健康限制"}。请先核对全部限制，再提供不含风险成分、避免交叉污染的食材替换和完整做法；不要给出用药调整建议。`,
    },
  });
  const togglePrepared = (key: string) => {
    setPreparedIngredients((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const handleAddMissingToShoppingList = async () => {
    if (missingIngredients.length === 0) return;
    try {
      const existing = await shoppingListApi.list<Array<{ name: string }>>(authFetch);
      const existingNames = new Set(existing.map((item) => item.name));
      const recipeIngredients = recipe?.ingredients || [];
      const newItems = missingIngredients
        .filter((item) => !existingNames.has(item.name))
        .map((item) => {
          const detail = recipeIngredients.find((r) => r.name === item.name);
          return {
            clientId: `recipe:${recipe.id}:${item.name}`,
            name: item.name,
            amount: detail?.amount || "适量",
            category: inferCategoryByName(item.name),
            checked: false,
          };
        });

      if (newItems.length === 0) {
        Alert.alert("已在清单中", "缺失食材已被添加到你的采购清单中。");
        return;
      }

      await Promise.all(newItems.map((item) => shoppingListApi.create(authFetch, item)));
      Alert.alert("已加采购清单", `已成功将 ${newItems.length} 种缺少食材加入你的采购清单！`, [
        { text: "查看清单", onPress: () => router.push("/shopping-list") },
        { text: "好的", style: "cancel" },
      ]);
    } catch {
      Alert.alert("添加失败", "保存采购清单时出错，请稍后重试。");
    }
  };
  const toggleFavorite = async () => {
    if (!isAuthenticated) {
      router.push("/login", { returnTo: { pathname: "/recipe-detail", params: { id: recipe.id, pendingAction: "favorite" } } });
      return;
    }
    if (favoriteLoading) return;
    const nextFavorited = !isFavorited;
    setIsFavorited(nextFavorited);
    setFavoriteLoading(true);
    try {
      if (nextFavorited) await recipesApi.favorite(authFetch, recipe.id);
      else await recipesApi.unfavorite(authFetch, recipe.id);
      showFavoriteNotice(nextFavorited ? "收藏成功" : "已取消收藏");
    } catch {
      setIsFavorited(!nextFavorited);
      showFavoriteNotice("操作失败，请稍后重试");
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleQueueAction = async () => {
    if (hasAllergyRisk) {
      requestSafeReplacement();
      return;
    }
    if (!isAuthenticated || !userId) {
      router.push("/login", {
        returnTo: { pathname: "/recipe-detail", params: { id: recipe.id, pendingAction: "queue" } },
      });
      return;
    }
    if (isQueued) {
      router.push("/cooking-queue");
      return;
    }
    if (queueSaving) return;

    setQueueSaving(true);
    try {
      const result = await addToCookingQueue(userId, {
        recipeId: recipe.id,
        title: recipe.title,
        imageUrl: recipe.image_url,
        cookTime: recipe.cook_time,
        calories: recipe.calories,
        difficulty: recipe.difficulty,
        addedAt: Date.now(),
        ingredients: (recipe.ingredients || []).map((ingredient) => ({
          name: ingredient.name,
          amount: ingredient.amount || "适量",
        })),
        preparedIngredientNames: [],
      });
      setIsQueued(true);
      if (!result.added) {
        router.push("/cooking-queue");
        return;
      }
      Alert.alert("已加入烹饪队列", "准备好后，可以从队列开始烹饪。", [
        { text: "查看队列", onPress: () => router.push("/cooking-queue") },
        { text: "继续浏览", style: "cancel" },
      ]);
    } catch {
      Alert.alert("加入失败", "保存烹饪队列时出错，请稍后重试。");
    } finally {
      setQueueSaving(false);
    }
  };

  return (
    <Screen backgroundColor="#F6F1E8">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="w-full max-w-[960px] self-center">
          <View className="relative overflow-hidden md:mt-5 md:rounded-[28px]">
            <RecipeCover
              uri={recipe.image_url}
              className="h-[300px] w-full md:h-[420px]"
              placeholderClassName="h-[300px] w-full items-center justify-center bg-[#DDE8DF] md:h-[420px]"
            />
            <View className="absolute inset-0 bg-black/10" />
            <TouchableOpacity
              onPress={() => router.back()}
              accessibilityLabel="返回"
              className="absolute left-4 top-4 h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/90 shadow-sm active:opacity-80"
            >
              <FontAwesome6 name="chevron-left" size={16} color="#23382B" />
            </TouchableOpacity>
            <View className="absolute right-4 top-4 flex-row gap-2">
              <TouchableOpacity
                onPress={() => router.push({
                  pathname: "/feedback",
                  params: { category: "issue", page: "食谱详情", recipeId: String(recipe.id), recipeTitle: recipe.title },
                })}
                accessibilityLabel="反馈此食谱"
                className="h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/90 shadow-sm active:opacity-80"
              >
                <FontAwesome6 name="flag" size={15} color="#7A6F63" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={toggleFavorite}
                disabled={favoriteLoading}
                accessibilityLabel={isFavorited ? "取消收藏菜谱" : "收藏菜谱"}
                className="h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/90 shadow-sm active:opacity-80 disabled:opacity-60"
              >
                <FontAwesome6
                  name="bookmark"
                  size={18}
                  color={isFavorited ? "#D49A2A" : "#3E4B42"}
                  solid={isFavorited}
                />
              </TouchableOpacity>
            </View>
            {favoriteNotice ? (
              <View
                accessibilityLiveRegion="polite"
                className="absolute right-4 top-[68px] rounded-full bg-[#20362A]/90 px-3 py-2 shadow-sm"
              >
                <Text className="text-xs font-bold text-white">{favoriteNotice}</Text>
              </View>
            ) : null}
            <View className="absolute bottom-4 left-4 flex-row gap-2">
              <View className="rounded-full bg-[#1F5038]/90 px-3 py-1.5">
                <Text className="text-xs font-bold text-white">{recipe.category}</Text>
              </View>
              <View className="rounded-full bg-white/90 px-3 py-1.5">
                <Text className="text-xs font-bold text-ink">{recipe.difficulty}难度</Text>
              </View>
            </View>
          </View>

          <View className="z-10 mx-4 -mt-2 rounded-[26px] border border-[#E8DFD2] bg-[#FFFDF9] p-5 shadow-sm md:mx-8 md:-mt-8 md:p-7">
            <View className="flex-row items-start justify-between gap-4">
              <View className="flex-1">
                <Text className="text-[10px] font-bold tracking-[2px] text-[#8B765D]">今日推荐菜谱</Text>
                <Text className="mt-1 text-[26px] font-bold leading-8 text-[#20362A] md:text-[32px] md:leading-10">
                  {recipe.title}
                </Text>
              </View>
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#E5F0E8]">
                <FontAwesome6 name="leaf" size={19} color="#2D6A4F" />
              </View>
            </View>

            <Text className="mt-3 text-sm leading-6 text-[#6C6258] md:text-[15px]">
              {recipe.description}
            </Text>

            {tags.length > 0 ? (
              <View className="mt-4 flex-row flex-wrap gap-2">
                {tags.map((tag) => (
                  <View key={tag} className="rounded-full bg-[#F2ECE3] px-3 py-1.5">
                    <Text className="text-[11px] font-semibold text-[#746555]">#{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {recipe.source === "user" ? (
              <View className="mt-4 flex-row items-center border-t border-[#EEE6DA] pt-4">
                <Image
                  source={getAvatarSource(recipe.author_avatar_url, recipe.author_username ?? recipe.id)}
                  className="h-9 w-9 rounded-full"
                />
                <View className="ml-3">
                  <Text className="text-[10px] text-copy-muted">食友原创投稿</Text>
                  <Text className="text-sm font-bold text-ink">
                    {recipe.author_username || "匿名食友"}
                  </Text>
                </View>
              </View>
            ) : null}

            <View className="mt-5 flex-row rounded-2xl bg-[#F6F2EA] px-2 py-4">
              <QuickInfo icon="clock" label="用时" value={`${nutritionPresentation.prefix}${recipe.cook_time}分钟`} color="#2D6A4F" />
              <View className="w-px bg-[#E3D9CA]" />
              <QuickInfo icon="fire" label="热量" value={`${nutritionPresentation.prefix}${recipe.calories} kcal`} color="#D4674F" />
              <View className="w-px bg-[#E3D9CA]" />
              <QuickInfo icon="signal" label="难度" value={recipe.difficulty} color="#B47B39" />
              <View className="w-px bg-[#E3D9CA]" />
              <QuickInfo icon="bowl-food" label="食材" value={`${recipe.ingredients?.length || 0}种`} color="#667B52" />
            </View>
          </View>

          {hasSafetyProfile(healthProfile) ? (
            <View className={`mx-4 mt-4 rounded-[24px] border p-5 md:mx-8 ${hasAllergyRisk ? "border-[#E7A594] bg-[#FFF0EC]" : "border-[#E8D49B] bg-[#FFF9E8]"}`}>
              <View className="flex-row items-start">
                <View className={`h-10 w-10 items-center justify-center rounded-2xl ${hasAllergyRisk ? "bg-[#F8D4CB]" : "bg-[#F5E8B9]"}`}>
                  <FontAwesome6 name={hasAllergyRisk ? "triangle-exclamation" : "shield-halved"} size={16} color={hasAllergyRisk ? "#B42318" : "#8A6818"} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className={`text-base font-black ${hasAllergyRisk ? "text-[#8E2F20]" : "text-[#735817]"}`}>
                    {hasSevereRisk ? "已拦截：包含重度风险食材" : hasAllergyRisk ? "检测到已标记的饮食风险" : "安全档案已应用"}
                  </Text>
                  <Text className={`mt-1 text-xs leading-5 ${hasAllergyRisk ? "text-[#984838]" : "text-[#806C37]"}`}>
                    {hasAllergyRisk
                      ? `菜谱食材可能涉及：${allergyRisks.map((item) => `${item.name}（${ALLERGY_LABELS[item.severity]}）`).join("、")}。配方与交叉污染信息仍需以包装和餐厅说明为准。`
                      : safetyNotes.slice(0, 2).join("；")}
                  </Text>
                </View>
              </View>
              <View className="mt-4 flex-row gap-2">
                <TouchableOpacity onPress={() => router.push("/health-profile")} className="flex-1 items-center rounded-2xl border border-[#CBAE78] bg-white/70 py-3"><Text className="text-xs font-black text-[#6E5623]">核对安全档案</Text></TouchableOpacity>
                <TouchableOpacity onPress={requestSafeReplacement} className={`flex-1 items-center rounded-2xl py-3 ${hasAllergyRisk ? "bg-[#A63D2B]" : "bg-[#8A6C22]"}`}><Text className="text-xs font-black text-white">获取安全替换</Text></TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View className="mx-4 mt-4 rounded-[24px] border border-[#E8DFD2] bg-[#FFFDF9] p-5 md:mx-8 md:p-6">
            <SectionTitle icon="chart-pie" eyebrow="每份参考" title={nutritionPresentation.title} />
            {nutritionPresentation.disclosure ? (
              <Text testID="nutrition-estimate-label" className="mt-3 rounded-xl bg-[#FFF4D8] px-3 py-2 text-xs font-bold leading-5 text-[#7B5B16]">
                {nutritionPresentation.disclosure}
              </Text>
            ) : null}
            <View testID="nutrition-grid" className="mt-4 gap-2.5">
              {nutritionRows.map((row, rowIndex) => (
                <View key={`nutrition-row-${rowIndex}`} testID="nutrition-row" className="flex-row gap-2.5">
                  {row.map((item, columnIndex) => (
                    <NutrientCard
                      key={item.key || `${item.label}-${columnIndex}`}
                      label={item.label}
                      value={item.value}
                      unit={item.unit}
                      paletteIndex={rowIndex * nutritionColumns + columnIndex}
                    />
                  ))}
                  {Array.from({ length: nutritionColumns - row.length }, (_, emptyIndex) => (
                    <View key={`empty-${emptyIndex}`} className="flex-1" />
                  ))}
                </View>
              ))}
            </View>
            {nutrition.length > 6 ? (
              <TouchableOpacity
                accessibilityLabel={nutritionExpanded ? "收起营养数据" : `查看全部 ${nutrition.length} 项`}
                onPress={() => setNutritionExpanded((current) => !current)}
                className="mt-3 flex-row items-center justify-center rounded-xl bg-[#F4EFE7] py-2.5 active:opacity-80"
              >
                <Text className="mr-2 text-xs font-bold text-[#5F6E61]">
                  {nutritionExpanded ? "收起营养数据" : `查看全部 ${nutrition.length} 项`}
                </Text>
                <FontAwesome6 name={nutritionExpanded ? "chevron-up" : "chevron-down"} size={10} color="#5F6E61" />
              </TouchableOpacity>
            ) : null}
          </View>

          <View className="mx-4 mt-4 gap-4 md:mx-8 md:flex-row md:items-start">
            <View className="rounded-[24px] border border-[#E8DFD2] bg-[#FFFDF9] p-5 md:w-[38%] md:p-6">
              <SectionTitle icon="basket-shopping" eyebrow="准备工作" title="备料清单" />
              {isAuthenticated ? (
                <View className="mt-4 rounded-2xl border border-[#DDE8DF] bg-[#F4F8F5] p-3">
                  <Text className="text-xs font-black text-brand">
                    库存匹配 {matchedIngredients.length} 种 · 缺少 {missingIngredients.length} 种
                  </Text>
                  {expiringIngredients.length ? (
                    <Text className="mt-1 text-[11px] font-bold text-[#A8663F]">
                      临期优先：{expiringIngredients.map((item) => item.name).join("、")}
                    </Text>
                  ) : null}
                  {missingIngredients.length ? (
                    <View className="mt-1">
                      <Text className="text-[11px] text-[#7A6F63]">
                        需要补充：{missingIngredients.map((item) => item.name).join("、")}
                      </Text>
                      <TouchableOpacity
                        onPress={handleAddMissingToShoppingList}
                        className="mt-2.5 flex-row items-center justify-center gap-1.5 rounded-xl bg-brand py-2 px-3 active:opacity-90"
                      >
                        <FontAwesome6 name="cart-plus" size={11} color="#FFF" />
                        <Text className="text-xs font-bold text-white">一键将 {missingIngredients.length} 种缺少食材加入采购清单</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ) : (
                <TouchableOpacity onPress={() => router.push("/login")} className="mt-4 rounded-2xl bg-[#F5F1E9] p-3">
                  <Text className="text-[11px] font-bold text-[#6C6258]">登录后查看库存匹配、缺少和临期食材</Text>
                </TouchableOpacity>
              )}
              <View className="mt-4 flex-row items-center justify-between rounded-2xl bg-[#F5F1E9] px-3 py-2.5">
                <Text className="text-[11px] text-[#7A6F63]">点击食材，标记已经备好</Text>
                <Text className="text-sm font-black text-brand">
                  {preparedIngredients.size}/{recipe.ingredients?.length || 0}
                </Text>
              </View>
              <View className="mt-4 gap-5">
                {groupedIngredients.map(({ group, items }) => (
                  <IngredientGroupSection
                    key={group}
                    group={group}
                    items={items}
                    preparedIngredients={preparedIngredients}
                    onToggle={togglePrepared}
                  />
                ))}
              </View>
            </View>

            <View className="rounded-[24px] border border-[#E8DFD2] bg-[#FFFDF9] p-5 md:flex-1 md:p-6">
              <SectionTitle icon="list-check" eyebrow="跟着步骤做" title="烹饪步骤" />
              <View className="mt-5">
                {(recipe.steps || []).map((step, index) => (
                  <View key={`${index}-${step.slice(0, 12)}`} className="flex-row">
                    <View className="w-10 items-center">
                      <View className="h-9 w-9 items-center justify-center rounded-full bg-brand shadow-sm">
                        <Text className="text-xs font-bold text-white">{index + 1}</Text>
                      </View>
                      {index < recipe.steps.length - 1 ? <View className="my-1 w-px flex-1 bg-[#D9E6DD]" /> : null}
                    </View>
                    <View className="ml-3 flex-1 pb-5">
                      <Text className="text-[10px] font-bold tracking-[1.5px] text-[#9A8B78]">
                        步骤 {String(index + 1).padStart(2, "0")}
                      </Text>
                      <Text className="mt-1.5 text-sm leading-6 text-[#3F493F]">{step}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View className="rounded-[24px] border border-[#D9E6DD] bg-[#F3F8F4] p-5 md:flex-1 md:p-6">
              <SectionTitle icon="kitchen-set" eyebrow="装备适配" title="用现有厨具完成这道菜" />
              <Text className="mt-3 text-xs leading-5 text-[#58705D]">AI 会优先匹配你装备库中状态可用的厨具；缺少时会给出替代做法与建议添置的官方厨具。</Text>
              <TouchableOpacity
                onPress={() => router.push({ pathname: "/ai-assistant", params: { prompt: `我要做【${recipe.title}】。请优先使用我已录入且可用的厨具；若缺少关键设备，请给出可替代的烹饪方法，并说明推荐从官方厨具库添加什么。` } })}
                className="mt-4 flex-row items-center justify-center rounded-2xl bg-brand py-3 active:opacity-85"
              >
                <FontAwesome6 name="wand-magic-sparkles" size={13} color="white" />
                <Text className="ml-2 text-xs font-black text-white">按我的厨具适配</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View className="h-6" />
        </View>
      </ScrollView>

      <View className="border-t border-[#E4DBCE] bg-[#FFFDF9] px-4 py-3">
        <View className="w-full max-w-[896px] self-center flex-row items-center">
          <View className="mr-4 flex-1">
            <Text className="text-sm font-bold text-[#273A2E]">
              {hasAllergyRisk ? "需要先确认食材安全吗？" : isQueued ? "已加入烹饪队列" : "想稍后再做这道菜？"}
            </Text>
            <Text className="mt-0.5 text-[10px] text-copy-muted">
              {hasAllergyRisk ? "先获取安全替换方案" : isQueued ? "从队列中统一安排开始顺序" : "加入队列，不会立即进入做饭模式"}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => void handleQueueAction()}
            disabled={queueSaving}
            className={`flex-row items-center justify-center rounded-2xl px-5 py-3.5 shadow-sm active:opacity-85 disabled:opacity-60 md:px-8 ${hasAllergyRisk ? "bg-[#A63D2B]" : "bg-brand"}`}
          >
            <FontAwesome6 name={hasAllergyRisk ? "shield-halved" : isQueued ? "list-check" : "plus"} size={17} color="white" />
            <Text className="ml-2 text-sm font-bold text-white">
              {hasAllergyRisk ? "先获取安全替换" : queueSaving ? "加入中…" : isQueued ? "查看队列" : "加入队列"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Screen>
  );
}

function SectionTitle({ icon, eyebrow, title }: { icon: IconName; eyebrow: string; title: string }) {
  return (
    <View className="flex-row items-center">
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-2xl bg-[#E6F0E8]">
        <FontAwesome6 name={icon} size={15} color="#2D6A4F" />
      </View>
      <View>
        <Text className="text-[9px] font-bold tracking-[1.5px] text-[#9A8A77]">{eyebrow}</Text>
        <Text className="mt-0.5 text-base font-bold text-[#22382A]">{title}</Text>
      </View>
    </View>
  );
}

function QuickInfo({ icon, label, value, color }: { icon: IconName; label: string; value: string; color: string }) {
  return (
    <View className="flex-1 items-center px-1">
      <FontAwesome6 name={icon} size={13} color={color} />
      <Text className="mt-1.5 text-[9px] text-[#9B8E80]">{label}</Text>
      <Text className="mt-0.5 text-[11px] font-bold text-[#263A2E]" numberOfLines={1}>{value}</Text>
    </View>
  );
}

type IndexedIngredient = { ingredient: RecipeIngredient; index: number; key: string };

const INGREDIENT_GROUP_STYLES: Record<IngredientGroup, {
  icon: IconName;
  color: string;
  background: string;
  testID: string;
}> = {
  主料: { icon: "bowl-rice", color: "#2D6A4F", background: "#E8F2EA", testID: "ingredient-group-primary" },
  辅料: { icon: "seedling", color: "#9A7624", background: "#F7EFCF", testID: "ingredient-group-auxiliary" },
  调味料: { icon: "spoon", color: "#A8663F", background: "#F4E4D7", testID: "ingredient-group-seasoning" },
};

function ingredientRows(items: IndexedIngredient[]): IndexedIngredient[][] {
  const rows: IndexedIngredient[][] = [];
  let pending: IndexedIngredient[] = [];
  for (const item of items) {
    const isWide = item.ingredient.name.length > 8 || (item.ingredient.amount || "").length > 10;
    if (isWide) {
      if (pending.length) rows.push(pending);
      rows.push([item]);
      pending = [];
      continue;
    }
    pending.push(item);
    if (pending.length === 2) {
      rows.push(pending);
      pending = [];
    }
  }
  if (pending.length) rows.push(pending);
  return rows;
}

function IngredientGroupSection({
  group,
  items,
  preparedIngredients,
  onToggle,
}: {
  group: IngredientGroup;
  items: IndexedIngredient[];
  preparedIngredients: Set<string>;
  onToggle: (key: string) => void;
}) {
  const style = INGREDIENT_GROUP_STYLES[group];
  const rows = ingredientRows(items);
  return (
    <View testID={style.testID}>
      <View className="mb-2.5 flex-row items-center">
        <View className="mr-2 h-7 w-7 items-center justify-center rounded-xl" style={{ backgroundColor: style.background }}>
          <FontAwesome6 name={style.icon} size={11} color={style.color} />
        </View>
        <Text className="text-sm font-bold text-[#344238]">{group}</Text>
        <Text className="ml-1.5 text-xs font-semibold text-[#9A8D7E]">{items.length} 项</Text>
        <View className="ml-3 h-px flex-1 bg-[#EEE6DA]" />
      </View>
      <View className="gap-2.5">
        {rows.map((row, rowIndex) => {
          const singleWide = row.length === 1 && (row[0].ingredient.name.length > 8 || (row[0].ingredient.amount || "").length > 10);
          return (
            <View key={`${group}-row-${rowIndex}`} className="flex-row gap-2.5">
              {row.map(({ ingredient, key }) => {
                const prepared = preparedIngredients.has(key);
                return (
                  <TouchableOpacity
                    key={key}
                    testID="ingredient-card"
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: prepared }}
                    accessibilityLabel={`${ingredient.name}，${ingredient.amount || "适量"}`}
                    onPress={() => onToggle(key)}
                    className="min-h-20 flex-1 justify-between rounded-2xl border p-3 active:opacity-80"
                    style={{
                      backgroundColor: prepared ? "#EDF5EF" : "#FAF7F1",
                      borderColor: prepared ? "#B9D4C0" : "#EDE4D7",
                    }}
                  >
                    <View className="flex-row items-start">
                      <View
                        className="mr-2 h-5 w-5 items-center justify-center rounded-full border"
                        style={{ backgroundColor: prepared ? style.color : "transparent", borderColor: prepared ? style.color : "#CFC4B6" }}
                      >
                        {prepared ? <FontAwesome6 name="check" size={9} color="#FFFFFF" /> : null}
                      </View>
                      <Text
                        className={`flex-1 text-sm font-bold leading-5 ${prepared ? "text-[#7E897F] line-through" : "text-[#344238]"}`}
                        numberOfLines={2}
                      >
                        {ingredient.name}
                      </Text>
                    </View>
                    <Text className="mt-2 self-end text-sm font-black" style={{ color: style.color }}>
                      {ingredient.amount || "适量"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {row.length === 1 && !singleWide ? <View className="flex-1" /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const NUTRIENT_PALETTES = [
  { color: "#2D6A4F", background: "#E7F1E9" },
  { color: "#9A7624", background: "#F7EFCF" },
  { color: "#A8663F", background: "#F4E4D7" },
  { color: "#496A84", background: "#E7EEF3" },
  { color: "#7C5C8E", background: "#EEE7F2" },
  { color: "#7A6A3D", background: "#F0EDDF" },
];

function NutrientCard({
  label,
  value,
  unit,
  paletteIndex,
}: {
  label: string;
  value: number;
  unit: string;
  paletteIndex: number;
}) {
  const palette = NUTRIENT_PALETTES[paletteIndex % NUTRIENT_PALETTES.length];
  const numericValue = Number(value || 0);
  const formattedValue = Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(1);
  return (
    <View testID="nutrient-card" className="flex-1 items-center rounded-2xl px-2 py-4" style={{ backgroundColor: palette.background }}>
      <Text className="text-lg font-bold" style={{ color: palette.color }} numberOfLines={1}>
        {formattedValue}{unit}
      </Text>
      <Text className="mt-1 text-[11px] font-medium text-[#71685E]">{label}</Text>
    </View>
  );
}
