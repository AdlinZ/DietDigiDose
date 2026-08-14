import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Pressable, Platform, DeviceEventEmitter, Alert, StyleSheet } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { BlurView } from "expo-blur";
import Animated, { FadeIn, LinearTransition, ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";

import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth } from "@/contexts/AuthContext";
import { createAuthReturnTo } from "@/utils/authReturnTo";

const TAB_LAYOUT_TRANSITION = LinearTransition.duration(220).reduceMotion(ReduceMotion.System);
const QUICK_ACTION_ENTERING = FadeIn.duration(150).reduceMotion(ReduceMotion.System);

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
  const reduceMotion = useReducedMotion();
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

  // 当前一级菜单的情境快捷操作。
  const handleQuickActionPress = () => {
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
  const inventoryQuickAction = {
    inventory: { label: "存食材", accessibilityLabel: "新增食材", icon: "plus" as const },
    recipes: { label: "存食谱", accessibilityLabel: "新增食谱", icon: "book-open" as const },
    kitchenware: { label: "存厨具", accessibilityLabel: "新增厨具", icon: "fire-burner" as const },
  }[inventorySegment];
  const quickAction = currentRouteName === "inventory"
    ? inventoryQuickAction
    : currentRouteName === "community"
      ? { label: "发布", accessibilityLabel: "发布社区动态", icon: "pen" as const }
      : currentRouteName === "profile"
        ? { label: "记餐", accessibilityLabel: "记录一餐", icon: "utensils" as const }
        : { label: "食语", accessibilityLabel: "打开食语 AI 助手", icon: "wand-magic-sparkles" as const };

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
        className="pointer-events-box-none"
      >
        {/* 单一玻璃 Dock：当前菜单与它的情境操作组成双按钮胶囊。 */}
        <View
          className="h-[64px] rounded-full px-2.5 flex-row items-center justify-between"
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
            const animatedContainerStyle = {
              flexBasis: 0,
              flexGrow: isFocused ? 1.55 : 1,
              flexShrink: 1,
              height: 52,
              ...(Platform.OS === "web"
                ? {
                    transitionDuration: reduceMotion ? "0ms" : "220ms",
                    transitionProperty: "flex-grow",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }
                : {}),
            } as any;

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

            if (isFocused) {
              return (
                <Animated.View
                  key={route.key}
                  layout={TAB_LAYOUT_TRANSITION}
                  style={animatedContainerStyle}
                >
                  <Animated.View
                    entering={QUICK_ACTION_ENTERING}
                    className="h-[50px] w-full flex-row items-center rounded-[23px] border border-brand/10 bg-brand/5 px-1"
                  >
                    <Pressable
                      onPress={handleQuickActionPress}
                      accessibilityRole="button"
                      accessibilityLabel={quickAction.accessibilityLabel}
                      accessibilityHint={currentRouteName === "inventory" && !isAuthenticated ? "需要先登录" : undefined}
                      className="h-[50px] flex-1 items-center justify-center"
                    >
                      <View className="h-7 w-7 items-center justify-center">
                        <FontAwesome6
                          name={quickAction.icon}
                          size={16}
                          color={ink}
                          style={{
                            opacity: 0.76,
                            textShadowColor: "rgba(255, 255, 255, 0.92)",
                            textShadowOffset: { width: 0, height: 1 },
                            textShadowRadius: 3,
                          }}
                        />
                      </View>
                      <Text numberOfLines={1} className="mt-1 text-[10.5px] font-bold text-ink" style={{ opacity: 0.8 }}>
                        {quickAction.label}
                      </Text>
                    </Pressable>

                    <TouchableOpacity
                      onPress={onPress}
                      activeOpacity={0.8}
                      accessibilityRole="tab"
                      accessibilityLabel={config.label}
                      accessibilityState={{ selected: true }}
                      className="h-[50px] flex-1 items-center justify-center"
                    >
                      <View className="h-7 w-7 items-center justify-center">
                        <FontAwesome6 name={config.icon as any} size={16} color="#2D6A4F" />
                      </View>
                      <Text numberOfLines={1} className="mt-1 text-[10.5px] font-black text-brand">
                        {config.label}
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>
                </Animated.View>
              );
            }

            return (
              <Animated.View
                key={route.key}
                layout={TAB_LAYOUT_TRANSITION}
                style={animatedContainerStyle}
              >
                <TouchableOpacity
                  onPress={onPress}
                  activeOpacity={0.8}
                  accessibilityRole="tab"
                  accessibilityLabel={config.label}
                  accessibilityState={{ selected: false }}
                  className="h-[52px] w-full items-center justify-center"
                >
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
                    {config.badge ? (
                      <View accessibilityLiveRegion="polite" className="absolute -top-1 -right-1.5 bg-critical px-1 py-0.2 rounded-full min-w-3.5 items-center justify-center border border-white">
                        <Text className="text-[8px] font-black text-white">
                          {config.badge}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} className="mt-1 text-[10.5px] font-bold text-ink" style={{ opacity: 0.8 }}>
                    {config.label}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
      </View>
    </>
  );
}
