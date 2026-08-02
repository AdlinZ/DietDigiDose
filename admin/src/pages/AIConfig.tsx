import { useEffect, useState } from "react";
import { Bot, Key, Globe, Cpu, Zap, Save, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import api from "../services/api";

const PROVIDER_PRESETS = [
  {
    name: "硅基流动 (SiliconFlow)",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    visionModel: "Qwen/Qwen2.5-VL-72B-Instruct",
    desc: "支持免费额度、高并发、含 DeepSeek 与 Qwen 多模态 Vision 强模型",
  },
  {
    name: "阿里云百炼 (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-max",
    visionModel: "qwen-vl-max",
    desc: "响应极快，国内服务器优选",
  },
  {
    name: "DeepSeek 官方 API",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    visionModel: "deepseek-chat",
    desc: "DeepSeek 官方平台",
  },
  {
    name: "OpenAI 官方 API",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    visionModel: "gpt-4o-mini",
    desc: "OpenAI 国际服务商",
  },
];

export default function AIConfig() {
  const [apiKey, setApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.siliconflow.cn/v1");
  const [model, setModel] = useState("deepseek-ai/DeepSeek-V3");
  const [visionModel, setVisionModel] = useState("Qwen/Qwen2.5-VL-72B-Instruct");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency?: number } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/admin/ai-config");
      setApiKey("");
      setMaskedKey(data.maskedKey || "");
      setHasApiKey(Boolean(data.hasApiKey));
      if (data.baseUrl) setBaseUrl(data.baseUrl);
      if (data.model) setModel(data.model);
      if (data.visionModel) setVisionModel(data.visionModel);
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
    setStatusMsg(`已应用【${preset.name}】的基准配置，请输入该平台 API Key`);
    setTimeout(() => setStatusMsg(""), 3000);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put("/admin/ai-config", {
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrl,
        model,
        visionModel,
      });
      if (apiKey.trim()) {
        setApiKey("");
        setHasApiKey(true);
        setMaskedKey(`${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`);
      }
      setStatusMsg("AI 服务配置保存成功！后续客户端请求将自动生效");
      setTimeout(() => setStatusMsg(""), 4000);
    } catch (err: any) {
      alert("保存失败: " + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const { data } = await api.post("/admin/ai-config/test", {
        apiKey,
        baseUrl,
        model,
      });
      if (data.success) {
        setTestResult({
          success: true,
          message: `连接成功！模型回应：“${data.reply}”`,
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
            <Bot className="text-primary" size={28} /> AI 大模型服务配置
          </h2>
          <p className="text-sm text-text-muted mt-1">
            配置并管理食光烙记系统的核心 AI 模型提供商与 API Key。无需修改环境变量，即刻实时生效。
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
          <Zap className="text-yellow-500" size={18} /> 快捷预设服务商
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PROVIDER_PRESETS.map((preset, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleApplyPreset(preset)}
              className="text-left p-4 rounded-2xl border border-gray-100 bg-background-alt hover:border-primary hover:bg-green-50/50 transition-all group"
            >
              <div className="font-bold text-sm text-text-main group-hover:text-primary">{preset.name}</div>
              <div className="text-xs text-text-muted mt-1">{preset.desc}</div>
              <div className="text-[11px] text-gray-400 font-mono mt-2 truncate">Base: {preset.baseUrl}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 配置表单 */}
      <div className="bg-white p-6 rounded-[24px] shadow-sm space-y-5">
        <h3 className="text-base font-bold text-text-main border-b border-gray-100 pb-3">
          服务接入参数配置
        </h3>

        {/* API Key */}
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5 flex items-center gap-1.5">
            <Key size={16} className="text-primary" /> API Key (密钥)
          </label>
          <div className="relative flex items-center">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? `${maskedKey}（留空保持不变）` : "请输入新的 API Key"}
              className="w-full px-4 py-2.5 rounded-2xl border border-gray-200 focus:outline-none focus:border-primary text-sm pr-20"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 text-xs text-text-muted hover:text-text-main font-medium"
            >
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            {hasApiKey ? `已配置 ${maskedKey}，后端不会向浏览器返回完整密钥` : "尚未配置 API Key"}
          </p>
        </div>

        {/* Base URL */}
        <div>
          <label className="block text-sm font-medium text-text-main mb-1.5 flex items-center gap-1.5">
            <Globe size={16} className="text-primary" /> API Base URL (接口端点)
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full px-4 py-2.5 rounded-2xl border border-gray-200 focus:outline-none focus:border-primary text-sm font-mono"
          />
        </div>

        {/* Models */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5 flex items-center gap-1.5">
              <Cpu size={16} className="text-primary" /> 文本对话大模型 (Chat Model)
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="deepseek-ai/DeepSeek-V3"
              className="w-full px-4 py-2.5 rounded-2xl border border-gray-200 focus:outline-none focus:border-primary text-sm font-mono"
            />
            <p className="text-xs text-text-muted mt-1">用于 AI 营养大厨答疑与做饭语音交互</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-main mb-1.5 flex items-center gap-1.5">
              <Cpu size={16} className="text-primary" /> 多模态识图模型 (Vision Model)
            </label>
            <input
              type="text"
              value={visionModel}
              onChange={(e) => setVisionModel(e.target.value)}
              placeholder="Qwen/Qwen2.5-VL-72B-Instruct"
              className="w-full px-4 py-2.5 rounded-2xl border border-gray-200 focus:outline-none focus:border-primary text-sm font-mono"
            />
            <p className="text-xs text-text-muted mt-1">用于拍照识菜估热量与小票自动入库</p>
          </div>
        </div>

        {/* 操作按钮区 */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing}
            className="px-5 py-2.5 rounded-2xl border border-primary text-primary hover:bg-green-50 font-bold text-sm flex items-center gap-2 transition-colors active:scale-95 disabled:opacity-50"
          >
            {testing ? <RefreshCw className="animate-spin" size={16} /> : <Zap size={16} />}
            {testing ? "测试连通性中..." : "⚡ 连通性测试"}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-2xl bg-primary text-white hover:bg-primary-dark font-bold text-sm flex items-center gap-2 transition-all active:scale-95 shadow-sm disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "保存中..." : "保存 AI 配置"}
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
