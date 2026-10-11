import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { authApi } from "@/services/api";
import { accountPasswordSchema } from "@dietdigidose/contracts";

export default function ForgotPasswordScreen() {
  const router = useSafeRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallenge] = useState("");
  const [grant, setGrant] = useState<{ token: string; expiresAt: number } | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  const perform = async (action: "send" | "verify" | "reset") => {
    if (pending.current) return;
    const normalized = phone.replace(/[\s-]/g, "").replace(/^\+?86/, "");
    if (action === "send" && !/^1[3-9]\d{9}$/.test(normalized)) return setError("请输入已绑定的中国大陆手机号");
    if (action === "verify" && !/^\d{6}$/.test(code)) return setError("请输入 6 位验证码");
    if (action === "reset") {
      if (!grant || Date.now() >= grant.expiresAt) { setGrant(null); return setError("身份验证已过期，请重新获取验证码"); }
      if (!accountPasswordSchema.safeParse(password).success) return setError("新密码需为 6–128 位，包含字母和数字");
      if (password !== confirmation) return setError("两次输入的新密码不一致");
    }
    pending.current = true; setBusy(true); setError("");
    try {
      if (action === "send") {
        const result = await authApi.sendPasswordRecovery(normalized);
        if (!active.current) return;
        setPhone(normalized); setChallenge(result.challengeId); setCountdown(result.resendAfter); setCode(""); setGrant(null);
      } else if (action === "verify") {
        const result = await authApi.verifyPasswordRecovery(challengeId, code);
        if (!active.current) return;
        setGrant({ token: result.recoveryToken, expiresAt: Date.now() + result.expiresIn * 1000 }); setCode("");
      } else {
        await authApi.resetPassword(grant!.token, password);
        if (!active.current) return;
        setPassword(""); setConfirmation(""); setGrant(null); setChallenge(""); setComplete(true);
      }
    } catch (err) { if (active.current) setError(err instanceof Error ? err.message : "暂时无法完成，请重试"); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const restart = () => { setGrant(null); setChallenge(""); setCode(""); setPassword(""); setConfirmation(""); setError(""); };
  return <Screen safeAreaEdges={["top", "bottom"]}><ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
    <TouchableOpacity accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/login")}><Text className="text-brand">返回</Text></TouchableOpacity>
    <Text accessibilityRole="header" className="text-2xl font-bold text-ink">找回密码</Text>
    {complete ? <>
      <Text className="text-ink">密码已重设，所有旧登录会话已失效。请使用新密码登录。</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/login")} className="rounded-xl bg-brand-fill p-4"><Text className="text-center font-bold text-white">返回登录</Text></TouchableOpacity>
    </> : <>
      <Text className="text-copy-muted">使用账号此前已绑定并验证的手机号恢复。收到验证码不代表该号码已有可恢复账号。重设后所有旧登录会话将失效。</Text>
      {!grant ? <>
        <TextInput accessibilityLabel="绑定手机号" placeholder="中国大陆手机号" value={phone} onChangeText={setPhone} editable={!busy && !challengeId} keyboardType="phone-pad" autoComplete="tel" maxLength={15} className="rounded-xl border border-line bg-surface p-4 text-ink" />
        {challengeId ? <>
          <Text className="text-copy-muted">短信请求已被服务商接收，验证码 5 分钟有效；未收到可稍后重试或联系管理员。</Text>
          <TextInput accessibilityLabel="恢复验证码" placeholder="6 位验证码" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} editable={!busy} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} className="rounded-xl border border-line bg-surface p-4 text-ink" />
          <TouchableOpacity accessibilityRole="button" disabled={busy || countdown > 0} onPress={() => void perform("send")}><Text className="text-brand">{countdown > 0 ? `${countdown} 秒后重发` : "重新发送"}</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={restart}><Text className="text-brand">更换手机号</Text></TouchableOpacity>
        </> : null}
      </> : <>
        <Text className="text-copy-muted">身份已验证，请在 5 分钟内设置新密码。密码需为 6–128 位，包含字母和数字。</Text>
        {([["新密码", password, setPassword], ["确认新密码", confirmation, setConfirmation]] as const).map(([label, value, onChangeText]) => <TextInput key={label} accessibilityLabel={label} placeholder={label} value={value} onChangeText={onChangeText} editable={!busy} secureTextEntry autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={128} className="rounded-xl border border-line bg-surface p-4 text-ink" />)}
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={restart}><Text className="text-brand">重新验证</Text></TouchableOpacity>
      </>}
      {!!error && <Text accessibilityRole="alert" className="text-critical">{error}</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy, disabled: busy || (!challengeId && countdown > 0) }} disabled={busy || (!challengeId && countdown > 0)} onPress={() => void perform(grant ? "reset" : challengeId ? "verify" : "send")} className="rounded-xl bg-brand-fill p-4"><Text className="text-center font-bold text-white">{busy ? "正在处理…" : grant ? "重设密码" : challengeId ? "验证身份" : countdown > 0 ? `${countdown} 秒后获取` : "获取恢复验证码"}</Text></TouchableOpacity>
    </>}
    <View className="gap-2 rounded-xl border border-line p-4">
      <Text className="font-bold text-ink">无法使用绑定手机或仅有邮箱账号？</Text>
      <Text selectable className="text-copy-muted">当前不支持邮箱自助恢复；历史注册邮箱尚未完成所有权验证。请联系向你提供安装包或邀请的管理员，提供账号与问题说明，申请人工核验恢复。不要发送密码、验证码或健康资料。</Text>
    </View>
  </ScrollView></Screen>;
}
