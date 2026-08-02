import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  DeviceEventEmitter,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useFocusEffect } from "expo-router";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { FontAwesome6 } from "@expo/vector-icons";
import { getAvatarSource } from "@/utils/defaultAvatar";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || "http://localhost:9091";

interface Post {
  id: number;
  user_id: number;
  username: string;
  nickname: string;
  avatar_url: string;
  category?: string;
  content: string;
  image_url: string | null;
  image_urls?: string[];
  likes_count: number;
  comment_count?: number;
  views_count?: number;
  is_liked?: boolean;
  event_start_at?: string | null;
  event_end_at?: string | null;
  participant_count?: number;
  is_joined?: boolean;
  question_status?: "open" | "resolved" | null;
  accepted_comment_id?: number | null;
  author_is_expert?: boolean;
  recommendation_reason?: string;
  recommendation_score?: number;
  created_at: string;
}

type ActivityStatus = "ongoing" | "upcoming" | "ended";

const parseCommunityDate = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
};

const getActivityStatus = (post: Post, now = Date.now()): ActivityStatus => {
  const startTime = parseCommunityDate(post.event_start_at)?.getTime();
  const endTime = parseCommunityDate(post.event_end_at)?.getTime();
  if (startTime && startTime > now) return "upcoming";
  if (endTime && endTime < now) return "ended";
  return "ongoing";
};

const formatActivityDate = (value?: string | null) => {
  const date = parseCommunityDate(value);
  if (!date) return "长期开放";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

// 1:1 精致 Mock 数据集 (涵盖 寻味, 榜单, 活动, 问答 4 大板块)
/* Legacy visual seed data retained only for migration reference; the UI now reads API data exclusively.
const DEFAULT_MOCK_POSTS: Post[] = [
  // === 寻味 (Recipes & Gourmet Food) ===
  {
    id: 101,
    user_id: 1,
    username: "demo",
    nickname: "绿色食物分享家",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "绿色食物推荐：用新鲜黄瓜、胡萝卜、西兰花与红甘蓝搭配特级橄榄油，解锁满满膳食纤维与活力能量！",
    image_url: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80",
    likes_count: 1000,
    is_liked: false,
    created_at: "10分钟前",
  },
  {
    id: 102,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "健康早餐场景：全麦吐司配切片牛油果，太阳蛋搭配新鲜切块番茄，开启仪式感拉满的一天。",
    image_url: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop&q=80",
    likes_count: 10000,
    is_liked: true,
    created_at: "25分钟前",
  },
  {
    id: 103,
    user_id: 3,
    username: "family_kitchen",
    nickname: "元气烘焙日记",
    avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "厨房食材储存系统：用分装玻璃罐将五谷杂粮与干货分类归纳，保持厨房整洁与食材新鲜。防潮防尘，一目了然！",
    image_url: "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop&q=80",
    likes_count: 5300,
    is_liked: false,
    created_at: "1小时前",
  },
  {
    id: 105,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "三文鱼藜麦极简减脂餐：高温煎香鱼皮，油脂自然渗入藜麦，简单黑胡椒调味就足够惊艳！",
    image_url: "https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800&auto=format&fit=crop&q=80",
    likes_count: 3200,
    is_liked: false,
    created_at: "3小时前",
  },

  // === 榜单 (Rankings & Hot Charts) ===
  {
    id: 104,
    user_id: 1,
    username: "demo",
    nickname: "绿色食物分享家",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "2026年度社区【低卡减脂餐热度榜 TOP 1】：羽衣甘蓝鸡胸肉低脂沙拉，点赞突破 1.2w！",
    image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80",
    likes_count: 12800,
    is_liked: true,
    created_at: "2小时前",
  },
  {
    id: 201,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "优质高蛋白食材星级榜：三文鱼、虾仁、牛腱子肉、无糖希腊酸奶对比图鉴与烹饪建议。",
    image_url: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&auto=format&fit=crop&q=80",
    likes_count: 9500,
    is_liked: false,
    created_at: "4小时前",
  },
  {
    id: 202,
    user_id: 3,
    username: "family_kitchen",
    nickname: "元气烘焙日记",
    avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "社区热议厨房神器红榜：分装密封玻璃罐推荐，干货防潮整理，收纳美学极致体验！",
    image_url: "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop&q=80",
    likes_count: 7400,
    is_liked: false,
    created_at: "7小时前",
  },
  {
    id: 203,
    user_id: 4,
    username: "nutritionist_lisa",
    nickname: "注册营养师Lisa",
    avatar_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "本周食友评选【最受好评减脂早餐吃法】，全麦牛油果水煮蛋吐司高票夺冠！",
    image_url: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop&q=80",
    likes_count: 8800,
    is_liked: true,
    created_at: "9小时前",
  },

  // === 活动 (Events & Community Challenges) ===
  {
    id: 106,
    user_id: 3,
    username: "family_kitchen",
    nickname: "元气烘焙日记",
    avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "#7天减脂餐打卡挑战# 第21天：精准搭配蛋白质、碳水与微量元素，今天体脂率又下降了0.3%！",
    image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80",
    likes_count: 8600,
    is_liked: true,
    created_at: "5小时前",
  },
  {
    id: 301,
    user_id: 1,
    username: "demo",
    nickname: "绿色食物分享家",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "#周末低卡烘焙大赛# 正式开启！分享你的低糖无面粉烘焙食谱，赢取精美厨具礼盒！",
    image_url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80",
    likes_count: 6700,
    is_liked: false,
    created_at: "6小时前",
  },
  {
    id: 302,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "#无糖饮食7天挑战赛# 超过 3,200 位食友在线参与，一起来戒糖换发神采！",
    image_url: "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=80",
    likes_count: 5200,
    is_liked: false,
    created_at: "10小时前",
  },
  {
    id: 303,
    user_id: 4,
    username: "nutritionist_lisa",
    nickname: "注册营养师Lisa",
    avatar_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "#晒晒你的减脂餐桌# 摄影打卡活动热辣进行中，发布照片即送社区专属勋章与营养评估指导！",
    image_url: "https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format&fit=crop&q=80",
    likes_count: 4100,
    is_liked: true,
    created_at: "12小时前",
  },

  // === 问答 (Q&A & Nutrition Knowledge) ===
  {
    id: 107,
    user_id: 4,
    username: "nutritionist_lisa",
    nickname: "注册营养师Lisa",
    avatar_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "【营养科普】为什么减脂期推荐优先选择希腊酸奶而非普通风味酸奶？看这三点蛋白质与糖分对比就明白了！",
    image_url: "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&auto=format&fit=crop&q=80",
    likes_count: 6400,
    is_liked: false,
    created_at: "6小时前",
  },
  {
    id: 401,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "【食友提问】减脂期晚上饿了吃什么不会胖？营养师为你推荐3款低热量加餐食物！",
    image_url: "https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=800&auto=format&fit=crop&q=80",
    likes_count: 4900,
    is_liked: false,
    created_at: "8小时前",
  },
  {
    id: 402,
    user_id: 1,
    username: "demo",
    nickname: "绿色食物分享家",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "【食材大解密】牛油果虽然健康但油脂高，一天吃半个还是一整颗合适？权威解读来了！",
    image_url: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&auto=format&fit=crop&q=80",
    likes_count: 5800,
    is_liked: true,
    created_at: "11小时前",
  },
  {
    id: 403,
    user_id: 3,
    username: "family_kitchen",
    nickname: "元气烘焙日记",
    avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "【烹饪小贴士】橄榄油、椰子油和黄油，不同烹饪温度下该怎么挑选？避坑实用指南。",
    image_url: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=800&auto=format&fit=crop&q=80",
    likes_count: 3600,
    is_liked: false,
    created_at: "14小时前",
  },

  // === 扩充 - 寻味 (Recipes & Gourmet Food) ===
  {
    id: 109,
    user_id: 3,
    username: "family_kitchen",
    nickname: "元气烘焙日记",
    avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "蓝莓奇亚籽高蛋白奶昔杯：冷藏后呈现啫喱般丝滑口感，抗氧化因子爆棚，夏日解暑神仙加餐！",
    image_url: "https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=800&auto=format&fit=crop&q=80",
    likes_count: 4800,
    is_liked: true,
    created_at: "15分钟前",
  },
  {
    id: 110,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "烤虾仁菠菜藜麦能量碗：高蛋白、低碳水，色泽鲜亮诱人，夏天吃清爽无负担。",
    image_url: "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?w=800&auto=format&fit=crop&q=80",
    likes_count: 6200,
    is_liked: false,
    created_at: "40分钟前",
  },
  {
    id: 111,
    user_id: 5,
    username: "fitness_jack",
    nickname: "健身达人Jack",
    avatar_url: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "慢炖香草番茄鸡胸肉：摒弃柴柴的口感，锁住肉汁，配一小碗黑米饭堪称神仙组合！",
    image_url: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=800&auto=format&fit=crop&q=80",
    likes_count: 3900,
    is_liked: true,
    created_at: "1.5小时前",
  },
  {
    id: 112,
    user_id: 1,
    username: "demo",
    nickname: "绿色食物分享家",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
    category: "寻味",
    content: "抹茶羽衣甘蓝低卡拿铁：用燕麦奶代替全脂奶，加入少许代糖，下午茶的健康新选择。",
    image_url: "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=800&auto=format&fit=crop&q=80",
    likes_count: 7100,
    is_liked: false,
    created_at: "2.5小时前",
  },

  // === 扩充 - 榜单 (Rankings & Hot Charts) ===
  {
    id: 204,
    user_id: 6,
    username: "diet_helper",
    nickname: "减脂小助手",
    avatar_url: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "🏆 2026年【办公室打工人冷餐便当红榜】：方便携带、不易变质的 5 款低卡餐推荐。",
    image_url: "https://images.unsplash.com/photo-1547592180-85f173990554?w=800&auto=format&fit=crop&q=80",
    likes_count: 11200,
    is_liked: false,
    created_at: "3.5小时前",
  },
  {
    id: 205,
    user_id: 4,
    username: "nutritionist_lisa",
    nickname: "注册营养师Lisa",
    avatar_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "🥑 全球最适合减脂期使用的【优质植物油脂星级榜】：特级初榨橄榄油、亚麻籽油、牛油果油评测。",
    image_url: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&auto=format&fit=crop&q=80",
    likes_count: 8900,
    is_liked: true,
    created_at: "5小时前",
  },
  {
    id: 206,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "🥇 社区选出【低碳水替代主食排行榜】：魔芋面、花菜米、西葫芦丝、黑米藜麦饭排名公开！",
    image_url: "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&auto=format&fit=crop&q=80",
    likes_count: 10400,
    is_liked: false,
    created_at: "6.5小时前",
  },
  {
    id: 207,
    user_id: 1,
    username: "demo",
    nickname: "绿色食物分享家",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
    category: "榜单",
    content: "📊 减脂期最受追捧的 4 款【无糖低卡小零食】：冻干无花果、高蛋白黑巧、无盐坚果组合。",
    image_url: "https://images.unsplash.com/photo-1608219992759-8d74ed8d76eb?w=800&auto=format&fit=crop&q=80",
    likes_count: 6700,
    is_liked: true,
    created_at: "8.5小时前",
  },

  // === 扩充 - 活动 (Events & Community Challenges) ===
  {
    id: 304,
    user_id: 4,
    username: "nutritionist_lisa",
    nickname: "注册营养师Lisa",
    avatar_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "💧 #21天每天喝水2000ml打卡# 挑战第三周！皮肤变透亮，基础代谢显著提升！",
    image_url: "https://images.unsplash.com/photo-1548839140-29a749e1cf4e?w=800&auto=format&fit=crop&q=80",
    likes_count: 7800,
    is_liked: false,
    created_at: "9.5小时前",
  },
  {
    id: 305,
    user_id: 6,
    username: "diet_helper",
    nickname: "减脂小助手",
    avatar_url: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "🍱 #自带减脂便当去上班# 话题大奖赛！连续打卡 5 天即可抽取无油空气炸锅！",
    image_url: "https://images.unsplash.com/photo-1511690656952-34342bb7c2f2?w=800&auto=format&fit=crop&q=80",
    likes_count: 9100,
    is_liked: true,
    created_at: "11小时前",
  },
  {
    id: 306,
    user_id: 5,
    username: "fitness_jack",
    nickname: "健身达人Jack",
    avatar_url: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "🧘‍♀️ #早起空腹拉伸+低糖早餐计划# 已有 5,600 人加入，每天 10 分钟告别水肿！",
    image_url: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&auto=format&fit=crop&q=80",
    likes_count: 8300,
    is_liked: false,
    created_at: "13小时前",
  },
  {
    id: 307,
    user_id: 3,
    username: "family_kitchen",
    nickname: "元气烘焙日记",
    avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
    category: "活动",
    content: "🥗 #低卡沙拉酱盲测大赛# 你最爱哪款酱汁？快来分享你的低脂油醋汁私房调配比例！",
    image_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&auto=format&fit=crop&q=80",
    likes_count: 5900,
    is_liked: false,
    created_at: "15小时前",
  },

  // === 扩充 - 问答 (Q&A & Nutrition Knowledge) ===
  {
    id: 404,
    user_id: 4,
    username: "nutritionist_lisa",
    nickname: "注册营养师Lisa",
    avatar_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "❓ 【营养问答】为什么吃同样热量的米饭和牛肉，牛肉更不容易饿？带你了解食物热效应（TEF）。",
    image_url: "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80",
    likes_count: 7300,
    is_liked: true,
    created_at: "16小时前",
  },
  {
    id: 405,
    user_id: 6,
    username: "diet_helper",
    nickname: "减脂小助手",
    avatar_url: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "🥑 【避坑指南】减脂期如何正确计算食材热量？生重 vs 熟重到底怎么区分？",
    image_url: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&auto=format&fit=crop&q=80",
    likes_count: 8500,
    is_liked: false,
    created_at: "18小时前",
  },
  {
    id: 406,
    user_id: 3,
    username: "family_kitchen",
    nickname: "元气烘焙日记",
    avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "🍞 【食友求助】全麦面包成分表第一位必须是全麦粉吗？怎么识别假全麦？",
    image_url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80",
    likes_count: 6100,
    is_liked: false,
    created_at: "20小时前",
  },
  {
    id: 407,
    user_id: 2,
    username: "chef_david",
    nickname: "主厨David",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
    category: "问答",
    content: "🍳 【食谱答疑】空气炸锅烤鸡胸肉怎样做到外酥里嫩、不柴不干？三大关键步骤公开。",
    image_url: "https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=800&auto=format&fit=crop&q=80",
    likes_count: 9400,
    is_liked: true,
    created_at: "22小时前",
  },
]; */

export default function CommunityScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("寻味");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<"进行中" | "即将开始" | "往期活动">("进行中");
  const [questionFilter, setQuestionFilter] = useState<"热门问题" | "待回答" | "已解决">("热门问题");

  // 帖子详情 Modal 控制
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("open-community-post", () => {
      router.push("/post-create");
    });
    return () => sub.remove();
  }, [router]);

  const tabs = ["寻味", "榜单", "活动", "问答"];

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API_BASE}/api/v1/community/posts`);
      if (res.ok) {
        const data = await res.json();
        setPosts(Array.isArray(data) ? data : []);
      } else {
        setPosts([]);
      }
    } catch (e) {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, authFetch]);

  useFocusEffect(
    useCallback(() => {
      fetchPosts();
    }, [fetchPosts])
  );

  const handleLike = async (id: number) => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              is_liked: !p.is_liked,
              likes_count: p.is_liked ? p.likes_count - 1 : p.likes_count + 1,
            }
          : p
      )
    );

    // 如果选中的帖子正在详情弹窗里查看，也同步更新
    if (selectedPost && selectedPost.id === id) {
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              is_liked: !prev.is_liked,
              likes_count: prev.is_liked ? prev.likes_count - 1 : prev.likes_count + 1,
            }
          : null
      );
    }

    try {
      const res = await authFetch(`${API_BASE}/api/v1/community/posts/${id}/like`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "点赞失败");
      setPosts((prev) => prev.map((item) => item.id === id ? { ...item, likes_count: data.likes_count, is_liked: data.is_liked } : item));
    } catch (e) {
      fetchPosts();
    }
  };

  const handleJoinEvent = async (post: Post) => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (getActivityStatus(post) === "ended") return;

    const previousJoined = Boolean(post.is_joined);
    const previousCount = post.participant_count || 0;
    setPosts((current) => current.map((item) => item.id === post.id ? {
      ...item,
      is_joined: !previousJoined,
      participant_count: Math.max(0, previousCount + (previousJoined ? -1 : 1)),
    } : item));

    try {
      const response = await authFetch(`${API_BASE}/api/v1/community/posts/${post.id}/join`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "活动操作失败");
      setPosts((current) => current.map((item) => item.id === post.id ? {
        ...item,
        is_joined: Boolean(data.is_joined),
        participant_count: Number(data.participant_count) || 0,
      } : item));
    } catch (error) {
      setPosts((current) => current.map((item) => item.id === post.id ? {
        ...item,
        is_joined: previousJoined,
        participant_count: previousCount,
      } : item));
      Alert.alert("操作失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 格式化赞数 (如 1000+、10000+、5000+)
  const formatLikes = (count: number) => {
    if (count >= 10000) return "10000+";
    if (count >= 5000) return "5000+";
    if (count >= 1000) return "1000+";
    return count.toString();
  };

  // 过滤数据 (分类 Tab + 搜索关键词)
  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      const pCat = p.category || "寻味";
      const matchCategory = pCat === activeTab;
      const matchSearch = !searchQuery || p.content.includes(searchQuery);
      return matchCategory && matchSearch;
    });
  }, [posts, activeTab, searchQuery]);

  const rankedPosts = useMemo(() => {
    if (activeTab !== "榜单") return [];
    return [...filteredPosts].sort((left, right) => {
      const leftHeat =
        (left.likes_count || 0) +
        (left.comment_count || 0) * 3 +
        (left.views_count || 0) * 0.1;
      const rightHeat =
        (right.likes_count || 0) +
        (right.comment_count || 0) * 3 +
        (right.views_count || 0) * 0.1;
      return rightHeat - leftHeat || right.id - left.id;
    });
  }, [activeTab, filteredPosts]);

  const activityPosts = useMemo(() => {
    if (activeTab !== "活动") return [];
    const statusForFilter: Record<typeof activityFilter, ActivityStatus> = {
      "进行中": "ongoing",
      "即将开始": "upcoming",
      "往期活动": "ended",
    };
    return filteredPosts
      .filter((post) => getActivityStatus(post) === statusForFilter[activityFilter])
      .sort((left, right) => {
        const leftDate = parseCommunityDate(left.event_start_at)?.getTime() || 0;
        const rightDate = parseCommunityDate(right.event_start_at)?.getTime() || 0;
        return activityFilter === "往期活动" ? rightDate - leftDate : leftDate - rightDate;
      });
  }, [activeTab, activityFilter, filteredPosts]);

  const questionPosts = useMemo(() => {
    if (activeTab !== "问答") return [];
    return filteredPosts
      .filter((post) => {
        if (questionFilter === "待回答") return (post.comment_count || 0) === 0;
        if (questionFilter === "已解决") return post.question_status === "resolved";
        return true;
      })
      .sort((left, right) => {
        if (questionFilter === "热门问题") {
          const leftHeat = (left.comment_count || 0) * 5 + (left.views_count || 0) + (left.likes_count || 0) * 2;
          const rightHeat = (right.comment_count || 0) * 5 + (right.views_count || 0) + (right.likes_count || 0) * 2;
          return rightHeat - leftHeat;
        }
        return right.id - left.id;
      });
  }, [activeTab, filteredPosts, questionFilter]);

  const formatHeat = (post: Post) => {
    const heat = Math.round(
      (post.likes_count || 0) +
      (post.comment_count || 0) * 3 +
      (post.views_count || 0) * 0.1
    );
    if (heat >= 10000) return `${(heat / 10000).toFixed(1)}万`;
    if (heat >= 1000) return `${(heat / 1000).toFixed(1)}k`;
    return String(heat);
  };

  const formatRankingDate = (value: string) => {
    const date = new Date(value.replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return "近期更新";
    return `${date.getMonth() + 1}月${date.getDate()}日更新`;
  };

  // 紧凑交错拆分为双列 (Masonry Grid)
  const { leftColumn, rightColumn } = useMemo(() => {
    const left: Post[] = [];
    const right: Post[] = [];
    filteredPosts.forEach((post, index) => {
      if (index % 2 === 0) {
        left.push(post);
      } else {
        right.push(post);
      }
    });
    return { leftColumn: left, rightColumn: right };
  }, [filteredPosts]);

  const renderPostCard = (post: Post, index: number) => {
    // 等宽不等长 (Pinterest / 小红书 瀑布流 Masonry Waterfall Layout)
    // 根据 post.id 派生不同的图片高度比例，使左右两列错落有致
    const heightVariants = ["h-56", "h-36", "h-48", "h-64", "h-44"];
    const imageHeight = heightVariants[post.id % heightVariants.length];

    return (
      <TouchableOpacity
        key={post.id}
        onPress={() =>
          router.push("/post-detail", { id: post.id, postData: post })
        }
        activeOpacity={0.9}
        className="bg-white rounded-2xl overflow-hidden mb-3 border border-[#F2ECE1] shadow-xs relative"
      >
        {/* 分类浮沉小胶囊 */}
        {post.category && (
          <View className="absolute top-2 left-2 z-10 bg-black/45 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/20">
            <Text className="text-[9px] font-bold text-white">#{post.category}</Text>
          </View>
        )}

        {/* 高清等宽不等长封面图片 */}
        {post.image_url ? (
          <Image
            source={{ uri: post.image_url }}
            className={`w-full ${imageHeight}`}
            resizeMode="cover"
          />
        ) : (
          <View className={`w-full ${imageHeight} bg-[#F4ECDD] justify-between p-4`}>
            <View className="w-9 h-9 rounded-full bg-[#2D6A4F]/10 items-center justify-center self-end">
              <FontAwesome6 name="pen-nib" size={15} color="#2D6A4F" />
            </View>
            <Text className="text-sm font-bold text-[#3D3229] leading-6" numberOfLines={5}>
              {post.content}
            </Text>
            <Text className="text-[10px] font-bold text-[#2D6A4F]">食光文字笔记</Text>
          </View>
        )}

        {/* 标题 & 作者信息面板 (不等长自然延伸) */}
        <View className="p-3">
          {post.image_url ? <Text className="text-xs font-bold text-[#222222] leading-5" numberOfLines={3}>{post.content}</Text> : null}

          <View className="flex-row items-center justify-between mt-2.5 pt-2 border-t border-[#F8F5F0]">
            {/* 作者头像与昵称 */}
            <View className="flex-row items-center gap-1.5 flex-1 pr-1">
              <Image
                source={getAvatarSource(post.avatar_url, post.user_id ?? post.username)}
                className="w-5 h-5 rounded-full"
              />
              <Text className="text-[10px] text-[#777777] font-medium" numberOfLines={1}>
                {post.username}
              </Text>
            </View>

            {/* 点赞 */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleLike(post.id);
              }}
              className="flex-row items-center gap-1 py-0.5 px-1"
            >
              <FontAwesome6
                name="heart"
                size={11}
                color={post.is_liked ? "#FF3B30" : "#888888"}
                solid={post.is_liked}
              />
              <Text className={`text-[10px] font-medium ${post.is_liked ? "text-[#FF3B30]" : "text-[#777777]"}`}>
                {formatLikes(post.likes_count)}
              </Text>
            </TouchableOpacity>
            <View className="ml-1 flex-row items-center gap-1 px-1">
              <FontAwesome6 name="comment" size={10} color="#888888" />
              <Text className="text-[10px] font-medium text-[#777777]">{post.comment_count || 0}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderRankingCard = (post: Post, index: number) => {
    const rank = index + 1;
    const rankTheme =
      rank === 1
        ? { background: "bg-[#F4C95D]", text: "text-[#5A3A00]", border: "border-[#E9B949]" }
        : rank === 2
          ? { background: "bg-[#DDE3E8]", text: "text-[#46525C]", border: "border-[#C9D0D6]" }
          : rank === 3
            ? { background: "bg-[#DDA77B]", text: "text-[#5D321F]", border: "border-[#CF9365]" }
            : { background: "bg-[#EFF4F0]", text: "text-[#2D6A4F]", border: "border-[#DCE9DF]" };

    if (rank === 1) {
      return (
        <TouchableOpacity
          key={post.id}
          onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
          activeOpacity={0.9}
          className="overflow-hidden rounded-[24px] border border-[#E7D7AE] bg-white shadow-sm"
        >
          <View className="relative h-48 bg-[#EAF2EC]">
            {post.image_url ? (
              <Image source={{ uri: post.image_url }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <View className="h-full w-full items-center justify-center">
                <FontAwesome6 name="trophy" size={42} color="#C6922B" />
              </View>
            )}
            <View className="absolute left-3 top-3 flex-row items-center gap-1.5 rounded-full border border-[#E9B949] bg-[#F4C95D] px-3 py-1.5">
              <FontAwesome6 name="crown" size={11} color="#5A3A00" />
              <Text className="text-xs font-black text-[#5A3A00]">TOP 1</Text>
            </View>
            <View className="absolute right-3 top-3 flex-row items-center gap-1 rounded-full bg-black/60 px-2.5 py-1">
              <FontAwesome6 name="fire" size={10} color="#F4C95D" />
              <Text className="text-[10px] font-bold text-white">热度 {formatHeat(post)}</Text>
            </View>
          </View>

          <View className="p-4">
            <View className="mb-2 flex-row items-center gap-2">
              <View className="rounded-md bg-[#FFF5D8] px-2 py-1">
                <Text className="text-[10px] font-black text-[#9A6810]">本周冠军</Text>
              </View>
              <Text className="text-[10px] font-medium text-[#A09382]">
                {formatRankingDate(post.created_at)}
              </Text>
            </View>
            <Text className="text-[15px] font-black leading-6 text-[#302820]" numberOfLines={3}>
              {post.content}
            </Text>
            <View className="mt-3 flex-row items-center justify-between border-t border-[#F4EFE6] pt-3">
              <View className="flex-1 flex-row items-center gap-2 pr-3">
                <Image
                  source={getAvatarSource(post.avatar_url, post.user_id ?? post.username)}
                  className="h-6 w-6 rounded-full"
                />
                <Text className="flex-1 text-[11px] font-semibold text-[#74685B]" numberOfLines={1}>
                  {post.nickname || post.username}
                </Text>
              </View>
              <TouchableOpacity
                onPress={(event) => {
                  event.stopPropagation();
                  handleLike(post.id);
                }}
                className="flex-row items-center gap-1.5 rounded-full bg-[#FFF0EE] px-3 py-1.5"
              >
                <FontAwesome6
                  name="heart"
                  size={11}
                  color={post.is_liked ? "#D94B42" : "#A57C75"}
                  solid={post.is_liked}
                />
                <Text className="text-[10px] font-bold text-[#A95048]">{formatLikes(post.likes_count)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        key={post.id}
        onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
        activeOpacity={0.88}
        className={`flex-row items-center rounded-2xl border bg-white p-2.5 shadow-2xs ${rankTheme.border}`}
      >
        <View className={`mr-2.5 h-10 w-10 items-center justify-center rounded-xl ${rankTheme.background}`}>
          <Text className={`text-base font-black ${rankTheme.text}`}>{rank}</Text>
          {rank <= 3 ? <Text className={`text-[7px] font-black ${rankTheme.text}`}>TOP</Text> : null}
        </View>

        {post.image_url ? (
          <Image source={{ uri: post.image_url }} className="mr-3 h-[74px] w-[74px] rounded-xl" resizeMode="cover" />
        ) : (
          <View className="mr-3 h-[74px] w-[74px] items-center justify-center rounded-xl bg-[#EFF4F0]">
            <FontAwesome6 name="ranking-star" size={20} color="#2D6A4F" />
          </View>
        )}

        <View className="min-w-0 flex-1 py-0.5">
          <Text className="text-xs font-bold leading-[18px] text-[#302820]" numberOfLines={2}>
            {post.content}
          </Text>
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="max-w-[55%] text-[9px] font-medium text-[#918576]" numberOfLines={1}>
              {post.nickname || post.username}
            </Text>
            <View className="flex-row items-center gap-1">
              <FontAwesome6 name="fire" size={9} color={rank <= 3 ? "#C17B27" : "#73917D"} />
              <Text className={`text-[9px] font-black ${rank <= 3 ? "text-[#A96318]" : "text-[#55735F]"}`}>
                {formatHeat(post)}
              </Text>
            </View>
          </View>
        </View>

        <FontAwesome6 name="chevron-right" size={10} color="#C8BFB2" style={{ marginLeft: 8 }} />
      </TouchableOpacity>
    );
  };

  const renderActivityCard = (post: Post, index: number) => {
    const status = getActivityStatus(post);
    const statusMeta = status === "ongoing"
      ? { label: "进行中", background: "bg-[#DDF3E5]", text: "text-[#1F7048]" }
      : status === "upcoming"
        ? { label: "即将开始", background: "bg-[#FFF0D7]", text: "text-[#A76513]" }
        : { label: "已结束", background: "bg-[#EEECE8]", text: "text-[#7D746A]" };
    const startTime = parseCommunityDate(post.event_start_at)?.getTime();
    const endTime = parseCommunityDate(post.event_end_at)?.getTime();
    const progress = status === "ongoing" && startTime && endTime && endTime > startTime
      ? Math.min(100, Math.max(4, ((Date.now() - startTime) / (endTime - startTime)) * 100))
      : status === "ended" ? 100 : 0;

    if (index === 0) {
      return (
        <TouchableOpacity
          key={post.id}
          onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
          activeOpacity={0.9}
          className="overflow-hidden rounded-[24px] border border-[#DDE8DF] bg-white shadow-sm"
        >
          <View className="relative h-44 bg-[#EAF2EC]">
            {post.image_url ? (
              <Image source={{ uri: post.image_url }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <View className="h-full w-full items-center justify-center">
                <FontAwesome6 name="calendar-check" size={38} color="#2D6A4F" />
              </View>
            )}
            <View className={`absolute left-3 top-3 rounded-full px-3 py-1.5 ${statusMeta.background}`}>
              <Text className={`text-[10px] font-black ${statusMeta.text}`}>{statusMeta.label}</Text>
            </View>
            <View className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1">
              <Text className="text-[10px] font-bold text-white">主推活动</Text>
            </View>
          </View>
          <View className="p-4">
            <Text className="text-[15px] font-black leading-6 text-[#302820]" numberOfLines={2}>{post.content}</Text>
            <View className="mt-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <FontAwesome6 name="calendar-days" size={11} color="#6E7E72" />
                <Text className="text-[10px] font-semibold text-[#6E7E72]">
                  {formatActivityDate(post.event_start_at)}—{formatActivityDate(post.event_end_at)}
                </Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <FontAwesome6 name="user-group" size={10} color="#8B7D6B" />
                <Text className="text-[10px] font-bold text-[#8B7D6B]">{post.participant_count || 0} 人参加</Text>
              </View>
            </View>
            {status !== "upcoming" ? (
              <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E8EEE9]">
                <View className="h-full rounded-full bg-[#55A878]" style={{ width: `${progress}%` }} />
              </View>
            ) : null}
            <TouchableOpacity
              disabled={status === "ended"}
              onPress={(event) => {
                event.stopPropagation();
                void handleJoinEvent(post);
              }}
              className={`mt-4 items-center rounded-xl py-2.5 ${status === "ended" ? "bg-[#E7E3DD]" : post.is_joined ? "bg-[#E8F2EA]" : "bg-[#2D6A4F]"}`}
            >
              <Text className={`text-xs font-black ${status === "ended" ? "text-[#8D857B]" : post.is_joined ? "text-[#2D6A4F]" : "text-white"}`}>
                {status === "ended" ? "活动已结束" : post.is_joined ? "已参加 · 点击退出" : status === "upcoming" ? "提前报名" : "立即参加"}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        key={post.id}
        onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
        activeOpacity={0.88}
        className="flex-row rounded-2xl border border-[#E5EAE5] bg-white p-3 shadow-2xs"
      >
        {post.image_url ? (
          <Image source={{ uri: post.image_url }} className="mr-3 h-24 w-24 rounded-xl" resizeMode="cover" />
        ) : (
          <View className="mr-3 h-24 w-24 items-center justify-center rounded-xl bg-[#EAF2EC]">
            <FontAwesome6 name="calendar-check" size={23} color="#2D6A4F" />
          </View>
        )}
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center justify-between">
            <View className={`rounded-md px-2 py-1 ${statusMeta.background}`}>
              <Text className={`text-[9px] font-black ${statusMeta.text}`}>{statusMeta.label}</Text>
            </View>
            <Text className="text-[9px] font-semibold text-[#938779]">{post.participant_count || 0} 人参加</Text>
          </View>
          <Text className="mt-2 text-xs font-bold leading-[18px] text-[#302820]" numberOfLines={2}>{post.content}</Text>
          <View className="mt-auto flex-row items-end justify-between pt-2">
            <Text className="text-[9px] text-[#83786B]">截止 {formatActivityDate(post.event_end_at)}</Text>
            <TouchableOpacity
              disabled={status === "ended"}
              onPress={(event) => {
                event.stopPropagation();
                void handleJoinEvent(post);
              }}
              className={`rounded-full px-3 py-1.5 ${status === "ended" ? "bg-[#EEECE8]" : post.is_joined ? "bg-[#E4F1E7]" : "bg-[#2D6A4F]"}`}
            >
              <Text className={`text-[9px] font-black ${status === "ended" ? "text-[#8D857B]" : post.is_joined ? "text-[#2D6A4F]" : "text-white"}`}>
                {status === "ended" ? "已结束" : post.is_joined ? "已参加" : "参加"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderQuestionCard = (post: Post) => {
    const isResolved = post.question_status === "resolved";
    const answerCount = post.comment_count || 0;
    return (
      <TouchableOpacity
        key={post.id}
        onPress={() => router.push("/post-detail", { id: post.id, postData: post })}
        activeOpacity={0.88}
        className="flex-row gap-3 rounded-2xl border border-[#E7E2DA] bg-white p-3.5 shadow-2xs"
      >
        <View className={`h-[62px] w-[54px] items-center justify-center rounded-xl ${isResolved ? "bg-[#E2F2E7]" : answerCount > 0 ? "bg-[#FFF0D9]" : "bg-[#F1EFEB]"}`}>
          <Text className={`text-lg font-black ${isResolved ? "text-[#28724B]" : answerCount > 0 ? "text-[#A96819]" : "text-[#756D64]"}`}>{answerCount}</Text>
          <Text className={`text-[8px] font-bold ${isResolved ? "text-[#4F8967]" : "text-[#8B7D6B]"}`}>个回答</Text>
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row items-start gap-2">
            <Text className="flex-1 text-[13px] font-bold leading-5 text-[#302820]" numberOfLines={3}>{post.content}</Text>
            {post.image_url ? <Image source={{ uri: post.image_url }} className="h-14 w-14 rounded-lg" resizeMode="cover" /> : null}
          </View>
          <View className="mt-2.5 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-1.5 pr-2">
              <Text className="max-w-[55%] text-[9px] font-medium text-[#8B7D6B]" numberOfLines={1}>{post.nickname || post.username}</Text>
              {post.author_is_expert ? (
                <View className="rounded bg-[#E8F2EA] px-1.5 py-0.5">
                  <Text className="text-[8px] font-black text-[#2D6A4F]">专业用户</Text>
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-2">
              <Text className="text-[8px] text-[#A09383]">{post.views_count || 0} 浏览</Text>
              <View className={`rounded-full px-2 py-1 ${isResolved ? "bg-[#DDF3E5]" : "bg-[#FFF0D7]"}`}>
                <Text className={`text-[8px] font-black ${isResolved ? "text-[#257149]" : "text-[#A76513]"}`}>
                  {isResolved ? "已解决" : answerCount > 0 ? "讨论中" : "待解答"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={fetchPosts}
            tintColor="#2D6A4F"
            colors={["#2D6A4F"]}
          />
        }
        contentContainerStyle={{ paddingBottom: 120 }}
        className="bg-[#FAFAFA]"
      >
        {/* 工具导航：发布操作由底部全局按钮承担 */}
        <View className="bg-[#FAFAFA] px-5 pt-4 pb-2">
          <View className="flex-row items-center gap-2">
            <TouchableOpacity onPress={() => setSearchOpen(!searchOpen)} className="h-10 w-10 items-center justify-center rounded-full border border-[#EBE3D5] bg-white active:opacity-80">
              <FontAwesome6 name="magnifying-glass" size={14} color="#2D6A4F" />
            </TouchableOpacity>
            <View className="flex-1 bg-white p-1.5 rounded-2xl border border-[#EBE3D5] shadow-2xs flex-row">
              {tabs.map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => setActiveTab(tab)}
                    className={`flex-1 py-2.5 rounded-xl items-center justify-center ${
                      isActive ? "bg-[#2D6A4F] shadow-xs" : ""
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        isActive ? "text-white font-black" : "text-[#8B7D6B]"
                      }`}
                    >
                      {tab}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* 搜索展开框 */}
        {searchOpen && (
          <View className="mx-5 mt-2 mb-2 bg-white px-3.5 py-2.5 rounded-2xl border border-[#EBE3D5] flex-row items-center gap-2 shadow-xs">
            <FontAwesome6 name="magnifying-glass" size={13} color="#8B7D6B" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="搜索社区动态、食材搭配或食友..."
              placeholderTextColor="#B0A495"
              className="flex-1 text-xs text-[#3D3229] py-0"
              autoFocus
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <FontAwesome6 name="circle-xmark" size={13} color="#B0A495" />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

      {/* 社区内容区：榜单使用排名列表，其余板块保留双列瀑布流 */}
        {loading && posts.length === 0 ? (
          <View className="py-20 items-center">
            <ActivityIndicator size="large" color="#2D6A4F" />
          </View>
        ) : filteredPosts.length === 0 ? (
          <View className="mx-5 mt-8 items-center rounded-3xl border border-[#EBE3D5] bg-white px-5 py-12">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#EFF4F0]">
              <FontAwesome6
                name={activeTab === "榜单" ? "ranking-star" : "note-sticky"}
                size={20}
                color="#2D6A4F"
              />
            </View>
            <Text className="mt-3 text-sm font-black text-[#3D3229]">暂时没有相关内容</Text>
            <Text className="mt-1 text-xs text-[#918576]">换个关键词，或者发布第一条动态</Text>
          </View>
        ) : activeTab === "榜单" ? (
          <View className="px-4 pb-2 pt-1">
            <View className="mb-3 overflow-hidden rounded-[22px] bg-[#244F3D] p-4">
              <View className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/5" />
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <View className="mb-2 flex-row items-center gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-xl bg-[#F4C95D]">
                      <FontAwesome6 name="trophy" size={14} color="#5A3A00" />
                    </View>
                    <Text className="text-base font-black text-white">社区食力热榜</Text>
                  </View>
                  <Text className="text-[11px] leading-4 text-white/70">
                    根据点赞、讨论和浏览热度综合排名
                  </Text>
                </View>
                <View className="items-end">
                  <View className="flex-row items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1">
                    <View className="h-1.5 w-1.5 rounded-full bg-[#9FE3B8]" />
                    <Text className="text-[9px] font-bold text-white">实时更新</Text>
                  </View>
                  <Text className="mt-2 text-[10px] font-semibold text-[#D8E9DE]">
                    共 {rankedPosts.length} 个榜单
                  </Text>
                </View>
              </View>
            </View>

            <View className="gap-3">
              {rankedPosts.map((post, index) => renderRankingCard(post, index))}
            </View>
          </View>
        ) : activeTab === "活动" ? (
          <View className="px-4 pb-2 pt-1">
            <View className="mb-3 rounded-[22px] border border-[#DDE8DF] bg-[#F1F7F2] p-4">
              <View className="flex-row items-center justify-between">
                <View>
                  <View className="flex-row items-center gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-xl bg-[#2D6A4F]">
                      <FontAwesome6 name="calendar-check" size={14} color="#FFFFFF" />
                    </View>
                    <Text className="text-base font-black text-[#2E3A31]">社区活动中心</Text>
                  </View>
                  <Text className="mt-2 text-[10px] text-[#708075]">参与真实打卡，与食友一起完成健康目标</Text>
                </View>
                <TouchableOpacity onPress={() => router.push("/post-create", { category: "活动" })} className="rounded-full bg-white px-3 py-2 shadow-2xs">
                  <Text className="text-[10px] font-black text-[#2D6A4F]">发起活动</Text>
                </TouchableOpacity>
              </View>
              <View className="mt-4 flex-row rounded-xl bg-white p-1">
                {(["进行中", "即将开始", "往期活动"] as const).map((filter) => (
                  <TouchableOpacity
                    key={filter}
                    onPress={() => setActivityFilter(filter)}
                    className={`flex-1 items-center rounded-lg py-2 ${activityFilter === filter ? "bg-[#2D6A4F]" : ""}`}
                  >
                    <Text className={`text-[10px] font-black ${activityFilter === filter ? "text-white" : "text-[#7C7368]"}`}>{filter}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {activityPosts.length ? (
              <View className="gap-3">{activityPosts.map((post, index) => renderActivityCard(post, index))}</View>
            ) : (
              <View className="items-center rounded-2xl border border-[#E8E4DD] bg-white py-10">
                <FontAwesome6 name="calendar-day" size={22} color="#9A9084" />
                <Text className="mt-3 text-xs font-bold text-[#776E64]">当前没有{activityFilter}的项目</Text>
              </View>
            )}
          </View>
        ) : activeTab === "问答" ? (
          <View className="px-4 pb-2 pt-1">
            <View className="mb-3 rounded-[22px] border border-[#E9E1D6] bg-[#FFF9F0] p-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <View className="flex-row items-center gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-xl bg-[#E9B95E]">
                      <FontAwesome6 name="circle-question" size={15} color="#5F410C" />
                    </View>
                    <Text className="text-base font-black text-[#3D3229]">营养问答广场</Text>
                  </View>
                  <Text className="mt-2 text-[10px] text-[#887B6B]">真实回答数、解决状态和专业身份清晰可见</Text>
                </View>
                <TouchableOpacity onPress={() => router.push("/post-create", { category: "问答" })} className="rounded-full bg-[#3D3229] px-3 py-2">
                  <Text className="text-[10px] font-black text-white">我要提问</Text>
                </TouchableOpacity>
              </View>
              <View className="mt-4 flex-row gap-2">
                {(["热门问题", "待回答", "已解决"] as const).map((filter) => (
                  <TouchableOpacity
                    key={filter}
                    onPress={() => setQuestionFilter(filter)}
                    className={`rounded-full border px-3 py-1.5 ${questionFilter === filter ? "border-[#3D3229] bg-[#3D3229]" : "border-[#E4DACE] bg-white"}`}
                  >
                    <Text className={`text-[9px] font-black ${questionFilter === filter ? "text-white" : "text-[#7E7163]"}`}>{filter}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {questionPosts.length ? (
              <View className="gap-3">{questionPosts.map(renderQuestionCard)}</View>
            ) : (
              <View className="items-center rounded-2xl border border-[#E8E4DD] bg-white py-10">
                <FontAwesome6 name="comment-dots" size={22} color="#9A9084" />
                <Text className="mt-3 text-xs font-bold text-[#776E64]">这里暂时没有{questionFilter}</Text>
              </View>
            )}
          </View>
        ) : (
          <View className="px-3 flex-row gap-2.5 mt-1">
            {/* 左列 */}
            <View className="flex-1">
              {leftColumn.map((post, i) => renderPostCard(post, i))}
            </View>

            {/* 右列 */}
            <View className="flex-1">
              {rightColumn.map((post, i) => renderPostCard(post, i))}
            </View>
          </View>
        )}



      {/* 帖子详情查看 Modal */}
      <Modal visible={!!selectedPost} animationType="slide" transparent>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-[32px] overflow-hidden max-h-[90%]">
            {/* 顶栏关闭与作者 */}
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-[#F5EFE6] bg-white">
              <View className="flex-row items-center gap-3">
                <Image
                  source={getAvatarSource(selectedPost?.avatar_url, selectedPost?.user_id ?? selectedPost?.username)}
                  className="w-10 h-10 rounded-full border border-[#2D6A4F]/20"
                />
                <View>
                  <Text className="text-sm font-bold text-[#3D3229]">
                    {selectedPost?.username}
                  </Text>
                  <Text className="text-[10px] text-[#8B7D6B] mt-0.5">
                    {selectedPost?.created_at || "刚刚"} · 发布于【{selectedPost?.category || "寻味"}】
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setSelectedPost(null)}
                className="w-8 h-8 rounded-full bg-[#F5EFE6] items-center justify-center"
              >
                <FontAwesome6 name="xmark" size={16} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            {/* 详情内容区 */}
            <ScrollView showsVerticalScrollIndicator={false} className="p-5">
              {selectedPost?.image_url && (
                <Image
                  source={{ uri: selectedPost.image_url }}
                  className="w-full h-72 rounded-2xl mb-4"
                  resizeMode="cover"
                />
              )}

              <Text className="text-base font-bold text-[#3D3229] leading-6 mb-3">
                {selectedPost?.content}
              </Text>

              {/* 互动数据栏 */}
              <View className="flex-row items-center justify-between py-3 border-t border-b border-[#F5EFE6] my-4">
                <TouchableOpacity
                  onPress={() => selectedPost && handleLike(selectedPost.id)}
                  className="flex-row items-center gap-2 bg-[#FF3B30]/10 px-4 py-2 rounded-full"
                >
                  <FontAwesome6
                    name="heart"
                    size={16}
                    color={selectedPost?.is_liked ? "#FF3B30" : "#888888"}
                    solid={selectedPost?.is_liked}
                  />
                  <Text
                    className={`text-xs font-bold ${
                      selectedPost?.is_liked ? "text-[#FF3B30]" : "text-[#777777]"
                    }`}
                  >
                    {selectedPost?.is_liked ? "已赞" : "点赞"} · {selectedPost ? formatLikes(selectedPost.likes_count) : 0}
                  </Text>
                </TouchableOpacity>

                <View className="flex-row gap-3">
                  <View className="bg-[#F5EFE6] px-3 py-2 rounded-full flex-row items-center gap-1.5">
                    <FontAwesome6 name="comment" size={13} color="#8B7D6B" />
                    <Text className="text-xs text-[#8B7D6B] font-semibold">评论</Text>
                  </View>
                  <View className="bg-[#F5EFE6] px-3 py-2 rounded-full flex-row items-center gap-1.5">
                    <FontAwesome6 name="share" size={13} color="#8B7D6B" />
                    <Text className="text-xs text-[#8B7D6B] font-semibold">分享</Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      </ScrollView>

    </Screen>
  );
}
