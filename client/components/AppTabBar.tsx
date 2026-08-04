import { View, Text, TouchableOpacity, Pressable, Image, Platform, DeviceEventEmitter, Alert } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";

import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth } from "@/contexts/AuthContext";

export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();

  // 获取当前激活的路由
  const currentRouteName = state.routes[state.index]?.name || "index";
  const isHomeRoute = currentRouteName === "index";

  // 左侧动态按键点击响应
  const handleLeftButtonPress = () => {
    if (currentRouteName === "inventory" && !isAuthenticated) {
      Alert.alert("登录后录入食材", "登录后才能保存和管理你的食材。", [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login") },
      ]);
      return;
    }
    switch (currentRouteName) {
      case "index":
        // 与首页卡片、库存等入口统一使用完整的食语页面，避免两套对话体验分叉。
        router.push("/ai-assistant");
        break;
      case "inventory":
        DeviceEventEmitter.emit("open-add-food");
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
          className={`w-[60px] h-[60px] items-center justify-center relative active:scale-95 ${isHomeRoute ? "" : "bg-white/95 rounded-full p-1 border border-[#EBE3D5]"}`}
          style={{
            backgroundColor: isHomeRoute ? "transparent" : "rgba(255, 255, 255, 0.95)",
            borderWidth: isHomeRoute ? 0 : 1,
            padding: isHomeRoute ? 0 : 4,
            shadowColor: "#3D3229",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.1,
            shadowRadius: 0,
            elevation: 0,
          }}
        >
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
            <View className="w-[50px] h-[50px] rounded-full bg-[#2D6A4F] items-center justify-center relative shadow-xs">
              <FontAwesome6 name="plus" size={18} color="#FFF" />
              <View className="absolute -bottom-1 bg-[#E9C46A] px-1.5 py-0.2 rounded-full border border-white">
                <Text className="text-[8px] font-black text-[#3D3229]">存食材</Text>
              </View>
            </View>
          )}

          {currentRouteName === "community" && (
            <View className="w-[50px] h-[50px] rounded-full bg-[#E9C46A] items-center justify-center relative shadow-xs">
              <FontAwesome6 name="pen-to-square" size={17} color="#3D3229" />
              <View className="absolute -bottom-1 bg-[#2D6A4F] px-1.5 py-0.2 rounded-full border border-white">
                <Text className="text-[8px] font-black text-white">发动态</Text>
              </View>
            </View>
          )}

          {currentRouteName === "profile" && (
            <View className="w-[50px] h-[50px] rounded-full bg-[#E76F51] items-center justify-center relative shadow-xs">
              <FontAwesome6 name="fire-flame-curved" size={17} color="#FFF" />
              <View className="absolute -bottom-1 bg-[#3D3229] px-1.5 py-0.2 rounded-full border border-white">
                <Text className="text-[8px] font-black text-white">记一餐</Text>
              </View>
            </View>
          )}
        </Pressable>

        {/* 右侧主导航栏：较大的触控区与左侧快捷键保持同一视觉量级。 */}
        <View
          className="flex-1 h-[60px] ml-3 bg-white/95 backdrop-blur-md rounded-full px-2.5 flex-row items-center justify-between border border-[#EBE3D5] shadow-md"
          style={{
            shadowColor: "#3D3229",
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.1,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
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
                className="flex-1 items-center justify-center relative py-1"
              >
                {/* 选中高亮 Pill 胶囊背景 */}
                {isFocused ? (
                  <View className="items-center justify-center">
                    <View className="w-8 h-8 rounded-full bg-[#2D6A4F] items-center justify-center shadow-xs">
                      <FontAwesome6 name={config.icon as any} size={15} color="#FFF" />
                    </View>
                    <Text className="text-[10.5px] font-black text-[#2D6A4F] mt-1">
                      {config.label}
                    </Text>
                  </View>
                ) : (
                  <View className="items-center justify-center">
                    <View className="w-7 h-7 items-center justify-center relative">
                      <FontAwesome6 name={config.icon as any} size={16} color="#8B7D6B" />
                      {/* 未读数字/圆点 Badge (如社区消息) */}
                      {config.badge ? (
                        <View className="absolute -top-1 -right-1.5 bg-[#E76F51] px-1 py-0.2 rounded-full min-w-3.5 items-center justify-center border border-white">
                          <Text className="text-[8px] font-black text-white">
                            {config.badge}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="text-[10.5px] font-bold text-[#8B7D6B] mt-1">
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
