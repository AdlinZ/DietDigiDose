import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Pressable, Image, Platform, DeviceEventEmitter, Alert, StyleSheet } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { BlurView } from "expo-blur";
import { useCSSVariable } from "uniwind";

import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth } from "@/contexts/AuthContext";
import { createAuthReturnTo } from "@/utils/authReturnTo";

function GlassBackdrop({ borderRadius }: { borderRadius: number }) {
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          borderRadius,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(255, 255, 255, 0.72)",
        },
      ]}
    >
      <BlurView
        pointerEvents="none"
        tint="systemMaterialLight"
        intensity={62}
        {...(Platform.OS === "android"
          ? { experimentalBlurMethod: "dimezisBlurView" as const }
          : {})}
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: "rgba(255, 255, 255, 0.12)" },
        ]}
      />
    </View>
  );
}

export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const [ink] = useCSSVariable(["--color-ink"]) as string[];

  // 获取当前激活的路由
  const currentRouteName = state.routes[state.index]?.name || "index";
  const [inventorySegment, setInventorySegment] = useState<"inventory" | "recipes" | "kitchenware">("recipes");

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "inventory-segment-change",
      (segment: "inventory" | "recipes" | "kitchenware") => setInventorySegment(segment),
    );
    return () => subscription.remove();
  }, []);

  // 左侧动态按键点击响应
  const handleLeftButtonPress = () => {
    if (currentRouteName === "inventory" && !isAuthenticated) {
      const actionLabel = inventorySegment === "recipes" ? "食谱" : inventorySegment === "kitchenware" ? "厨具" : "食材";
      const returnTo = inventorySegment === "recipes"
        ? createAuthReturnTo("/recipe-submit")
        : createAuthReturnTo("/inventory", inventorySegment === "inventory" ? { action: "add" } : {});
      Alert.alert(`登录后保存${actionLabel}`, `登录后才能保存和管理你的${actionLabel}。`, [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login", returnTo ? { returnTo } : {}) },
      ]);
      return;
    }
    switch (currentRouteName) {
      case "index":
        // 与首页卡片、库存等入口统一使用完整的食语页面，避免两套对话体验分叉。
        router.push("/ai-assistant");
        break;
      case "inventory":
        if (inventorySegment === "recipes") {
          router.push("/recipe-submit");
        } else if (inventorySegment === "kitchenware") {
          DeviceEventEmitter.emit("open-add-kitchenware");
        } else {
          DeviceEventEmitter.emit("open-add-food");
        }
        break;
      case "community":
        DeviceEventEmitter.emit("open-community-post");
        break;
      case "profile":
        DeviceEventEmitter.emit("open-quick-record");
        break;
      default:
        router.push("/ai-assistant");
        break;
    }
  };

  // Filter routes to exclude hidden ones (like health-overview)
  const visibleRoutes = state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    return (options as any).href !== null;
  });

  const getTabConfig = (routeName: string) => {
    switch (routeName) {
      case "index":
        return { label: "首页", icon: "house", badge: null };
      case "inventory":
        return { label: "膳食资产", icon: "boxes-stacked", badge: null };
      case "community":
        return { label: "社区", icon: "compass", badge: null };
      case "profile":
        return { label: "我的", icon: "user", badge: null };
      default:
        return { label: routeName, icon: "circle", badge: null };
    }
  };

  const bottomMargin = Platform.OS === 'web' ? 14 : Math.max(insets.bottom + 6, 12);
  const quickActionLabel = {
    index: "打开食语 AI 助手",
    inventory: "新增食材",
    community: "发布社区动态",
    profile: "记录一餐",
  }[currentRouteName] || "打开食语 AI 助手";
  const inventoryQuickAction = {
    inventory: { label: "存食材", accessibilityLabel: "新增食材", icon: "plus" as const },
    recipes: { label: "存食谱", accessibilityLabel: "新增食谱", icon: "book-open" as const },
    kitchenware: { label: "存厨具", accessibilityLabel: "新增厨具", icon: "fire-burner" as const },
  }[inventorySegment];

  return (
    <>
      <View
        style={{
          position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
          bottom: bottomMargin,
          left: 0,
          right: 0,
          zIndex: 99,
          paddingHorizontal: 16,
        }}
        className="flex-row items-center justify-between pointer-events-box-none"
      >
        {/* 左侧动态多功能浮动按钮 (首页: AI助手 | 膳食资产: 存食材 | 社区: 发动态 | 我的: 记一餐) */}
        <Pressable
          onPress={handleLeftButtonPress}
          accessibilityRole="button"
          accessibilityLabel={currentRouteName === "inventory" ? inventoryQuickAction.accessibilityLabel : quickActionLabel}
          accessibilityHint={currentRouteName === "inventory" && !isAuthenticated ? "需要先登录" : undefined}
          className="w-[60px] h-[60px] rounded-full items-center justify-center relative active:scale-95"
          style={{
            shadowColor: ink,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.14,
            shadowRadius: 12,
            elevation: 7,
          }}
        >
          <GlassBackdrop borderRadius={30} />

          {currentRouteName === "index" && (
            <View className="items-center justify-center relative" style={{ width: 56, height: 56 }}>
              <Image
                source={require("@/assets/logo.png")}
                style={{ width: 56, height: 56 }}
                resizeMode="contain"
              />
              <View className="absolute bottom-0 bg-[#104020] px-1.5 py-0.5 rounded-full border border-white">
                <Text className="text-[8.5px] font-black text-white">食语 AI</Text>
              </View>
            </View>
          )}

          {currentRouteName === "inventory" && (
            <View className="w-[50px] h-[50px] rounded-full bg-brand items-center justify-center relative shadow-xs">
              <FontAwesome6 name={inventoryQuickAction.icon} size={16} color="#FFF" />
              <View className="absolute -bottom-1 bg-highlight px-1.5 py-0.2 rounded-full border border-white">
                <Text className="text-[8px] font-black text-ink">{inventoryQuickAction.label}</Text>
              </View>
            </View>
          )}

          {currentRouteName === "community" && (
            <View className="w-[50px] h-[50px] rounded-full bg-highlight items-center justify-center relative shadow-xs">
              <FontAwesome6 name="pen-to-square" size={17} color={ink} />
              <View className="absolute -bottom-1 bg-brand px-1.5 py-0.2 rounded-full border border-white">
                <Text className="text-[8px] font-black text-white">发动态</Text>
              </View>
            </View>
          )}

          {currentRouteName === "profile" && (
            <View className="w-[50px] h-[50px] rounded-full bg-critical items-center justify-center relative shadow-xs">
              <FontAwesome6 name="fire-flame-curved" size={17} color="#FFF" />
              <View className="absolute -bottom-1 bg-ink px-1.5 py-0.2 rounded-full border border-white">
                <Text className="text-[8px] font-black text-white">记一餐</Text>
              </View>
            </View>
          )}
        </Pressable>

        {/* 右侧主导航栏：半透明磨砂玻璃 Dock，页面内容可隐约透出。 */}
        <View
          className="flex-1 h-[60px] ml-3 rounded-full px-2.5 flex-row items-center justify-between"
          style={{
            shadowColor: ink,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.14,
            shadowRadius: 12,
            elevation: 7,
          }}
        >
          <GlassBackdrop borderRadius={30} />

          {visibleRoutes.map((route) => {
            const isFocused = state.routes[state.index].key === route.key;
            const config = getTabConfig(route.name);

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <TouchableOpacity
                key={route.key}
                onPress={onPress}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityLabel={config.label}
                accessibilityState={{ selected: isFocused }}
                className="flex-1 items-center justify-center relative py-1"
              >
                {/* 选中高亮 Pill 胶囊背景 */}
                {isFocused ? (
                  <View className="items-center justify-center">
                    <View className="w-8 h-8 rounded-full bg-brand items-center justify-center shadow-xs">
                      <FontAwesome6 name={config.icon as any} size={15} color="#FFF" />
                    </View>
                    <Text className="text-[10.5px] font-black text-brand mt-1">
                      {config.label}
                    </Text>
                  </View>
                ) : (
                  <View className="items-center justify-center">
                    <View className="w-7 h-7 items-center justify-center relative">
                      <FontAwesome6
                        name={config.icon as any}
                        size={16}
                        color={ink}
                        style={{
                          opacity: 0.76,
                          textShadowColor: "rgba(255, 255, 255, 0.92)",
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 3,
                        }}
                      />
                      {/* 未读数字/圆点 Badge (如社区消息) */}
                      {config.badge ? (
                        <View accessibilityLiveRegion="polite" className="absolute -top-1 -right-1.5 bg-critical px-1 py-0.2 rounded-full min-w-3.5 items-center justify-center border border-white">
                          <Text className="text-[8px] font-black text-white">
                            {config.badge}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="text-[10.5px] font-bold text-ink mt-1" style={{ opacity: 0.8 }}>
                      {config.label}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </>
  );
}
