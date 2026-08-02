import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { Screen } from "@/components/Screen";
import { FontAwesome6 } from "@expo/vector-icons";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuthFetch } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || "http://localhost:9091";

export default function CustomFoodScreen() {
  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert("提示", "请输入食材名称");
      return;
    }
    if (!calories.trim()) {
      Alert.alert("提示", "请输入每100g的热量");
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/api/v1/foods/custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          calories_100g: Number(calories),
          protein_100g: protein ? Number(protein) : 0,
          carbs_100g: carbs ? Number(carbs) : 0,
          fat_100g: fat ? Number(fat) : 0,
        }),
      });

      if (res.ok) {
        Alert.alert("提交成功", "感谢您的贡献！数据已提交，等待管理员审核后全网共享～", [
          { text: "好的", onPress: () => router.back() }
        ]);
      } else {
        const err = await res.json();
        Alert.alert("提交失败", err.error || "发生了未知错误");
      }
    } catch (error) {
      Alert.alert("网络错误", "请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "bottom"]}>
      <View className="px-5 pt-2 pb-4 flex-row items-center justify-between border-b border-[#EBE3D5] bg-white">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <FontAwesome6 name="arrow-left" size={20} color="#3D3229" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-[#3D3229]">添加新食材</Text>
        <View className="w-9" />
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
          <View className="bg-white p-6 rounded-3xl border border-[#EBE3D5] shadow-sm">
            <View className="w-16 h-16 bg-[#2D6A4F]/10 rounded-full items-center justify-center mb-6 self-center">
              <FontAwesome6 name="camera" size={24} color="#2D6A4F" />
            </View>

            <View className="space-y-4">
              <View>
                <Text className="text-sm font-bold text-[#3D3229] mb-2">食材名称 <Text className="text-red-500">*</Text></Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="例如：脱脂牛奶、全麦面包"
                  className="bg-[#F5EFE6] px-4 py-3.5 rounded-2xl text-sm text-[#3D3229]"
                />
              </View>

              <View>
                <Text className="text-sm font-bold text-[#3D3229] mb-2">卡路里 (kcal/100g) <Text className="text-red-500">*</Text></Text>
                <TextInput
                  value={calories}
                  onChangeText={setCalories}
                  placeholder="例如：120"
                  keyboardType="numeric"
                  className="bg-[#F5EFE6] px-4 py-3.5 rounded-2xl text-sm text-[#3D3229]"
                />
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-bold text-[#3D3229] mb-2">碳水 (g)</Text>
                  <TextInput
                    value={carbs}
                    onChangeText={setCarbs}
                    placeholder="选填"
                    keyboardType="numeric"
                    className="bg-[#F5EFE6] px-4 py-3.5 rounded-2xl text-sm text-[#3D3229]"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-[#3D3229] mb-2">蛋白质 (g)</Text>
                  <TextInput
                    value={protein}
                    onChangeText={setProtein}
                    placeholder="选填"
                    keyboardType="numeric"
                    className="bg-[#F5EFE6] px-4 py-3.5 rounded-2xl text-sm text-[#3D3229]"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-[#3D3229] mb-2">脂肪 (g)</Text>
                  <TextInput
                    value={fat}
                    onChangeText={setFat}
                    placeholder="选填"
                    keyboardType="numeric"
                    className="bg-[#F5EFE6] px-4 py-3.5 rounded-2xl text-sm text-[#3D3229]"
                  />
                </View>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading}
              className={`mt-8 py-4 rounded-2xl items-center ${loading ? 'bg-[#2D6A4F]/50' : 'bg-[#2D6A4F] active:bg-[#2D6A4F]/90'}`}
            >
              <Text className="text-white font-bold text-base">
                {loading ? '提交中...' : '提交审核'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
