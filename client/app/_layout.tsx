import { Stack } from "expo-router";
import "../global.css";
import { WebOnlyColorSchemeUpdater as ColorSchemeUpdater } from "@/components/ColorSchemeUpdater";
import { Provider } from "@/components/Provider";

export default function RootLayout() {
  return (
    <>
      <ColorSchemeUpdater />
      <Provider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login" />
            <Stack.Screen name="register" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="profile-edit" />
            <Stack.Screen name="recipe-detail" />
            <Stack.Screen name="recipe-submit" />
            <Stack.Screen name="favorites" />
            <Stack.Screen name="following" />
            <Stack.Screen name="user-profile" />
            <Stack.Screen name="diet-record" />
            <Stack.Screen name="health-data" />
            <Stack.Screen name="health-profile" />
            <Stack.Screen name="cooking-mode" />
            <Stack.Screen name="post-detail" />
            <Stack.Screen name="post-create" />
            <Stack.Screen
              name="ai-assistant"
              options={{
                // 使用全屏页面承载食语；仅保留自下而上的转场。
                // `presentation: "modal"` 在 Web 会将页面缩成圆角浮层，露出四角背景。
                animation: "slide_from_bottom",
              }}
            />
            <Stack.Screen name="settings" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="shopping-list" />
            <Stack.Screen name="legal" />
            <Stack.Screen name="about" />
          </Stack>
      </Provider>
    </>
  );
}
