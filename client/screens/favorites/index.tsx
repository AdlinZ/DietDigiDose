import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { FontAwesome6 } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { RecipeCover } from "@/components/RecipeCover";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || "http://localhost:9091";

type FavoriteRecipe = {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  cook_time: number;
  calories: number;
  difficulty: string;
  category: string;
};

export default function FavoritesScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [recipes, setRecipes] = useState<FavoriteRecipe[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFavorites = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = await authFetch(`${API_BASE}/api/v1/recipes/favorites`);
      const data = await response.json();
      setRecipes(response.ok && Array.isArray(data) ? data : []);
    } catch {
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, isAuthenticated]);

  useFocusEffect(useCallback(() => { void fetchFavorites(); }, [fetchFavorites]));

  const removeFavorite = async (recipeId: number) => {
    const previous = recipes;
    setRecipes((current) => current.filter((recipe) => recipe.id !== recipeId));
    try {
      const response = await authFetch(`${API_BASE}/api/v1/recipes/${recipeId}/favorite`, { method: "DELETE" });
      if (!response.ok) setRecipes(previous);
    } catch {
      setRecipes(previous);
    }
  };

  return (
    <Screen backgroundColor="#F6F1E8">
      <View className="flex-row items-center border-b border-[#E8DFD2] bg-[#FFFDF9] px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full bg-[#F2ECE3]">
          <FontAwesome6 name="chevron-left" size={14} color="#304238" />
        </TouchableOpacity>
        <View className="ml-3 flex-1">
          <Text className="text-lg font-black text-[#273A2E]">我的收藏菜谱</Text>
          <Text className="mt-0.5 text-[11px] text-[#8B7D6B]">保存灵感，想做的时候随时回来</Text>
        </View>
        {recipes.length > 0 ? (
          <View className="rounded-full bg-[#E7F1E9] px-3 py-1.5">
            <Text className="text-xs font-black text-[#2D6A4F]">{recipes.length} 道</Text>
          </View>
        ) : null}
      </View>

      {!isAuthenticated ? (
        <View className="flex-1 items-center justify-center px-8">
          <FontAwesome6 name="bookmark" size={30} color="#D49A2A" />
          <Text className="mt-4 text-base font-black text-[#3D3229]">登录后使用收藏</Text>
          <TouchableOpacity onPress={() => router.push("/login")} className="mt-5 rounded-2xl bg-[#2D6A4F] px-7 py-3">
            <Text className="font-bold text-white">前往登录</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#2D6A4F" />
        </View>
      ) : recipes.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="h-16 w-16 items-center justify-center rounded-[24px] bg-[#F4EACF]">
            <FontAwesome6 name="bookmark" size={25} color="#C28B24" />
          </View>
          <Text className="mt-5 text-lg font-black text-[#3D3229]">还没有收藏菜谱</Text>
          <Text className="mt-2 text-center text-sm leading-6 text-[#8B7D6B]">在菜谱详情页点击右上角书签，就会保存在这里。</Text>
          <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-2xl bg-[#2D6A4F] px-6 py-3">
            <Text className="font-bold text-white">去发现菜谱</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View className="w-full max-w-[760px] self-center gap-4">
            {recipes.map((recipe) => (
              <TouchableOpacity
                key={recipe.id}
                onPress={() => router.push("/recipe-detail", { id: recipe.id })}
                className="overflow-hidden rounded-[24px] border border-[#E8DFD2] bg-[#FFFDF9] active:opacity-90"
              >
                <View className="h-40 w-full">
                  <RecipeCover
                    uri={recipe.image_url}
                    className="h-full w-full"
                    placeholderClassName="h-full w-full items-center justify-center bg-[#E7F1E9]"
                  />
                  <TouchableOpacity
                    onPress={(event) => { event.stopPropagation(); void removeFavorite(recipe.id); }}
                    accessibilityLabel={`取消收藏${recipe.title}`}
                    className="absolute right-3 top-3 h-10 w-10 items-center justify-center rounded-full bg-white/90"
                  >
                    <FontAwesome6 name="bookmark" size={16} color="#D49A2A" solid />
                  </TouchableOpacity>
                  <View className="absolute bottom-3 left-3 rounded-full bg-[#245239]/90 px-3 py-1">
                    <Text className="text-[10px] font-bold text-white">{recipe.category}</Text>
                  </View>
                </View>
                <View className="p-4">
                  <Text className="text-lg font-black text-[#263A2E]">{recipe.title}</Text>
                  <Text className="mt-1.5 text-xs leading-5 text-[#7A7065]" numberOfLines={2}>{recipe.description}</Text>
                  <View className="mt-3 flex-row gap-4">
                    <Text className="text-xs font-bold text-[#647367]">{recipe.cook_time} 分钟</Text>
                    <Text className="text-xs font-bold text-[#C26A4C]">{recipe.calories} kcal</Text>
                    <Text className="text-xs font-bold text-[#9A7624]">{recipe.difficulty}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
