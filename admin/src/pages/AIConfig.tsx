import { useEffect, useState } from "react";
import { Bot, Key, Globe, Cpu, Zap, Save, CheckCircle2, AlertCircle, RefreshCw, Mic, SlidersHorizontal, Image } from "lucide-react";
import api from "../services/api";

const PROVIDER_PRESETS = [
  {
    name: "硅基流动 (SiliconFlow)",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    visionModel: "Qwen/Qwen2.5-VL-72B-Instruct",
    asrModel: "FunAudioLLM/SenseVoiceSmall",
    desc: "全能型：文本 + 识图 + 语音转文字（免费额度多，推荐作为默认接入）",
  },
  {
    name: "阿里云百炼 (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-max",
    visionModel: "qwen-vl-max",
    asrModel: "sensevoice-v1",
    desc: "国内极速：适合作为多模态识图或通义千问对话服务商",
  },
  {
    name: "DeepSeek 官方 API",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    visionModel: "deepseek-chat",
    asrModel: "FunAudioLLM/SenseVoiceSmall",
    desc: "文本专项：性价比极高，适合专门绑定为【文本对话服务】",
  },
  {
    name: "OpenAI 官方 API",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    visionModel: "gpt-4o-mini",
    asrModel: "whisper-1",
    desc: "国际大厂：支持标准 Whisper 语音转文字与 GPT-4o 多模态",
  },
];

export default function AIConfig() {
  // 全局默认配置
  const [apiKey, setApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.siliconflow.cn/v1");

  // 独立服务接入开关
  const [enablePerServiceProviders, setEnablePerServiceProviders] = useState(false);

  // 文本对话服务配置
  const [chatApiKey, setChatApiKey] = useState("");
  const [chatMaskedKey, setChatMaskedKey] = useState("");
  const [hasChatApiKey, setHasChatApiKey] = useState(false);
  const [chatBaseUrl, setChatBaseUrl] = useState("");
  const [model, setModel] = useState("deepseek-ai/DeepSeek-V3");

  // 多模态识图服务配置
  const [visionApiKey, setVisionApiKey] = useState("");
  const [visionMaskedKey, setVisionMaskedKey] = useState("");
  const [hasVisionApiKey, setHasVisionApiKey] = useState(false);
  const [visionBaseUrl, setVisionBaseUrl] = useState("");
  const [visionModel, setVisionModel] = useState("Qwen/Qwen2.5-VL-72B-Instruct");

  // 语音识别 ASR 服务配置
  const [asrApiKey, setAsrApiKey] = useState("");
  const [asrMaskedKey, setAsrMaskedKey] = useState("");
  const [hasAsrApiKey, setHasAsrApiKey] = useState(false);
  const [asrBaseUrl, setAsrBaseUrl] = useState("");
  const [asrModel, setAsrModel] = useState("FunAudioLLM/SenseVoiceSmall");

  // 人设提示词
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSystemPromptCustomized, setIsSystemPromptCustomized] = useState(false);

  // UI 状态
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency?: number } | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/admin/ai-config");

      // 全局默认
      setApiKey("");
      setMaskedKey(data.maskedKey || "");
      setHasApiKey(Boolean(data.hasApiKey));
      if (data.baseUrl) setBaseUrl(data.baseUrl);
      if (data.model) setModel(data.model);
      if (data.visionModel) setVisionModel(data.visionModel);
      if (data.asrModel) setAsrModel(data.asrModel);

      // 文本对话服务
      if (data.chat) {
        setChatMaskedKey(data.chat.maskedKey || "");
        setHasChatApiKey(Boolean(data.chat.hasApiKey));
        setChatBaseUrl(data.chat.isCustomUrl ? data.chat.baseUrl : "");
        if (data.chat.model) setModel(data.chat.model);
      }

      // 识图服务
      if (data.vision) {
        setVisionMaskedKey(data.vision.maskedKey || "");
        setHasVisionApiKey(Boolean(data.vision.hasApiKey));
        setVisionBaseUrl(data.vision.isCustomUrl ? data.vision.baseUrl : "");
        if (data.vision.model) setVisionModel(data.vision.model);
      }

      // 语音服务
      if (data.asr) {
        setAsrMaskedKey(data.asr.maskedKey || "");
        setHasAsrApiKey(Boolean(data.asr.hasApiKey));
        setAsrBaseUrl(data.asr.isCustomUrl ? data.asr.baseUrl : "");
        if (data.asr.model) setAsrModel(data.asr.model);
      }

      // 如果有任何一个子服务配置了自定义 Key / URL，则默认展开多接入点面板
      if (data.chat?.isCustomKey || data.chat?.isCustomUrl || data.vision?.isCustomKey || data.vision?.isCustomUrl || data.asr?.isCustomKey || data.asr?.isCustomUrl) {
        setEnablePerServiceProviders(true);
      }

      if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
      setIsSystemPromptCustomized(Boolean(data.isSystemPromptCustomized));
    } catch (err) {
      console.error("Fetch AI Config error", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleApplyPreset = (preset: (typeof PROVIDER_PRESETS)[0]) => {
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setVisionModel(preset.visionModel);
    if (preset.asrModel) setAsrModel(preset.asrModel);
    setStatusMsg(`已应用【${preset.name}】的基准配置，请输入该平台的 API Key`);
    setTimeout(() => setStatusMsg(""), 3500);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put("/admin/ai-config", {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrl,
        model,
        visionModel,
        asrModel,

        // 独立接入点
        chatApiKey: enablePerServiceProviders ? chatApiKey.trim() : "",
        chatBaseUrl: enablePerServiceProviders ? chatBaseUrl.trim() : "",
        chatModel: model,

        visionApiKey: enablePerServiceProviders ? visionApiKey.trim() : "",
        visionBaseUrl: enablePerServiceProviders ? visionBaseUrl.trim() : "",

        asrApiKey: enablePerServiceProviders ? asrApiKey.trim() : "",
        asrBaseUrl: enablePerServiceProviders ? asrBaseUrl.trim() : "",

        systemPrompt,
      });

      if (apiKey.trim()) {
        setApiKey("");
        setHasApiKey(true);
        setMaskedKey(`${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`);
      }
      if (chatApiKey.trim()) {
        setChatApiKey("");
        setHasChatApiKey(true);
        setChatMaskedKey(`${chatApiKey.slice(0, 4)}****${chatApiKey.slice(-4)}`);
      }
      if (visionApiKey.trim()) {
        setVisionApiKey("");
        setHasVisionApiKey(true);
        setVisionMaskedKey(`${visionApiKey.slice(0, 4)}****${visionApiKey.slice(-4)}`);
      }
      if (asrApiKey.trim()) {
        setAsrApiKey("");
        setHasAsrApiKey(true);
        setAsrMaskedKey(`${asrApiKey.slice(0, 4)}****${asrApiKey.slice(-4)}`);
      }

      setStatusMsg("AI 多服务商接入配置保存成功！后续系统各模块将自动智能路由");
      setIsSystemPromptCustomized(true);
      setTimeout(() => setStatusMsg(""), 4000);
    } catch (err: any) {
      alert("保存失败: " + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async (targetService: "global" | "chat" | "vision" | "asr" = "global") => {
    try {
      setTesting(true);
      setTestResult(null);

      let testKey = apiKey;
      let testUrl = baseUrl;
      let testModel = model;

      if (targetService === "chat" && enablePerServiceProviders) {
        if (chatApiKey.trim()) testKey = chatApiKey.trim();
        if (chatBaseUrl.trim()) testUrl = chatBaseUrl.trim();
        testModel = model;
      } else if (targetService === "vision" && enablePerServiceProviders) {
        if (visionApiKey.trim()) testKey = visionApiKey.trim();
        if (visionBaseUrl.trim()) testUrl = visionBaseUrl.trim();
        testModel = visionModel;
      } else if (targetService === "asr" && enablePerServiceProviders) {
        if (asrApiKey.trim()) testKey = asrApiKey.trim();
        if (asrBaseUrl.trim()) testUrl = asrBaseUrl.trim();
        testModel = asrModel;
      }

      const { data } = await api.post("/admin/ai-config/test", {
        apiKey: testKey,
        baseUrl: testUrl,
        model: testModel,
      });

      if (data.success) {
        setTestResult({
          success: true,
          message: `【${targetService.toUpperCase()} 连通成功】模型回应：“${data.reply}”`,
          latency: data.latencyMs,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || "调用失败",
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.response?.data?.error || err.response?.data?.details || err.message || "请求失败，请检查 API Key 或 Base URL",
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="text-center py-20 text-text-muted">加载 AI 服务配置中...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-main flex items-center gap-2">
            <Bot className="text-primary" size={28} /> AI 大模型多接入点配置
          </h2>
          <p className="text-sm text-text-muted mt-1">
            支持为文本对话、识图以及语音识别指定独立的服务接入商 (Base URL & API Key) 或共享全局默认接入点。
          </p>
        </div>
      </div>

      {statusMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-2xl flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 size={18} />
          {statusMsg}
        </div>
      )}

      {/* 快捷配置推荐卡片 */}
      <div className="bg-white p-6 rounded-[24px] shadow-sm space-y-4">
        <h3 className="text-base font-bold text-text-main flex items-center gap-2">
          <Zap className="text-yellow-500" size={18} /> 一键应用推荐服务商
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {PROVIDER_PRESETS.map((preset, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleApplyPreset(preset)}
              className="text-left p-4 rounded-2xl border border-gray-100 bg-background-alt hover:border-primary hover:bg-green-50/50 transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="font-bold text-sm text-text-main group-hover:text-primary">{preset.name}</div>
                <div className="text-xs text-text-muted mt-1 leading-relaxed">{preset.desc}</div>
              </div>
              <div className="text-[10px] text-gray-400 font-mono mt-3 truncate">Base: {preset.baseUrl}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 配置表单 */}
      <div className="bg-white p-6 rounded-[24px] shadow-sm space-y-6">
        {/* 1. 默认全局共享接入点 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <Globe className="text-primary" size={18} /> 1. 全局默认共享服务接入点 (Fallback Provider)
            </h3>
            <span className="text-xs text-text-muted bg-background-alt px-2.5 py-1 rounded-lg">
              当子服务未指定独立接入点时，自动使用此配置
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-main mb-1 flex items-center gap-1">
                <Key size={14} className="text-primary" /> 全局默认 API Key
              </label>
              <div className="relative flex items-center">
                <input
                  type={showKeys ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasApiKey ? `${maskedKey}（留空保持不变）` : "请输入全局 API Key"}
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-primary text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKeys(!showKeys)}
                  className="absolute right-3 text-xs text-text-muted hover:text-text-main font-medium"
                >
                  {showKeys ? "隐藏" : "显示"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-main mb-1 flex items-center gap-1">
                <Globe size={14} className="text-primary" /> 全局默认 API Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.siliconflow.cn/v1"
                className="w-full px-3.5 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-primary text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* 2. 各能力模型配置 */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <Cpu className="text-secondary" size={18} /> 2. 各 AI 服务能力模型名称与独立接入点
            </h3>

            <button
              type="button"
              onClick={() => setEnablePerServiceProviders(!enablePerServiceProviders)}
              className={`text-xs px-3 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 transition-colors ${
                enablePerServiceProviders
                  ? "bg-primary/10 border-primary text-primary font-bold"
                  : "bg-background-alt border-gray-200 text-text-muted hover:text-text-main"
              }`}
            >
              <SlidersHorizontal size={14} />
              {enablePerServiceProviders ? "多接入点模式已开启 (点击折叠)" : "开启按能力分配独立接入商 (如 DeepSeek+OpenAI)"}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Card A: 文本对话服务 */}
            <div className="p-4 rounded-2xl border border-gray-100 bg-background-alt/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-main flex items-center gap-1.5">
                  <Bot size={16} className="text-primary" aria-hidden="true" /> 文本对话服务
                </span>
                <span className="text-[10px] text-text-muted">Chat / Agent</span>
              </div>

              <div>
                <label className="block text-[11px] text-text-muted mb-1">模型名称 (Chat Model)</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="deepseek-ai/DeepSeek-V3"
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-xs font-mono bg-white"
                />
              </div>

              {enablePerServiceProviders && (
                <div className="pt-2 border-t border-gray-200/60 space-y-2">
                  <span className="text-[10px] text-primary font-bold block">独立接入配置 (留空则继承全局)</span>
                  <div>
                    <input
                      type="text"
                      value={chatBaseUrl}
                      onChange={(e) => setChatBaseUrl(e.target.value)}
                      placeholder="专有 Base URL (如 api.deepseek.com)"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] font-mono bg-white"
                    />
                  </div>
                  <div>
                    <input
                      type={showKeys ? "text" : "password"}
                      value={chatApiKey}
                      onChange={(e) => setChatApiKey(e.target.value)}
                      placeholder={hasChatApiKey ? `专有 Key: ${chatMaskedKey}` : "专有 API Key (留空继承全局)"}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] bg-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Card B: 多模态识图服务 */}
            <div className="p-4 rounded-2xl border border-gray-100 bg-background-alt/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-main flex items-center gap-1.5">
                  <Image size={16} className="text-secondary" aria-hidden="true" /> 多模态识图服务
                </span>
                <span className="text-[10px] text-text-muted">Vision / OCR</span>
              </div>

              <div>
                <label className="block text-[11px] text-text-muted mb-1">模型名称 (Vision Model)</label>
                <input
                  type="text"
                  value={visionModel}
                  onChange={(e) => setVisionModel(e.target.value)}
                  placeholder="Qwen/Qwen2.5-VL-72B-Instruct"
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-xs font-mono bg-white"
                />
              </div>

              {enablePerServiceProviders && (
                <div className="pt-2 border-t border-gray-200/60 space-y-2">
                  <span className="text-[10px] text-secondary font-bold block">独立接入配置 (留空则继承全局)</span>
                  <div>
                    <input
                      type="text"
                      value={visionBaseUrl}
                      onChange={(e) => setVisionBaseUrl(e.target.value)}
                      placeholder="专有 Base URL (如 dashscope.aliyuncs.com)"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] font-mono bg-white"
                    />
                  </div>
                  <div>
                    <input
                      type={showKeys ? "text" : "password"}
                      value={visionApiKey}
                      onChange={(e) => setVisionApiKey(e.target.value)}
                      placeholder={hasVisionApiKey ? `专有 Key: ${visionMaskedKey}` : "专有 API Key (留空继承全局)"}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] bg-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Card C: 语音识别服务 */}
            <div className="p-4 rounded-2xl border border-gray-100 bg-background-alt/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-main flex items-center gap-1.5">
                  <Mic size={16} className="text-orange-500" aria-hidden="true" /> 语音识别服务
                </span>
                <span className="text-[10px] text-text-muted">ASR / Whisper</span>
              </div>

              <div>
                <label className="block text-[11px] text-text-muted mb-1">模型名称 (ASR Model)</label>
                <input
                  type="text"
                  value={asrModel}
                  onChange={(e) => setAsrModel(e.target.value)}
                  placeholder="FunAudioLLM/SenseVoiceSmall"
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-xs font-mono bg-white"
                />
              </div>

              {enablePerServiceProviders && (
                <div className="pt-2 border-t border-gray-200/60 space-y-2">
                  <span className="text-[10px] text-orange-500 font-bold block">独立接入配置 (留空则继承全局)</span>
                  <div>
                    <input
                      type="text"
                      value={asrBaseUrl}
                      onChange={(e) => setAsrBaseUrl(e.target.value)}
                      placeholder="专有 Base URL (如 api.openai.com)"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] font-mono bg-white"
                    />
                  </div>
                  <div>
                    <input
                      type={showKeys ? "text" : "password"}
                      value={asrApiKey}
                      onChange={(e) => setAsrApiKey(e.target.value)}
                      placeholder={hasAsrApiKey ? `专有 Key: ${asrMaskedKey}` : "专有 API Key (留空继承全局)"}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 focus:outline-none focus:border-primary text-[11px] bg-white"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. 人设提示词 */}
        <div className="pt-2 space-y-2">
          <label className="block text-sm font-medium text-text-main flex items-center gap-1.5">
            <Bot size={16} className="text-primary" /> 3. 食语 AI 助手人设系统提示词 (System Prompt)
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            maxLength={12_000}
            placeholder="定义食语的角色、语气、专业边界和服务方式"
            className="w-full resize-y rounded-2xl border border-gray-200 px-4 py-3 font-mono text-xs leading-5 focus:border-primary focus:outline-none"
          />
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{isSystemPromptCustomized ? "正在使用后台自定义人设" : "正在使用系统默认人设"}；用户动态数据与系统规则由后端自动拼接。</span>
            <span>{systemPrompt.length}/12000</span>
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="flex flex-wrap items-center justify-between pt-4 border-t border-gray-100 gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTestConnection("global")}
              disabled={testing}
              className="px-4 py-2 rounded-xl border border-primary text-primary hover:bg-green-50 font-bold text-xs flex items-center gap-1.5 transition-colors active:scale-95 disabled:opacity-50"
            >
              {testing ? <RefreshCw className="animate-spin" size={14} /> : <Zap size={14} />}
              测试对话服务连通性
            </button>
            {enablePerServiceProviders && (
              <>
                <button
                  type="button"
                  onClick={() => handleTestConnection("vision")}
                  disabled={testing}
                  className="px-4 py-2 rounded-xl border border-secondary text-secondary hover:bg-emerald-50 font-bold text-xs flex items-center gap-1.5 transition-colors active:scale-95 disabled:opacity-50"
                >
                  <Zap size={14} /> 测试识图服务
                </button>
                <button
                  type="button"
                  onClick={() => handleTestConnection("asr")}
                  disabled={testing}
                  className="px-4 py-2 rounded-xl border border-orange-500 text-orange-500 hover:bg-orange-50 font-bold text-xs flex items-center gap-1.5 transition-colors active:scale-95 disabled:opacity-50"
                >
                  <Zap size={14} /> 测试语音识别
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-2xl bg-primary text-white hover:bg-primary-dark font-bold text-sm flex items-center gap-2 transition-all active:scale-95 shadow-sm disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "保存中..." : "保存全站 AI 接入配置"}
          </button>
        </div>

        {/* 测试结果展示 */}
        {testResult && (
          <div
            className={`p-4 rounded-2xl border ${
              testResult.success ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
            } text-sm flex items-start gap-3`}
          >
            {testResult.success ? <CheckCircle2 size={20} className="mt-0.5" /> : <AlertCircle size={20} className="mt-0.5" />}
            <div>
              <div className="font-bold">
                {testResult.success ? `连接测试成功 (延迟 ${testResult.latency}ms)` : "连接测试失败"}
              </div>
              <div className="mt-1 font-mono text-xs opacity-90">{testResult.message}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
