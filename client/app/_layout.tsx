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
            <Stack.Screen name="diet-record" />
            <Stack.Screen name="health-data" />
            <Stack.Screen name="cooking-mode" />
            <Stack.Screen name="post-detail" />
            <Stack.Screen name="post-create" />
            <Stack.Screen name="ai-assistant" />
            <Stack.Screen name="settings" />
          </Stack>
      </Provider>
    </>
  );
}
