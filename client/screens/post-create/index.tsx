import { useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import * as ImagePicker from "expo-image-picker";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { SmartDateInput } from "@/components/SmartDateInput";
import { communityApi } from "@/services/api";

const CATEGORIES = ["寻味", "榜单", "活动", "问答"];

export default function PostCreateScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<{ category?: string }>();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState(
    CATEGORIES.includes(params.category || "") ? params.category as string : "寻味"
  );
  const [eventStartAt, setEventStartAt] = useState("");
  const [eventEndAt, setEventEndAt] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 9,
      quality: 0.55,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const newImages = result.assets
      .filter((asset) => asset.base64)
      .map((asset) => `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`);
    setImageUrls((current) => [...current, ...newImages].slice(0, 9));
  };

  const publish = async () => {
    if (!title.trim() && !content.trim() && !imageUrls.length) {
      Alert.alert("写点什么吧", "添加文字或图片后即可发布。");
      return;
    }
    if (!isAuthenticated) {
      Alert.alert("登录后发布", "登录后即可把你的美食分享给社区食友。", [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (category === "活动") {
      if (!eventStartAt || !eventEndAt) {
        Alert.alert("补充活动时间", "请填写活动开始和结束日期。");
        return;
      }
      if (new Date(eventEndAt).getTime() < new Date(eventStartAt).getTime()) {
        Alert.alert("日期有误", "活动结束日期不能早于开始日期。");
        return;
      }
    }
    try {
      setPublishing(true);
      await communityApi.createPost(authFetch, {
          content: [title.trim(), content.trim()].filter(Boolean).join("\n"),
          image_urls: imageUrls,
          category,
          event_start_at: category === "活动" ? eventStartAt : null,
          event_end_at: category === "活动" ? eventEndAt : null,
      });
      router.back();
    } catch (error) {
      Alert.alert("发布失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Screen backgroundColor="#FFFFFF" safeAreaEdges={["top", "left", "right", "bottom"]}>
      <View className="flex-1 bg-white">
      <View className="h-14 flex-row items-center justify-between px-4">
        <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full active:bg-[#F8F8F8]">
          <FontAwesome6 name="arrow-left" size={15} color="#3D3229" />
        </TouchableOpacity>
        <Text className="absolute left-0 right-0 text-center text-lg font-black text-[#3D3229]">写动态</Text>
        <TouchableOpacity onPress={publish} disabled={publishing} className="z-10 min-w-16 items-center rounded-full bg-[#2D6A4F] px-4 py-2.5 disabled:opacity-60">
          {publishing ? <ActivityIndicator size="small" color="#FFF" /> : <Text className="text-xs font-black text-white">发布</Text>}
        </TouchableOpacity>
      </View>

      <View className="flex-1 px-5 pt-5">
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="输入标题（可选）"
          placeholderTextColor="#B0A495"
          autoFocus
          className="py-2 text-2xl font-black text-[#3D3229]"
        />
        {category === "活动" ? (
          <View className="mt-3 rounded-2xl border border-[#DDE8DF] bg-[#F3F8F4] p-3">
            <View className="mb-3 flex-row items-center gap-2">
              <FontAwesome6 name="calendar-check" size={13} color="#2D6A4F" />
              <Text className="text-xs font-black text-[#2D6A4F]">设置活动周期</Text>
            </View>
            <View className="flex-row gap-3">
              <SmartDateInput
                label="开始日期"
                value={eventStartAt}
                onChange={setEventStartAt}
                placeholder="选择开始日期"
                containerStyle={{ flex: 1 }}
                inputStyle={{ backgroundColor: "#FFFFFF", borderColor: "#DDE8DF" }}
                labelStyle={{ color: "#6E7E72", fontSize: 11 }}
                iconColor="#2D6A4F"
              />
              <SmartDateInput
                label="结束日期"
                value={eventEndAt}
                onChange={setEventEndAt}
                placeholder="选择结束日期"
                containerStyle={{ flex: 1 }}
                inputStyle={{ backgroundColor: "#FFFFFF", borderColor: "#DDE8DF" }}
                labelStyle={{ color: "#6E7E72", fontSize: 11 }}
                iconColor="#2D6A4F"
              />
            </View>
          </View>
        ) : category === "问答" ? (
          <View className="mt-3 flex-row items-center gap-2 rounded-xl bg-[#FFF7E8] px-3 py-2.5">
            <FontAwesome6 name="circle-question" size={12} color="#A76513" />
            <Text className="flex-1 text-[10px] leading-4 text-[#8B6A36]">发布后，回答数、专业身份和采纳状态会在问答页展示。</Text>
          </View>
        ) : null}
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder="记录你的美食故事、饮食心得或想问的问题…"
          placeholderTextColor="#B0A495"
          multiline
          textAlignVertical="top"
          className="mt-3 flex-1 py-1 text-lg leading-8 text-[#3D3229]"
        />
        {imageUrls.length ? (
          <View className="mb-4">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {imageUrls.map((imageUrl, index) => (
                <View key={`${imageUrl.slice(-24)}-${index}`} className="relative overflow-visible rounded-2xl">
                  <Image source={{ uri: imageUrl }} className="h-24 w-24 rounded-2xl" resizeMode="cover" />
                  <View className="absolute left-1 bottom-1 rounded-full bg-black/55 px-1.5 py-0.5"><Text className="text-[10px] font-bold text-white">{index + 1}</Text></View>
                  <TouchableOpacity onPress={() => setImageUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60">
                    <FontAwesome6 name="xmark" size={11} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <View className="border-t border-[#F0ECE5] bg-white px-5 py-3">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-5">
            <TouchableOpacity onPress={pickImage} disabled={imageUrls.length >= 9} className="h-10 w-10 items-center justify-center rounded-xl active:bg-[#F5EFE6] disabled:opacity-40">
              <FontAwesome6 name="image" size={20} color="#5B5B5B" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCategory((current) => CATEGORIES[(CATEGORIES.indexOf(current) + 1) % CATEGORIES.length])} className="flex-row items-center gap-2 rounded-xl px-2 py-2 active:bg-[#F5EFE6]">
              <FontAwesome6 name="hashtag" size={17} color="#5B5B5B" />
              <Text className="text-sm font-bold text-[#5B5B5B]">{category}</Text>
            </TouchableOpacity>
          </View>
          <Text className="text-xs text-[#9B9185]">{imageUrls.length}/9 · {content.length + title.length} 字</Text>
        </View>
        <Text className="mt-1 text-[10px] text-[#9B9185]">最多 9 张图片 · 点击话题可切换发布板块</Text>
      </View>
      </View>
    </Screen>
  );
}
