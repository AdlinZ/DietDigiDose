import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Screen } from "@/components/Screen";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";

const policies = {
  privacy: {
    title: "隐私政策",
    updated: "更新日期：2026年8月3日",
    sections: [
      ["我们收集什么", "为提供库存、饮食、健康与社区功能，我们处理您主动填写的账号信息、食材与饮食记录、健康目标，以及您选择上传的图片、语音和社区内容。"],
      ["如何使用与保存", "数据仅用于提供本应用功能、保障安全和改进服务。AI 功能会把完成当前请求所需的内容发送给配置的模型服务商；请勿提交身份证号、病历等不必要的敏感信息。"],
      ["您的权利", "您可以在设置中修改资料、退出登录，或通过“永久删除账号”删除账号及其关联数据。删除不可恢复；依法必须保留的安全审计信息除外。"],
      ["健康信息提示", "应用提供的热量、营养与 AI 建议仅用于日常健康管理，不构成医疗诊断或治疗建议。如有疾病、过敏、孕产期或其他特殊情况，请咨询医生或注册营养师。"],
      ["联系我们", "如需查询、更正或删除数据，请通过应用发布渠道提供的支持方式联系我们。"],
    ],
  },
  terms: {
    title: "用户协议",
    updated: "生效日期：2026年8月3日",
    sections: [
      ["服务说明", "食光烙记提供食材库存、菜谱、饮食记录、健康数据与社区工具。功能可能随版本更新而调整。"],
      ["账号安全", "您应妥善保管登录凭据，并对账号下的操作负责。发现异常使用时请及时修改密码或退出登录。"],
      ["内容规范", "不得发布违法、侵权、欺诈、骚扰或危害他人的内容。用户投稿菜谱经审核后方可进入正式推荐。"],
      ["AI 与健康建议", "AI 输出可能存在错误，不应作为医疗诊断、用药或紧急处置依据。涉及食物过敏和疾病饮食时应由专业人员复核。"],
      ["账号终止", "您可以随时在设置中永久删除账号。对于严重违反协议或危害服务安全的账号，我们可以依法限制服务。"],
    ],
  },
} as const;

export default function LegalScreen() {
  const router = useSafeRouter();
  const { type } = useSafeSearchParams<{ type?: string | string[] }>();
  const selectedType = (Array.isArray(type) ? type[0] : type) === "terms" ? "terms" : "privacy";
  const policy = policies[selectedType];

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <View className="px-5 py-3 flex-row items-center border-b border-[#EBE3D5]">
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 items-center justify-center">
          <FontAwesome6 name="chevron-left" size={15} color="#3D3229" />
        </TouchableOpacity>
        <Text className="flex-1 text-center text-lg font-black text-[#3D3229]">{policy.title}</Text>
        <View className="w-10" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 64 }}>
        <Text className="text-xs text-[#8B7D6B] mb-6">{policy.updated}</Text>
        {policy.sections.map(([title, content]) => (
          <View key={title} className="mb-6">
            <Text className="text-base font-black text-[#3D3229] mb-2">{title}</Text>
            <Text className="text-sm leading-6 text-[#66594D]">{content}</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
