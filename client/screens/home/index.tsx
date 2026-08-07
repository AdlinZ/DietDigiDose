import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Animated,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  TextInput,
  Dimensions,
  Platform,
  Easing,
  type GestureResponderEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/components/Screen";
import { MedicalDisclaimer } from "@/components/MedicalDisclaimer";
import { useFocusEffect } from "expo-router";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { RecipeCover } from "@/components/RecipeCover";
import { toLocalDateKey } from "@/utils/date";
import { getUserStorageKey } from "@/utils/userStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { daysUntilDateKey } from "@/utils/inventory";
import { ingredientNamesMatch, normalizeIngredientName } from "@/utils/ingredients";
import { aiApi } from "@/services/api";
import type { InventoryHighlight, RankedRecipe, RecommendationCard } from "./types";
import { getRecommendationPeriod } from "./recommendations";
import { useHomeData } from "./useHomeData";
import { TodayRecordsModal } from "./TodayRecordsModal";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const RECIPE_BATCH_SIZE = 3;

export default function HomeScreen() {
  const router = useSafeRouter();
  const { isAuthenticated, user } = useAuth();
  const authFetch = useAuthFetch();

  const [activeCategory, setActiveCategory] = useState("全部");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleRecipeCount, setVisibleRecipeCount] = useState(RECIPE_BATCH_SIZE);
  const lastRecipeBatchLoadAt = useRef(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [allRecordsModalVisible, setAllRecordsModalVisible] = useState(false);
  const [aiRecCards, setAiRecCards] = useState<RecommendationCard[]>([]);
  const aiRecommendationRequestKey = useRef("");
  const [activeRecommendationCard, setActiveRecommendationCard] = useState(0);
  const [smartFeedOffset] = useState(() => new Animated.Value(0));
  const [smartFeedOpacity] = useState(() => new Animated.Value(1));
  const smartFeedTouchStart = useRef<{ x: number; y: number } | null>(null);
  const smartFeedAnimating = useRef(false);
  const [activeInventoryHighlight, setActiveInventoryHighlight] = useState(0);
  const [inventoryHighlightOffset] = useState(() => new Animated.Value(0));
  const [inventoryHighlightOpacity] = useState(() => new Animated.Value(1));
  const [activeCommunityPost, setActiveCommunityPost] = useState(0);
  const [communityPostOffset] = useState(() => new Animated.Value(0));
  const [communityPostOpacity] = useState(() => new Animated.Value(1));
  const [activeCaloriePanel, setActiveCaloriePanel] = useState(0);
  const [caloriePanelOffset] = useState(() => new Animated.Value(0));
  const [caloriePanelOpacity] = useState(() => new Animated.Value(1));
  const [calorieProgress] = useState(() => new Animated.Value(0));

  const categories = ["全部", "减脂", "增肌", "营养餐单"];
  const today = toLocalDateKey();
  const { recipes, inventoryItems, expiringItems, todayRecords, posts, healthLogs, loading, error, refresh } =
    useHomeData(authFetch, isAuthenticated, today);

  const shoppingStorageKey = getUserStorageKey("shopping_list", user?.id);
  const [shoppingItems, setShoppingItems] = useState<{ id: string; name: string; amount: string; checked: boolean }[]>([]);

  useFocusEffect(
    useCallback(() => {
      setVisibleRecipeCount(RECIPE_BATCH_SIZE);
      lastRecipeBatchLoadAt.current = 0;
      void refresh();

      if (shoppingStorageKey) {
        AsyncStorage.getItem(shoppingStorageKey).then((saved) => {
          if (saved) {
            try {
              setShoppingItems(JSON.parse(saved));
            } catch {}
          }
        });
      }
    }, [refresh, shoppingStorageKey])
  );

  // 计算今日三大营养素
  const totalCalories = todayRecords.reduce((sum, r) => sum + (r.calories || 0), 0);
  const totalProtein = todayRecords.reduce((sum, r) => sum + (r.protein || 0), 0);
  const totalCarbs = todayRecords.reduce((sum, r) => sum + (r.carbs || 0), 0);
  const totalFat = todayRecords.reduce((sum, r) => sum + (r.fat || 0), 0);

  const targetCalories = user?.daily_calories_target || 2000;
  const calPercent = Math.min(Math.round((totalCalories / targetCalories) * 100), 100);
  const todayWaterMl = healthLogs.find((log) => log.recorded_date === today)?.water_ml || 0;
  const priorityInventoryItem = expiringItems[0];
  const priorityExpiryDays = priorityInventoryItem
    ? Math.max(0, daysUntilDateKey(priorityInventoryItem.expiration_date) ?? 0)
    : null;
  const storageCounts = {
    refrigerated: inventoryItems.filter((item) => (item.storage_location || "冷藏") === "冷藏").length,
    frozen: inventoryItems.filter((item) => item.storage_location === "冷冻").length,
    roomTemperature: inventoryItems.filter((item) => item.storage_location === "常温").length,
  };
  const inventoryHighlights: InventoryHighlight[] = [
    ...(priorityInventoryItem ? [{
      eyebrow: "今日优先消耗",
      title: priorityInventoryItem.food_name,
      description: `剩余 ${priorityInventoryItem.quantity} · ${priorityExpiryDays === 0 ? "今天到期" : `还剩 ${priorityExpiryDays} 天`}`,
      icon: "carrot" as const,
      tone: "amber" as const,
      prompt: `我的【${priorityInventoryItem.food_name}】还剩${priorityInventoryItem.quantity}，${priorityExpiryDays === 0 ? "今天到期" : `还剩${priorityExpiryDays}天到期`}。请优先用它做一份简单健康的消耗餐。`,
    }] : []),
    ...(inventoryItems.length > 0 ? [{
      eyebrow: "库存分布",
      title: `冷藏 ${storageCounts.refrigerated} · 冷冻 ${storageCounts.frozen} · 常温 ${storageCounts.roomTemperature}`,
      description: `当前共 ${inventoryItems.length} 种食材，随时可以开始配餐`,
      icon: "boxes-stacked" as const,
      tone: "green" as const,
    }, {
      eyebrow: "最新备货",
      title: inventoryItems[0]?.food_name || "食材已更新",
      description: `${inventoryItems[0]?.storage_location || "冷藏"} · ${inventoryItems[0]?.quantity || "1份"}，已加入你的保鲜库`,
      icon: "basket-shopping" as const,
      tone: "green" as const,
    }] : [{
      eyebrow: "开始整理保鲜库",
      title: "还没有记录食材",
      description: "添加食材后，系统会为你安排临期提醒和配餐建议",
      icon: "plus" as const,
      tone: "green" as const,
    }]),
  ];
  const activeInventoryCard = inventoryHighlights[activeInventoryHighlight] || inventoryHighlights[0];
  const communityPosts = posts.slice(0, 5);
  const featuredCommunityPost = communityPosts[activeCommunityPost] || communityPosts[0];
  const currentRecommendationHour = new Date().getHours();
  const mealRecommendationCount = aiRecCards.length || (currentRecommendationHour >= 22 || currentRecommendationHour < 5 ? 1 : 2);
  const smartFeedCardCount = mealRecommendationCount + 1 + (expiringItems.length > 0 ? 1 : 0) + (todayWaterMl < 1600 ? 1 : 0);

  const changeSmartFeedCard = useCallback((direction: "prev" | "next") => {
    if (smartFeedCardCount < 2 || smartFeedAnimating.current) return;

    smartFeedAnimating.current = true;
    const exitOffset = direction === "next" ? -28 : 28;
    const enterOffset = -exitOffset;

    Animated.parallel([
      Animated.timing(smartFeedOffset, {
        toValue: exitOffset,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(smartFeedOpacity, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(({ finished }) => {
      if (!finished) {
        smartFeedAnimating.current = false;
        return;
      }

      setActiveRecommendationCard((current) =>
        direction === "next"
          ? (current + 1) % smartFeedCardCount
          : (current - 1 + smartFeedCardCount) % smartFeedCardCount
      );
      smartFeedOffset.setValue(enterOffset);

      Animated.parallel([
        Animated.timing(smartFeedOffset, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(smartFeedOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ]).start(() => {
        smartFeedAnimating.current = false;
      });
    });
  }, [smartFeedCardCount, smartFeedOffset, smartFeedOpacity]);

  useEffect(() => {
    smartFeedOffset.setValue(0);
    smartFeedOpacity.setValue(1);
    smartFeedAnimating.current = false;
    if (smartFeedCardCount < 2) return;

    const intervalId = setInterval(() => changeSmartFeedCard("next"), 4500);
    return () => clearInterval(intervalId);
  }, [changeSmartFeedCard, smartFeedCardCount, smartFeedOffset, smartFeedOpacity]);

  const handleSmartFeedTouchStart = useCallback((event: GestureResponderEvent) => {
    smartFeedTouchStart.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
  }, []);

  const handleSmartFeedTouchEnd = useCallback((event: GestureResponderEvent) => {
    const start = smartFeedTouchStart.current;
    smartFeedTouchStart.current = null;
    if (!start) return;

    const deltaX = event.nativeEvent.pageX - start.x;
    const deltaY = event.nativeEvent.pageY - start.y;
    if (Math.abs(deltaX) < 44 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;

    changeSmartFeedCard(deltaX < 0 ? "next" : "prev");
  }, [changeSmartFeedCard]);

  useEffect(() => {
    Animated.timing(calorieProgress, {
      toValue: calPercent,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [calPercent, calorieProgress]);

  useEffect(() => {
    let panelIndex = 0;
    const intervalId = setInterval(() => {
      panelIndex = (panelIndex + 1) % 3;
      Animated.parallel([
        Animated.timing(caloriePanelOffset, {
          toValue: -8,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(caloriePanelOpacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: false,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setActiveCaloriePanel(panelIndex);
        caloriePanelOffset.setValue(8);
        Animated.parallel([
          Animated.timing(caloriePanelOffset, {
            toValue: 0,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(caloriePanelOpacity, {
            toValue: 1,
            duration: 240,
            useNativeDriver: false,
          }),
        ]).start();
      });
    }, 3800);

    return () => clearInterval(intervalId);
  }, [caloriePanelOffset, caloriePanelOpacity]);

  useEffect(() => {
    inventoryHighlightOffset.setValue(0);
    inventoryHighlightOpacity.setValue(1);
    if (inventoryHighlights.length < 2) return;

    let highlightIndex = 0;
    const intervalId = setInterval(() => {
      highlightIndex = (highlightIndex + 1) % inventoryHighlights.length;
      Animated.parallel([
        Animated.timing(inventoryHighlightOffset, { toValue: -10, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(inventoryHighlightOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setActiveInventoryHighlight(highlightIndex);
        inventoryHighlightOffset.setValue(10);
        Animated.parallel([
          Animated.timing(inventoryHighlightOffset, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
          Animated.timing(inventoryHighlightOpacity, { toValue: 1, duration: 280, useNativeDriver: false }),
        ]).start();
      });
    }, 4200);
    return () => clearInterval(intervalId);
  }, [inventoryHighlightOffset, inventoryHighlightOpacity, inventoryHighlights.length]);

  useEffect(() => {
    communityPostOffset.setValue(0);
    communityPostOpacity.setValue(1);
    if (communityPosts.length < 2) return;

    let postIndex = 0;
    const intervalId = setInterval(() => {
      postIndex = (postIndex + 1) % communityPosts.length;
      Animated.parallel([
        Animated.timing(communityPostOffset, { toValue: -10, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(communityPostOpacity, { toValue: 0, duration: 180, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setActiveCommunityPost(postIndex);
        communityPostOffset.setValue(10);
        Animated.parallel([
          Animated.timing(communityPostOffset, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
          Animated.timing(communityPostOpacity, { toValue: 1, duration: 280, useNativeDriver: false }),
        ]).start();
      });
    }, 5000);
    return () => clearInterval(intervalId);
  }, [communityPostOffset, communityPostOpacity, communityPosts.length]);

  useEffect(() => {
    if (!isAuthenticated || loading) return;

    const period = getRecommendationPeriod(new Date().getHours());
    const requestKey = `${period}:${targetCalories}:${totalCalories}:${totalProtein}:${inventoryItems.map((item) => `${item.id}-${item.expiration_date}`).join(",")}`;
    if (aiRecommendationRequestKey.current === requestKey) return;
    aiRecommendationRequestKey.current = requestKey;

    let active = true;
    const fetchAIRecommendations = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const data = await aiApi.homeRecommendations<{ cards?: unknown[] }>(authFetch, period, controller.signal);
        const cards: RecommendationCard[] = Array.isArray(data.cards)
          ? data.cards
            .filter((card: unknown): card is Record<string, unknown> => !!card && typeof card === "object")
            .map((card: Record<string, unknown>): RecommendationCard => ({
              title: typeof card.title === "string" ? card.title : "",
              tag: typeof card.tag === "string" ? card.tag : "",
              desc: typeof card.desc === "string" ? card.desc : "",
              calories: `${Number(card.calories) || 0} kcal`,
              prompt: typeof card.prompt === "string" ? card.prompt : "",
            }))
            .filter((card: RecommendationCard) => card.title && card.tag && card.desc && card.calories !== "0 kcal" && card.prompt)
            .slice(0, 5)
          : [];
        if (active && cards.length > 0) setAiRecCards(cards);
      } catch (error) {
        // 首页保留时段默认卡片，AI 服务不可用或超时时不影响页面使用。
        console.warn("Home AI recommendations unavailable or timed out", error);
      } finally {
        clearTimeout(timer);
      }
    };

    void fetchAIRecommendations();
    return () => { active = false; };
  }, [authFetch, inventoryItems, isAuthenticated, loading, targetCalories, totalCalories, totalProtein]);

  const filteredRecipes = useMemo<RankedRecipe[]>(() => {
    const availableInventory = inventoryItems.filter((item) => item.is_available && item.food_name.trim());
    const expiringIds = new Set(expiringItems.map((item) => item.id));

    return recipes
      .filter((recipe) => {
        const matchCategory = activeCategory === "全部" || recipe.category === activeCategory;
        const matchSearch =
          !searchQuery ||
          recipe.title.includes(searchQuery) ||
          recipe.description?.includes(searchQuery);
        return matchCategory && matchSearch;
      })
      .map((recipe) => {
        const recipeIngredientNames = (recipe.ingredients || [])
          .map((ingredient) => typeof ingredient === "string" ? ingredient : ingredient.name || "")
          .filter(Boolean);
        const recipeText = normalizeIngredientName(`${recipe.title}${recipe.description || ""}`);
        const matchedItems = availableInventory.filter((item) =>
          recipeIngredientNames.some((ingredientName) => ingredientNamesMatch(ingredientName, item.food_name)) ||
          recipeText.includes(normalizeIngredientName(item.food_name))
        );

        return {
          ...recipe,
          inventoryMatchNames: [...new Set(matchedItems.map((item) => item.food_name))],
          expiringMatchCount: matchedItems.filter((item) => expiringIds.has(item.id)).length,
        };
      })
      .sort((left, right) => {
        if (right.expiringMatchCount !== left.expiringMatchCount) {
          return right.expiringMatchCount - left.expiringMatchCount;
        }
        if (right.inventoryMatchNames.length !== left.inventoryMatchNames.length) {
          return right.inventoryMatchNames.length - left.inventoryMatchNames.length;
        }
        return right.id - left.id;
      });
  }, [activeCategory, expiringItems, inventoryItems, recipes, searchQuery]);

  const visibleRecipes = filteredRecipes.slice(0, visibleRecipeCount);
  const hasMoreRecipes = visibleRecipeCount < filteredRecipes.length;

  useEffect(() => {
    const resetId = setTimeout(() => {
      setVisibleRecipeCount(RECIPE_BATCH_SIZE);
      lastRecipeBatchLoadAt.current = 0;
    }, 0);
    return () => clearTimeout(resetId);
  }, [activeCategory, searchQuery]);

  const insets = useSafeAreaInsets();
  const miniTopOffset = Platform.OS === 'web' ? 12 : Math.max(insets.top + 6, 12);

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      {/* 渐隐渐现 极致悬浮 Mini 胶囊顶栏 */}
      {isScrolled && (
        <View style={{ top: miniTopOffset }} className="absolute left-4 right-4 z-50">
          <View className="bg-white/95 px-4 py-2 rounded-full flex-row items-center justify-between shadow-lg border border-line backdrop-blur-md">
            <View className="bg-brand/10 px-2.5 py-1 rounded-full flex-row items-center gap-1">
              <FontAwesome6 name="fire-flame-curved" size={11} color="#2D6A4F" />
              <Text className="text-xs font-black text-brand">
                {totalCalories} / {targetCalories} kcal
              </Text>
            </View>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity onPress={() => router.push(isAuthenticated ? "/profile" : "/login")}>
                {isAuthenticated ? (
                  <Image
                    source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
                    className="w-7 h-7 rounded-full border border-brand"
                    style={{ width: 28, height: 28, borderRadius: 14 }}
                  />
                ) : (
                  <View className="w-7 h-7 rounded-full bg-brand/15 items-center justify-center">
                    <FontAwesome6 name="user" size={10} color="#2D6A4F" />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const offsetY = contentOffset.y;
          if (offsetY > 70 && !isScrolled) setIsScrolled(true);
          else if (offsetY <= 70 && isScrolled) setIsScrolled(false);

          const distanceFromBottom = contentSize.height - layoutMeasurement.height - offsetY;
          const now = Date.now();
          if (hasMoreRecipes && distanceFromBottom < 280 && now - lastRecipeBatchLoadAt.current > 450) {
            lastRecipeBatchLoadAt.current = now;
            setVisibleRecipeCount((count) =>
              Math.min(count + RECIPE_BATCH_SIZE, filteredRecipes.length)
            );
          }
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 120 }}
        className="bg-canvas"
      >
        {/* Emerald 绿色智能看板 Header 顶栏 */}
        <View className="bg-brand px-5 pt-4 pb-5 rounded-b-[28px] shadow-sm relative overflow-hidden">
          <View className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-white/5" />
          <View className="absolute left-1/3 -bottom-8 w-32 h-32 rounded-full bg-highlight/10" />

          {/* 第一行：用户状态与通知入口 */}
          <View className="flex-row items-center justify-between mb-3">
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push(isAuthenticated ? "/profile" : "/login")}
              className="flex-row items-center gap-2.5 bg-black/20 px-3 py-1.5 rounded-full border border-white/15 shadow-2xs"
            >
              {isAuthenticated ? (
                <Image
                  source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
                  className="w-6 h-6 rounded-full border border-highlight"
                  style={{ width: 24, height: 24, borderRadius: 12 }}
                />
              ) : (
                <View className="w-6 h-6 rounded-full bg-white/20 items-center justify-center">
                  <FontAwesome6 name="user" size={10} color="#FFF" />
                </View>
              )}
              <Text className="text-xs font-bold text-white">
                {isAuthenticated ? `嗨，${user?.username || `食友${user?.id}`}` : "未登录 · 点击登录"}
              </Text>
            </TouchableOpacity>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity onPress={() => router.push("/notifications")} className="w-8 h-8 rounded-full bg-white/15 border border-white/20 items-center justify-center relative shadow-xs active:bg-white/30 backdrop-blur-md">
                <FontAwesome6 name="bell" size={12} color="#FFF" />
                {expiringItems.length > 0 && (
                  <View className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* 首页主任务：直接搜索或让 AI 开始配餐 */}
          <View className="mt-1 bg-white p-2 rounded-2xl border border-white/40 shadow-sm flex-row items-center gap-2">
            <View className="flex-1 bg-canvas px-3.5 py-2.5 rounded-xl border border-line/60 flex-row items-center gap-2">
            <FontAwesome6 name="magnifying-glass" size={13} color="#8B7D6B" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="搜索低卡菜谱、食材或热量..."
              placeholderTextColor="#B0A495"
              className="flex-1 text-xs text-ink py-0"
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <FontAwesome6 name="circle-xmark" size={13} color="#B0A495" />
              </TouchableOpacity>
            ) : null}
            </View>

            <TouchableOpacity
              onPress={() => router.push("/ai-assistant")}
              className="bg-brand px-4 py-2.5 rounded-xl flex-row items-center gap-1.5 shadow-xs active:opacity-90"
            >
              <FontAwesome6 name="wand-magic-sparkles" size={12} color="#FFF" />
              <Text className="text-xs font-black text-white">配餐</Text>
            </TouchableOpacity>
          </View>
        </View>

        {error ? (
          <TouchableOpacity onPress={() => void refresh()} className="mx-5 mt-3 rounded-2xl border border-red-200 bg-red-50 p-3">
            <Text className="text-xs font-bold text-red-700">{error} · 点击重试</Text>
          </TouchableOpacity>
        ) : null}

        {/* ⏰ 时段智能推荐轮播卡片 (Time-Aware Carousel) */}
        {(() => {
          const hour = new Date().getHours();
          let periodTitle = "晨间唤醒配餐推荐";
          let periodSub = "高蛋白元气早餐 · 激活全天的基础代谢";
          let recCards = [
            {
              title: "燕麦水煮蛋能量碗",
              tag: "高蛋白",
              desc: "优质碳水结合蛋白质，饱腹持久不升糖",
              calories: "320 kcal",
              prompt: "帮我评估早餐吃燕麦水煮蛋的营养比例",
            },
            {
              title: "保鲜库牛油果全麦吐司",
              tag: "优质脂肪",
              desc: "用保鲜库现有牛油果涂抹全麦面包",
              calories: "280 kcal",
              prompt: "用保鲜库牛油果推荐一份15分钟快手早餐",
            },
          ];

          if (hour >= 11 && hour < 14) {
            periodTitle = "午间元气续航推荐";
            periodSub = "控糖低脂膳食 · 避免午后嗜睡困倦";
            recCards = [
              {
                title: "鸡胸肉藜麦牛油果沙拉",
                tag: "低脂减脂",
                desc: "煎鸡胸肉配新鲜蔬菜，补充优质蛋白",
                calories: "420 kcal",
                prompt: "帮我用保鲜库鸡胸肉做一份低卡减脂午餐食谱",
              },
              {
                title: "清蒸鲈鱼配杂粮饭",
                tag: "易消化",
                desc: "优质白肉蛋白，补充丰富微量元素",
                calories: "450 kcal",
                prompt: "推荐一份适合工作日的低脂快手午餐",
              },
            ];
          } else if (hour >= 14 && hour < 18) {
            periodTitle = "下午茶防暴饮暴食";
            periodSub = "轻卡低糖冲饮 · 缓解下午精神疲劳";
            recCards = [
              {
                title: "希腊酸奶配一把坚果",
                tag: "低糖高纤",
                desc: "替代高糖奶茶，稳定血糖与注意力",
                calories: "160 kcal",
                prompt: "推荐几款低于200卡路里的健康下午茶替代品",
              },
              {
                title: "无糖黑咖啡配水蜜桃",
                tag: "去水肿",
                desc: "促进代谢，帮助下半场恢复精力",
                calories: "80 kcal",
                prompt: "下午茶想吃甜食有什么低卡解馋选择",
              },
            ];
          } else if (hour >= 18 && hour < 22) {
            periodTitle = "晚间轻负担食谱与明日规划";
            periodSub = "少油少盐易吸收 · 提前规划明日健康食谱";
            recCards = [
              {
                title: "蒜蓉炒鸡胸肉配水煮西蓝花",
                tag: "夜间修护",
                desc: "保鲜库鸡胸肉少油清炒，减轻肠胃负担",
                calories: "310 kcal",
                prompt: "帮我规划明天一整天的健康减脂一日三餐食谱",
              },
              {
                title: "菌菇豆腐清汤",
                tag: "暖胃低热",
                desc: "低卡丰富鲜味，防止夜间高盐浮肿",
                calories: "180 kcal",
                prompt: "晚餐想吃热乎乎的低卡汤品有什么推荐",
              },
            ];
          } else if (hour >= 22 || hour < 5) {
            periodTitle = "深夜守护与睡眠恢复";
            periodSub = "避免高糖大夜宵 · 助睡眠安神推荐";
            recCards = [
              {
                title: "暖洋甘菊茶 / 温无糖牛奶",
                tag: "助眠安神",
                desc: "温暖胃部，促进睡眠，告别失眠与肚饿",
                calories: "110 kcal",
                prompt: "深夜有点饿有什么不会发胖的健康食物",
              },
            ];
          }

          if (aiRecCards.length > 0) {
            recCards = aiRecCards;
          }

          const smartCards = [
            ...recCards.map((card) => ({
              ...card,
              headerTitle: periodTitle,
              headerSub: periodSub,
              actionLabel: "点击让【食语】生成此食谱",
            })),
            ...(expiringItems.length > 0 ? [{
              title: `${expiringItems.length} 件食材临近到期`,
              tag: "临期提醒",
              desc: `优先消耗 ${expiringItems.slice(0, 2).map((item) => item.food_name).join("、")}${expiringItems.length > 2 ? " 等食材" : ""}`,
              calories: "优先处理",
              prompt: `我有${expiringItems.length}件临期食材：${expiringItems.map((item) => item.food_name).join("、")}。请优先用它们安排一份容易完成的餐食。`,
              headerTitle: "临期食材提醒",
              headerSub: "优先消耗，减少浪费，也让食材保持最佳赏味期",
              actionLabel: "点击让【食语】安排消耗方案",
            }] : []),
            {
              title: `今日已摄入 ${totalCalories} kcal`,
              tag: "热量进度",
              desc: totalCalories >= targetCalories
                ? "已接近今日目标，接下来优先选择清淡低热量食物"
                : `距离目标还差 ${targetCalories - totalCalories} kcal，可合理安排下一餐`,
              calories: `${calPercent}%`,
              prompt: `我今天已摄入${totalCalories} kcal，目标是${targetCalories} kcal。请根据我现有库存规划今天接下来的饮食。`,
              headerTitle: "今日饮食进度",
              headerSub: "结合已摄入热量，帮你平衡接下来的每一餐",
              actionLabel: "点击让【食语】规划下一餐",
            },
            ...(todayWaterMl < 1600 ? [{
              title: `今日饮水 ${todayWaterMl} / 2000 ml`,
              tag: "补水提醒",
              desc: todayWaterMl === 0 ? "今天还没有记录饮水，先喝一杯温水吧" : "距离建议饮水量还有一点差距，记得分次补足",
              calories: `${Math.max(0, 2000 - todayWaterMl)} ml`,
              prompt: `我今天已饮水${todayWaterMl} ml。请给我一个不影响睡眠和用餐的补水计划。`,
              headerTitle: "今日补水提醒",
              headerSub: "少量多次补水，帮助保持精神与代谢状态",
              actionLabel: "点击让【食语】制定补水计划",
            }] : []),
          ];
          const activeSmartCard = smartCards[activeRecommendationCard] || smartCards[0];

          return (
            <View className="px-5 mt-4 mb-5">
              <Animated.View
                accessibilityHint={smartCards.length > 1 ? "左右滑动可切换推荐卡片" : undefined}
                onTouchStart={handleSmartFeedTouchStart}
                onTouchEnd={handleSmartFeedTouchEnd}
                onTouchCancel={() => {
                  smartFeedTouchStart.current = null;
                }}
                style={{
                  minHeight: 212,
                  opacity: smartFeedOpacity,
                  transform: [{ translateX: smartFeedOffset }],
                }}
                className="bg-white p-5 rounded-[28px] border border-line shadow-xs overflow-hidden"
              >
                <View className="flex-row items-center justify-between mb-3.5 pb-2.5 border-b border-[#F4EFE6]">
                  <View>
                    <Text className="text-sm font-black text-ink">{activeSmartCard.headerTitle}</Text>
                    <Text className="text-[10px] text-copy-muted mt-0.5">{activeSmartCard.headerSub}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: "/ai-assistant", params: { prompt: activeSmartCard.prompt } })}
                    className="bg-brand/10 px-3 py-1.5 rounded-full flex-row items-center gap-1 active:opacity-80"
                  >
                    <FontAwesome6 name="wand-magic-sparkles" size={11} color="#2D6A4F" />
                    <Text className="text-[11px] font-bold text-brand">问食语 AI</Text>
                  </TouchableOpacity>
                </View>

                {/* 整张智能卡内容会随提醒类型一同纵向切换 */}
                <View>
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: "/ai-assistant",
                        params: { prefill_food: activeSmartCard.title, prompt: activeSmartCard.prompt },
                      })
                    }
                    className="justify-between active:opacity-80"
                  >
                    <View className="flex-row items-center justify-between mb-3">
                      <View className="bg-brand px-2.5 py-0.5 rounded-full">
                        <Text className="text-[10px] font-bold text-white">{activeSmartCard.tag}</Text>
                      </View>
                      <Text className="text-xs font-black text-highlight">{activeSmartCard.calories}</Text>
                    </View>
                    <Text className="text-base font-black text-ink mb-1.5">{activeSmartCard.title}</Text>
                    <Text className="text-xs text-copy-muted leading-5 mb-4" numberOfLines={2}>
                      {activeSmartCard.desc}
                    </Text>
                    <View className="border-t border-[#F4EFE6] pt-3 items-center">
                      <Text className="text-[11px] font-bold text-brand">{activeSmartCard.actionLabel}</Text>
                    </View>
                  </TouchableOpacity>
                {smartCards.length > 1 && (
                  <View className="mt-3 flex-row items-center justify-center gap-1.5">
                    {smartCards.map((_, index) => (
                      <View
                        key={index}
                        className={`h-1.5 rounded-full ${
                          activeRecommendationCard === index ? "w-4 bg-brand" : "w-1.5 bg-highlight/40"
                        }`}
                      />
                    ))}
                  </View>
                )}
                </View>
              </Animated.View>
                <View className="mt-2">
                <MedicalDisclaimer compact />
              </View>
            </View>
          );
        })()}

        {/* 卡路里 & 三大营养素 Dashboard 卡片 */}
        <View className="px-5 mb-5">
          <View className="bg-white rounded-[24px] p-4 border border-line shadow-xs overflow-hidden relative">
            <View className="absolute -right-8 -top-12 w-32 h-32 rounded-full bg-brand/5" />
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="fire" size={15} color="#E9C46A" />
                </View>
                <View>
                  <Text className="text-[10px] font-bold text-copy-muted">今日热量</Text>
                  <View className="flex-row items-baseline gap-1 mt-0.5">
                    <Text className="text-xl font-black text-brand">{totalCalories}</Text>
                    <Text className="text-[10px] text-copy-muted">/ {targetCalories} kcal</Text>
                  </View>
                </View>
              </View>
              <View className="bg-brand/10 px-2.5 py-1 rounded-full">
                <Text className="text-[11px] font-black text-brand">{calPercent}%</Text>
              </View>
            </View>

            <View className="h-1.5 rounded-full bg-background-secondary mt-3 overflow-hidden">
              <Animated.View
                className="h-full rounded-full bg-brand"
                style={{
                  width: calorieProgress.interpolate({
                    inputRange: [0, 100],
                    outputRange: ["0%", "100%"],
                  }),
                }}
              />
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => activeCaloriePanel === 1 ? router.push("/health-data") : router.push("/diet-record")}
              className="mt-3 rounded-2xl bg-canvas border border-[#F4EBE0] px-3 py-2.5"
            >
              <Animated.View
                style={{
                  opacity: caloriePanelOpacity,
                  transform: [{ translateY: caloriePanelOffset }],
                }}
              >
                {activeCaloriePanel === 0 ? (
                  <View className="flex-row items-center">
                    {[
                      { label: "蛋白质", value: `${totalProtein}g` },
                      { label: "碳水", value: `${totalCarbs}g` },
                      { label: "脂肪", value: `${totalFat}g` },
                    ].map((metric, index) => (
                      <View key={metric.label} className={`flex-1 items-center ${index < 2 ? "border-r border-line" : ""}`}>
                        <Text className="text-[9px] text-copy-muted">{metric.label}</Text>
                        <Text className="mt-0.5 text-xs font-black text-ink">{metric.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : activeCaloriePanel === 1 ? (
                  <View className="flex-row items-center">
                    {[
                      { label: "体重", value: healthLogs[0]?.weight == null ? "—" : `${healthLogs[0].weight} kg` },
                      { label: "体脂率", value: healthLogs[0]?.body_fat == null ? "—" : `${healthLogs[0].body_fat}%` },
                      { label: "饮水", value: `${todayWaterMl} ml` },
                    ].map((metric, index) => (
                      <View key={metric.label} className={`flex-1 items-center ${index < 2 ? "border-r border-line" : ""}`}>
                        <Text className="text-[9px] text-copy-muted">{metric.label}</Text>
                        <Text className="mt-0.5 text-xs font-black text-brand">{metric.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View className="h-[34px] flex-row items-center justify-between">
                    <View className="flex-1 mr-3">
                      <Text className="text-[9px] font-bold text-copy-muted">最近一餐 · 共 {todayRecords.length} 笔</Text>
                      <Text className="mt-0.5 text-xs font-black text-ink" numberOfLines={1}>
                        {todayRecords[0]?.food_name || "今天还没有记录饮食"}
                      </Text>
                    </View>
                    <Text className="text-xs font-black text-[#E3A92F]">
                      {todayRecords[0]?.calories == null ? "—" : `${todayRecords[0].calories} kcal`}
                    </Text>
                  </View>
                )}
              </Animated.View>
            </TouchableOpacity>

            <View className="mt-2.5 flex-row items-center justify-center gap-1.5">
              {[0, 1, 2].map((index) => (
                <View
                  key={index}
                  className={`h-1 rounded-full ${activeCaloriePanel === index ? "w-3.5 bg-brand" : "w-1 bg-highlight/40"}`}
                />
              ))}
            </View>

            <View className="flex-row gap-2.5 mt-3 pt-3 border-t border-[#F4EFE6]">
              <TouchableOpacity
                onPress={() => router.push("/diet-record")}
                className="flex-1 bg-brand py-2 rounded-xl items-center flex-row justify-center gap-1.5 active:opacity-80"
              >
                <FontAwesome6 name="plus" size={11} color="#FFF" />
                <Text className="text-[11px] font-bold text-white">记一餐</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/health-data")}
                className="flex-1 bg-highlight py-2 rounded-xl items-center flex-row justify-center gap-1.5 active:opacity-80"
              >
                <FontAwesome6 name="heart-pulse" size={11} color="#3D3229" />
                <Text className="text-[11px] font-black text-ink">健康档案</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 板块零：智能采购清单 (首页专属缺料提醒与入口卡片) */}
        <View className="px-5 mb-5">
          <TouchableOpacity
            onPress={() => router.push("/shopping-list")}
            activeOpacity={0.9}
            className="bg-white rounded-[24px] p-5 border border-line shadow-xs overflow-hidden"
          >
            <View className="flex-row items-center justify-between pb-3 border-b border-[#F4EFE6] mb-3">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-xl bg-amber-500/10 items-center justify-center border border-amber-500/20">
                  <FontAwesome6 name="cart-shopping" size={14} color="#D97706" />
                </View>
                <View>
                  <Text className="text-sm font-black text-ink">
                    智能采购清单 {shoppingItems.filter(i => !i.checked).length > 0 ? `(${shoppingItems.filter(i => !i.checked).length} 项待买)` : ""}
                  </Text>
                  <Text className="text-[10px] text-copy-muted mt-0.5">离线补料买菜 · AI 自动按需存入</Text>
                </View>
              </View>

              <View className="flex-row items-center gap-1 bg-brand/10 px-3 py-1.5 rounded-full">
                <Text className="text-xs font-bold text-brand">去买菜</Text>
                <FontAwesome6 name="chevron-right" size={10} color="#2D6A4F" />
              </View>
            </View>

            {/* 待买项预览 Chips / Empty Hint */}
            {shoppingItems.filter(i => !i.checked).length > 0 ? (
              <View className="bg-[#FAF8F5] p-3 rounded-2xl border border-line flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5 flex-1 flex-wrap mr-2">
                  {shoppingItems.filter(i => !i.checked).slice(0, 3).map((item) => (
                    <View key={item.id} className="bg-white px-2.5 py-1 rounded-full border border-line flex-row items-center gap-1">
                      <FontAwesome6 name="carrot" size={10} color="#D4A276" />
                      <Text className="text-[11px] font-bold text-ink">{item.name}</Text>
                      {item.amount ? <Text className="text-[9px] text-copy-muted">{item.amount}</Text> : null}
                    </View>
                  ))}
                  {shoppingItems.filter(i => !i.checked).length > 3 && (
                    <Text className="text-[10px] font-bold text-copy-muted ml-1">
                      等共 {shoppingItems.filter(i => !i.checked).length} 项...
                    </Text>
                  )}
                </View>

                <View className="w-7 h-7 rounded-full bg-brand items-center justify-center">
                  <FontAwesome6 name="arrow-right" size={11} color="#FFF" />
                </View>
              </View>
            ) : (
              <View className="bg-[#FAF8F5] p-3 rounded-2xl border border-dashed border-line flex-row items-center justify-between">
                <Text className="text-xs text-copy-muted font-medium">当前采购清单空空如也，随时点此录入待买食材</Text>
                <FontAwesome6 name="plus" size={12} color="#D97706" />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* 板块一：食材库概览 (大卡片统合容器) */}
        <View className="px-5 mb-5">
          <View className="bg-white rounded-[24px] p-5 pb-6 border border-line shadow-xs">
            <View className="flex-row items-center justify-between pb-3.5 border-b border-[#F4EFE6] mb-3.5">
              <View className="flex-row items-center gap-2">
                <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="basket-shopping" size={13} color="#2D6A4F" />
                </View>
                <Text className="text-sm font-bold text-ink">
                  食材库概览 {inventoryItems.length > 0 ? `(${inventoryItems.length})` : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => router.push("/inventory")}>
                <Text className="text-xs font-bold text-brand">全部食材 →</Text>
              </TouchableOpacity>
            </View>

            <Animated.View
              style={{ opacity: inventoryHighlightOpacity, transform: [{ translateY: inventoryHighlightOffset }] }}
            >
              <TouchableOpacity
                onPress={() => activeInventoryCard.prompt
                  ? router.push({ pathname: "/ai-assistant", params: { prefill_food: activeInventoryCard.title, prompt: activeInventoryCard.prompt } })
                  : router.push("/inventory")}
                className={`min-h-[96px] rounded-2xl border px-3.5 py-4 flex-row items-center gap-3 active:opacity-80 ${
                  activeInventoryCard.tone === "amber"
                    ? "border-amber-400/35 bg-amber-50"
                    : "border-brand/15 bg-brand/5"
                }`}
              >
                <View className={`w-11 h-11 rounded-xl items-center justify-center ${activeInventoryCard.tone === "amber" ? "bg-amber-400/20" : "bg-white"}`}>
                  <FontAwesome6 name={activeInventoryCard.icon} size={17} color={activeInventoryCard.tone === "amber" ? "#B7791F" : "#2D6A4F"} />
                </View>
                <View className="flex-1">
                  <Text className={`text-[10px] font-black ${activeInventoryCard.tone === "amber" ? "text-amber-800" : "text-brand"}`}>{activeInventoryCard.eyebrow}</Text>
                  <Text className="mt-0.5 text-sm font-black text-ink" numberOfLines={1}>{activeInventoryCard.title}</Text>
                  <Text className="mt-0.5 text-[11px] text-copy-muted" numberOfLines={1}>{activeInventoryCard.description}</Text>
                </View>
                <View className={`w-8 h-8 rounded-xl items-center justify-center ${activeInventoryCard.tone === "amber" ? "bg-amber-400" : "bg-brand"}`}>
                  <FontAwesome6 name={activeInventoryCard.prompt ? "wand-magic-sparkles" : "chevron-right"} size={10} color={activeInventoryCard.tone === "amber" ? "#5C3A07" : "#FFF"} />
                </View>
              </TouchableOpacity>
            </Animated.View>

            <View className="mt-4">
              <Text className="mb-2 text-[10px] font-bold text-copy-muted">按存放方式查看</Text>
              <View className="flex-row gap-2">
                {[
                  { label: "冷藏", count: storageCounts.refrigerated },
                  { label: "冷冻", count: storageCounts.frozen },
                  { label: "常温", count: storageCounts.roomTemperature },
                ].map((storage) => (
                  <TouchableOpacity
                    key={storage.label}
                    onPress={() => router.push("/inventory")}
                    className="flex-1 rounded-xl border border-[#E8EFEA] bg-[#F7FAF8] px-2 py-3 items-center active:opacity-80"
                  >
                    <Text className="text-lg font-black text-brand">{storage.count}</Text>
                    <Text className="mt-0.5 text-[10px] font-bold text-[#6F7D73]">{storage.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              onPress={() => router.push("/inventory", { action: "add" })}
              className="mt-3.5 rounded-2xl bg-brand px-4 py-3 flex-row items-center justify-center gap-2.5 active:opacity-80"
            >
              <View className="w-7 h-7 rounded-full bg-white/15 items-center justify-center">
                <FontAwesome6 name="plus" size={11} color="#FFFFFF" />
              </View>
              <View>
                <Text className="text-xs font-black text-white">录入食材</Text>
                <Text className="mt-0.5 text-[9px] text-emerald-100/80">拍照识别或手动添加</Text>
              </View>
            </TouchableOpacity>

            {inventoryHighlights.length > 1 && (
              <View className="mt-4 flex-row justify-center gap-1.5">
                {inventoryHighlights.map((highlight, index) => (
                  <View key={highlight.eyebrow} className={`h-1.5 rounded-full ${activeInventoryHighlight === index ? "w-4 bg-brand" : "w-1.5 bg-highlight/40"}`} />
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 板块二：食光社区精选 (大卡片统合容器) */}
        <View className="px-5 mb-5">
          <View className="bg-white rounded-[24px] p-5 border border-line shadow-xs">
            <View className="flex-row items-center justify-between pb-3.5 border-b border-[#F4EFE6] mb-3.5">
              <View className="flex-row items-center gap-2">
                <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="compass" size={13} color="#2D6A4F" />
                </View>
                <Text className="text-sm font-bold text-ink">食光社区精选</Text>
              </View>
              <TouchableOpacity onPress={() => router.push("/community")}>
                <Text className="text-xs font-bold text-brand">互动社区 →</Text>
              </TouchableOpacity>
            </View>

            {featuredCommunityPost ? (
              <Animated.View style={{ opacity: communityPostOpacity, transform: [{ translateY: communityPostOffset }] }}>
                <TouchableOpacity
                  onPress={() => router.push("/community")}
                  className="flex-row gap-3 rounded-2xl bg-canvas p-3 active:opacity-80"
                >
                  <View className="flex-1 min-h-[84px]">
                    <View className="flex-row items-center gap-2 mb-2">
                      <Image
                        source={getAvatarSource(featuredCommunityPost.avatar_url, featuredCommunityPost.user_id ?? featuredCommunityPost.username)}
                        className="w-6 h-6 rounded-full"
                        style={{ width: 24, height: 24, borderRadius: 12 }}
                      />
                      <Text className="text-xs font-bold text-ink" numberOfLines={1}>{featuredCommunityPost.username}</Text>
                      <View className="bg-brand/10 px-1.5 py-0.5 rounded-md">
                        <Text className="text-[9px] font-bold text-brand">精选</Text>
                      </View>
                    </View>
                    <Text className="text-xs text-[#5C5248] leading-4" numberOfLines={3}>{featuredCommunityPost.content}</Text>
                    <View className="mt-2 flex-row items-center gap-1">
                      <FontAwesome6 name="heart" size={10} color="#E76F51" />
                      <Text className="text-[10px] font-semibold text-copy-muted">{featuredCommunityPost.likes_count} 赞</Text>
                    </View>
                  </View>
                  {featuredCommunityPost.image_url ? (
                    <Image source={{ uri: featuredCommunityPost.image_url }} className="w-20 rounded-xl" resizeMode="cover" />
                  ) : (
                    <View className="w-20 rounded-xl bg-brand/10 items-center justify-center">
                      <FontAwesome6 name="leaf" size={18} color="#2D6A4F" />
                    </View>
                  )}
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <TouchableOpacity onPress={() => router.push("/community")} className="rounded-2xl bg-canvas p-4 items-center">
                <Text className="text-xs font-bold text-copy-muted">社区正在准备新的健康灵感</Text>
              </TouchableOpacity>
            )}
            {communityPosts.length > 1 && (
              <View className="mt-3 flex-row justify-center gap-1.5">
                {communityPosts.map((post, index) => (
                  <View key={post.id} className={`h-1.5 rounded-full ${activeCommunityPost === index ? "w-4 bg-brand" : "w-1.5 bg-highlight/40"}`} />
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 板块三：灵感食谱 (大卡片统合容器) */}
        <View className="px-5 mb-8">
          <View className="bg-white rounded-[24px] p-5 border border-line shadow-xs">
            <View className="pb-3.5 border-b border-[#F4EFE6] mb-3.5">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-2">
                  <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                    <FontAwesome6 name="utensils" size={13} color="#2D6A4F" />
                  </View>
                  <Text className="text-sm font-bold text-ink">灵感食谱</Text>
                </View>
              </View>

              <View className="flex-row gap-2.5">
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setActiveCategory(cat)}
                    className={`px-3.5 py-1.5 rounded-full border ${
                      activeCategory === cat
                        ? "bg-brand border-brand"
                        : "bg-[#FFFDF9] border-line"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        activeCategory === cat ? "text-white" : "text-copy-muted"
                      }`}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {loading ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="small" color="#2D6A4F" />
              </View>
            ) : filteredRecipes.length === 0 ? (
              <View className="py-8 items-center">
                <FontAwesome6 name="utensils" size={24} color="#D4A276" />
                <Text className="text-xs font-bold text-copy-muted mt-2">暂无符合条件的食谱</Text>
              </View>
            ) : (
              <View className="gap-3">
                {visibleRecipes.map((recipe) => (
                  <TouchableOpacity
                    key={recipe.id}
                    onPress={() =>
                      router.push(`/recipe-detail?id=${recipe.id}`)
                    }
                    className="bg-[#FFFDF9] rounded-2xl overflow-hidden border border-[#F4EBE0] shadow-2xs active:opacity-90"
                  >
                    <View className="relative h-36 w-full">
                      <RecipeCover
                        uri={recipe.image_url}
                        className="w-full h-full"
                        placeholderClassName="h-full w-full items-center justify-center bg-[#EAF2EC]"
                      />
                      <View className="absolute top-2.5 left-2.5 bg-ink/70 backdrop-blur-md px-2.5 py-0.5 rounded-full">
                        <Text className="text-[10px] font-bold text-white">{recipe.category}</Text>
                      </View>
                      {recipe.inventoryMatchNames.length > 0 && (
                        <View className="absolute top-2.5 right-2.5 bg-brand/90 px-2.5 py-0.5 rounded-full flex-row items-center gap-1">
                          <FontAwesome6
                            name={recipe.expiringMatchCount > 0 ? "clock-rotate-left" : "basket-shopping"}
                            size={9}
                            color="#FFF"
                          />
                          <Text className="text-[10px] font-bold text-white">
                            {recipe.expiringMatchCount > 0
                              ? `优先消耗 · 匹配${recipe.inventoryMatchNames.length}种`
                              : `库存匹配 ${recipe.inventoryMatchNames.length}种`}
                          </Text>
                        </View>
                      )}
                      <View className="absolute bottom-2.5 right-2.5 bg-white/90 px-2 py-0.5 rounded-full flex-row items-center gap-1">
                        <FontAwesome6 name="clock" size={10} color="#2D6A4F" />
                        <Text className="text-[10px] font-bold text-brand">{recipe.cook_time}分钟</Text>
                      </View>
                    </View>

                    <View className="p-3">
                      <Text className="text-sm font-bold text-ink" numberOfLines={1}>
                        {recipe.title}
                      </Text>
                      <Text className="text-xs text-copy-muted mt-1" numberOfLines={2}>
                        {recipe.description}
                      </Text>

                      <View className="flex-row items-center justify-between mt-2.5 pt-2.5 border-t border-background-secondary">
                        <View className="flex-row items-center gap-3">
                          <Text className="text-xs font-bold text-brand">
                            <FontAwesome6 name="fire" size={11} color="#2D6A4F" /> {recipe.calories} kcal
                          </Text>
                          <Text className="text-xs text-copy-muted">
                            蛋白 {recipe.protein}g
                          </Text>
                        </View>
                        <View className="bg-brand/10 px-2.5 py-1 rounded-full">
                          <Text className="text-xs font-bold text-brand">开启烹饪 →</Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
                {hasMoreRecipes ? (
                  <View className="items-center py-2">
                    <Text className="text-[11px] font-bold text-copy-muted">
                      继续下滑，加载更多灵感
                    </Text>
                  </View>
                ) : filteredRecipes.length > RECIPE_BATCH_SIZE ? (
                  <View className="items-center py-2">
                    <Text className="text-[11px] text-[#A99A87]">已为你展示全部食谱</Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <TodayRecordsModal
        visible={allRecordsModalVisible}
        records={todayRecords}
        onClose={() => setAllRecordsModalVisible(false)}
        onAddRecord={() => {
          setAllRecordsModalVisible(false);
          router.push("/diet-record");
        }}
      />
    </Screen>
  );
}
