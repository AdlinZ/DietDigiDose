import type { ComponentType } from "react";
import { useEffect } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { FontAwesome6 } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/contexts/AuthContext";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2D6A4F" />
          <Text accessibilityLiveRegion="polite" className="mt-3 text-sm text-copy-muted">正在确认登录状态…</Text>
        </View>
      </Screen>
    );
  }

  if (!isAuthenticated) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8">
          <FontAwesome6 name="lock" size={28} color="#2D6A4F" />
          <Text accessibilityRole="header" className="mt-4 text-base font-black text-ink">此页面需要登录</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="去登录"
            className="mt-5 min-h-11 justify-center rounded-2xl bg-brand px-7 py-3"
            onPress={() => router.replace("/login")}
          >
            <Text className="font-bold text-white">去登录</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return children;
}

export function withAuthGuard<Props extends object>(Component: ComponentType<Props>) {
  function ProtectedRoute(props: Props) {
    return (
      <RequireAuth>
        <Component {...props} />
      </RequireAuth>
    );
  }

  ProtectedRoute.displayName = `withAuthGuard(${Component.displayName || Component.name || "Screen"})`;
  return ProtectedRoute;
}
