import { Tabs } from 'expo-router';
import { AppTabBar } from '@/components/AppTabBar';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { paddingBottom: Platform.OS === 'web' ? 88 : 82 + insets.bottom },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: '膳食资产',
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: '社区',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
        }}
      />
    </Tabs>
  );
}
