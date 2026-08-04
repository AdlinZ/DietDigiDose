import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image } from "react-native";
import { Screen } from "@/components/Screen";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { foodsApi } from "@/services/api";


export default function SearchScreen() {
  const router = useSafeRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length > 0) {
        performSearch(query.trim());
      } else {
        setResults([]);
        setHasSearched(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [query]);

  const performSearch = async (q: string) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const data = await foodsApi.search<any>(q);
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "bottom"]}>
      {/* Header */}
      <View className="px-5 pt-2 pb-4 flex-row items-center gap-4 border-b border-[#EBE3D5] bg-white">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <FontAwesome6 name="arrow-left" size={20} color="#3D3229" />
        </TouchableOpacity>
        <View className="flex-1 flex-row items-center bg-[#F5EFE6] px-4 py-2.5 rounded-2xl">
          <FontAwesome6 name="magnifying-glass" size={16} color="#8B7D6B" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索食材，例如：鸡蛋、鸡胸肉..."
            autoFocus
            className="flex-1 ml-2 text-sm text-[#3D3229]"
            placeholderTextColor="#9E9085"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <FontAwesome6 name="circle-xmark" size={16} color="#8B7D6B" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Results */}
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
        {loading ? (
          <View className="py-20 items-center">
            <ActivityIndicator size="large" color="#2D6A4F" />
            <Text className="text-[#8B7D6B] mt-4">正在各大权威库中检索...</Text>
          </View>
        ) : hasSearched && results.length === 0 ? (
          <View className="py-20 items-center">
            <View className="w-16 h-16 bg-[#D4A276]/10 rounded-full items-center justify-center mb-4">
              <FontAwesome6 name="lemon" size={28} color="#D4A276" />
            </View>
            <Text className="text-lg font-bold text-[#3D3229]">未找到该食材</Text>
            <Text className="text-sm text-[#8B7D6B] text-center mt-2 mb-8">
              系统及全网库中没有找到完全匹配的食材。您可以尝试其他关键词，或者自己添加它。
            </Text>
            <TouchableOpacity 
              onPress={() => router.push("/custom-food")}
              className="bg-[#2D6A4F] px-6 py-3.5 rounded-2xl flex-row items-center gap-2"
            >
              <FontAwesome6 name="plus" size={14} color="#FFF" />
              <Text className="text-white font-bold text-base">手动添加新食材</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="gap-3">
            {results.map((item, index) => (
              <View key={index} className="bg-white p-4 rounded-[22px] border border-[#EBE3D5] flex-row items-center gap-4">
                <View className="w-12 h-12 rounded-full bg-[#2D6A4F]/10 items-center justify-center">
                  <FontAwesome6 name="leaf" size={20} color="#2D6A4F" />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-base font-bold text-[#3D3229]">{item.name}</Text>
                    <View className="bg-amber-100 px-2 py-0.5 rounded-md">
                      <Text className="text-[10px] text-amber-700 font-bold">
                        {item.source === 'open_api' ? 'USDA库' : '系统精选'}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-sm text-[#2D6A4F] font-black mt-1">
                    {item.calories_100g} kcal <Text className="text-xs font-normal text-[#8B7D6B]">/ 100g</Text>
                  </Text>
                  <View className="flex-row gap-3 mt-1.5">
                    <Text className="text-[11px] text-[#8B7D6B]">碳 {item.carbs_100g}g</Text>
                    <Text className="text-[11px] text-[#8B7D6B]">蛋 {item.protein_100g}g</Text>
                    <Text className="text-[11px] text-[#8B7D6B]">脂 {item.fat_100g}g</Text>
                  </View>
                </View>
              </View>
            ))}
            
            {results.length > 0 && (
              <TouchableOpacity 
                onPress={() => router.push("/custom-food")}
                className="mt-6 border border-dashed border-[#D4A276] p-4 rounded-2xl items-center"
              >
                <Text className="text-[#D4A276] font-medium text-sm">没找到准确的？点击自定义上传</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
