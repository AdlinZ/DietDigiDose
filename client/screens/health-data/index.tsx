import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useFocusEffect } from "expo-router";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { FontAwesome6 } from "@expo/vector-icons";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || "http://localhost:9091";
const EMTPY_VALUE_PLACEHOLDER = "—";
const FALLBACK_STATUS = new Set([400, 422]);

interface HealthLog {
  id: number;
  recorded_date: string;
  weight?: number | null;
  height_cm?: number | null;
  body_fat?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  water_ml?: number | null;
  resting_heart_rate?: number | null;
  blood_pressure_systolic?: number | null;
  blood_pressure_diastolic?: number | null;
  sleep_hours?: number | null;
  bmi?: number | null;
}

type HealthMetricKey = keyof Omit<HealthLog, "id" | "recorded_date">;
type HealthMetricConfig = {
  key: HealthMetricKey;
  label: string;
  unit: string;
};

const DETAIL_METRICS: HealthMetricConfig[] = [
  { key: "weight", label: "体重", unit: "kg" },
  { key: "height_cm", label: "身高", unit: "cm" },
  { key: "body_fat", label: "体脂率", unit: "%" },
  { key: "waist_cm", label: "腰围", unit: "cm" },
  { key: "hip_cm", label: "臀围", unit: "cm" },
  { key: "water_ml", label: "饮水", unit: "ml" },
  { key: "resting_heart_rate", label: "静息心率", unit: "bpm" },
  { key: "sleep_hours", label: "睡眠", unit: "h" },
  { key: "blood_pressure_systolic", label: "收缩压", unit: "mmHg" },
  { key: "blood_pressure_diastolic", label: "舒张压", unit: "mmHg" },
];

export default function HealthDataScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();

  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [weight, setWeight] = useState("62.5");
  const [heightCm, setHeightCm] = useState("170");
  const [bodyFat, setBodyFat] = useState("18.5");
  const [waistCm, setWaistCm] = useState("74");
  const [hipCm, setHipCm] = useState("96");
  const [waterMl, setWaterMl] = useState("1650");
  const [heartRate, setHeartRate] = useState("72");
  const [sysBP, setSysBP] = useState("118");
  const [diaBP, setDiaBP] = useState("76");
  const [sleepHours, setSleepHours] = useState("7.5");

  const today = new Date().toISOString().split("T")[0];

  const fetchHealthData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setRequestError(null);
      const res = await authFetch(`${API_BASE}/api/v1/health-data`);
      if (res.ok) {
        const data = await res.json();
        const normalized = Array.isArray(data)
          ? data.map((item) =>
              normalizeHealthLog(typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}),
            )
          : [];
        setLogs(normalized);
      } else {
        const msg = await parseApiError(res);
        setRequestError(`获取身体数据失败：${msg}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络异常";
      setRequestError(`获取身体数据失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, authFetch]);

  useFocusEffect(
    useCallback(() => {
      fetchHealthData();
    }, [fetchHealthData])
  );

  const toDateNum = (value: number | null | undefined, fallback: number) =>
    value === null || value === undefined ? fallback : value;

  const toNum = (input: string) => {
    const n = Number(input);
    return Number.isFinite(n) ? n : null;
  };

  const normalizeHealthLog = (raw: Record<string, unknown>): HealthLog => {
    const pick = (value: unknown): number | null => toNum(typeof value === "number" ? String(value) : value == null ? "" : String(value));

    const id = typeof raw.id === "number" ? raw.id : typeof raw.id === "string" ? Number(raw.id) : Date.now();
    const recordedDate =
      typeof raw.recorded_date === "string"
        ? raw.recorded_date
        : typeof raw.date === "string"
          ? raw.date
          : "";

    const weight = pick((raw as { weight?: unknown; weight_kg?: unknown }).weight ?? (raw as { weight_kg?: unknown }).weight_kg);
    const heightCm = pick((raw as { height_cm?: unknown; height?: unknown; heightCm?: unknown }).height_cm ?? (raw as { height?: unknown }).height ?? (raw as { heightCm?: unknown }).heightCm);
    const bodyFat = pick((raw as { body_fat?: unknown; bodyFat?: unknown }).body_fat ?? (raw as { bodyFat?: unknown }).bodyFat);
    const waistCm = pick((raw as { waist_cm?: unknown; waist?: unknown; waistCm?: unknown }).waist_cm ?? (raw as { waist?: unknown }).waist ?? (raw as { waistCm?: unknown }).waistCm);
    const hipCm = pick((raw as { hip_cm?: unknown; hip?: unknown; hipCm?: unknown }).hip_cm ?? (raw as { hip?: unknown }).hip ?? (raw as { hipCm?: unknown }).hipCm);
    const waterMl = pick((raw as { water_ml?: unknown; water?: unknown; waterMl?: unknown }).water_ml ?? (raw as { water?: unknown }).water ?? (raw as { waterMl?: unknown }).waterMl);
    const restingHeartRate = pick(
      (raw as { resting_heart_rate?: unknown; heartRate?: unknown }).resting_heart_rate ??
        (raw as { heartRate?: unknown }).heartRate,
    );
    const bloodPressureSystolic = pick(
      (raw as { blood_pressure_systolic?: unknown; systolic?: unknown; systolic_bp?: unknown }).blood_pressure_systolic ??
        (raw as { systolic?: unknown }).systolic ??
        (raw as { systolic_bp?: unknown }).systolic_bp,
    );
    const bloodPressureDiastolic = pick(
      (raw as { blood_pressure_diastolic?: unknown; diastolic?: unknown; diastolic_bp?: unknown }).blood_pressure_diastolic ??
        (raw as { diastolic?: unknown }).diastolic ??
        (raw as { diastolic_bp?: unknown }).diastolic_bp,
    );
    const sleepHours = pick((raw as { sleep_hours?: unknown; sleep?: unknown }).sleep_hours ?? (raw as { sleep?: unknown }).sleep);
    const bmi = pick(
      (raw as { bmi?: unknown; body_mass_index?: unknown }).bmi ??
        (raw as { body_mass_index?: unknown }).body_mass_index,
    );

    const computedBmi =
      bmi ??
      (weight != null && heightCm != null && heightCm > 0 ? Number((weight / Math.pow(heightCm / 100, 2)).toFixed(1)) : null);

    return {
      id: Number.isFinite(id) ? id : Date.now(),
      recorded_date: recordedDate,
      weight,
      height_cm: heightCm,
      body_fat: bodyFat,
      waist_cm: waistCm,
      hip_cm: hipCm,
      water_ml: waterMl,
      resting_heart_rate: restingHeartRate,
      blood_pressure_systolic: bloodPressureSystolic,
      blood_pressure_diastolic: bloodPressureDiastolic,
      sleep_hours: sleepHours,
      bmi: computedBmi,
    };
  };

  const formatNumber = (value: number | null | undefined, fixed = 1): string => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return EMTPY_VALUE_PLACEHOLDER;
    }
    return Number.isInteger(value) ? `${value}` : value.toFixed(fixed);
  };

  const formatMetric = (value: number | null | undefined, unit: string) =>
    `${formatNumber(value)}${value == null ? "" : unit ? ` ${unit}` : ""}`;

  const formatDate = (dateStr: string) => dateStr.split("-").slice(1).join("/");

  const sanitizePayload = (payload: Record<string, unknown>) => {
    const cleaned: Record<string, unknown> = {};
    Object.keys(payload).forEach((key) => {
      const value = payload[key];
      if (value === null || value === undefined || value === "") {
        return;
      }
      cleaned[key] = value;
    });
    return cleaned;
  };

  const postHealthPayload = async (payload: Record<string, unknown>): Promise<boolean> => {
    const corePayload = sanitizePayload({
      recorded_date: payload.recorded_date,
      weight: payload.weight,
      body_fat: payload.body_fat,
      water_ml: payload.water_ml,
    });

    const hasExtendedFields = Object.keys(payload).some(
      (key) => !["recorded_date", "weight", "body_fat", "water_ml"].includes(key)
    );

    const response = await authFetch(`${API_BASE}/api/v1/health-data/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return true;
    }

    if (hasExtendedFields && FALLBACK_STATUS.has(response.status)) {
      const fallbackRes = await authFetch(`${API_BASE}/api/v1/health-data/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corePayload),
      });

      if (fallbackRes.ok) {
        return true;
      }
      setRequestError(await parseApiError(fallbackRes, "服务端参数不兼容，已回退为基础字段仍失败"));
      return false;
    }

    setRequestError(await parseApiError(response, "身体指标保存失败"));
    return false;
  };

  const latestLog = logs.reduce<HealthLog | null>((acc, log) => {
    if (!acc) return log;
    return log.recorded_date >= acc.recorded_date ? log : acc;
  }, null);
  const todayLog: HealthLog = logs.find((l) => l.recorded_date === today) ?? latestLog ?? ({ id: 0, recorded_date: today } as HealthLog);
  const todayWeight = todayLog.weight;
  const todayHeight = todayLog.height_cm;
  const todayBodyFat = todayLog.body_fat;
  const todayWaist = todayLog.waist_cm;
  const todayHip = todayLog.hip_cm;
  const todayWater = todayLog.water_ml;
  const todayHeart = todayLog.resting_heart_rate;
  const todaySys = todayLog.blood_pressure_systolic;
  const todayDia = todayLog.blood_pressure_diastolic;
  const todaySleep = todayLog.sleep_hours;
  const todayBmi = todayLog.bmi ?? (todayWeight && todayHeight ? Number((todayWeight / Math.pow(todayHeight / 100, 2)).toFixed(1)) : null);

  const latestWeightLogs = [...logs]
    .sort((a, b) => new Date(a.recorded_date).getTime() - new Date(b.recorded_date).getTime())
    .slice(-7);

  const targetWater = 2000;
  const waterPercent = Math.min(Math.round((toDateNum(todayWater, 0) / targetWater) * 100), 100);

  const openEditorWithToday = () => {
    setWeight(todayWeight != null ? String(todayWeight) : "");
    setHeightCm(todayHeight != null ? String(todayHeight) : "");
    setBodyFat(todayBodyFat != null ? String(todayBodyFat) : "");
    setWaistCm(todayWaist != null ? String(todayWaist) : "");
    setHipCm(todayHip != null ? String(todayHip) : "");
    setWaterMl(todayWater != null ? String(todayWater) : "");
    setHeartRate(todayHeart != null ? String(todayHeart) : "");
    setSysBP(todaySys != null ? String(todaySys) : "");
    setDiaBP(todayDia != null ? String(todayDia) : "");
    setSleepHours(todaySleep != null ? String(todaySleep) : "");
    setModalVisible(true);
  };

  const handleAddWater = async (amount: number) => {
    if (!isAuthenticated) return;
    const currentWater = toDateNum(todayWater, 0);
    const newWater = currentWater + amount;
    const newPayload = sanitizePayload({
      recorded_date: today,
      water_ml: newWater,
      weight: toDateNum(todayWeight, 62.5),
      height_cm: toDateNum(todayHeight, 170),
      body_fat: toDateNum(todayBodyFat, 18.5),
      waist_cm: toDateNum(todayWaist, 74),
      hip_cm: toDateNum(todayHip, 96),
      resting_heart_rate: toDateNum(todayHeart, 72),
      blood_pressure_systolic: toDateNum(todaySys, 118),
      blood_pressure_diastolic: toDateNum(todayDia, 76),
      sleep_hours: todaySleep ?? 7.5,
    });

    try {
      const ok = await postHealthPayload(newPayload);
      if (ok) {
        setRequestError(null);
        fetchHealthData();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败";
      setRequestError(msg);
    }
  };

  const handleSaveLog = async () => {
    try {
      setSubmitting(true);
      setRequestError(null);
      const payload = sanitizePayload({
        recorded_date: today,
        weight: toNum(weight),
        height_cm: toNum(heightCm),
        body_fat: toNum(bodyFat),
        waist_cm: toNum(waistCm),
        hip_cm: toNum(hipCm),
        water_ml: toNum(waterMl),
        resting_heart_rate: toNum(heartRate),
        blood_pressure_systolic: toNum(sysBP),
        blood_pressure_diastolic: toNum(diaBP),
        sleep_hours: toNum(sleepHours),
      });

      const ok = await postHealthPayload(payload);
      if (ok) {
        setModalVisible(false);
        setRequestError(null);
        fetchHealthData();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存失败";
      setRequestError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const renderMetricGrid = () => (
    <>
      <View className="flex-row gap-3 mb-4">
        <MetricCard icon="weight-scale" iconColor="#2D6A4F" label="当前体重" value={`${formatNumber(todayWeight)} kg`} />
        <MetricCard icon="percent" iconColor="#D4A276" label="体脂率" value={`${formatNumber(todayBodyFat)} %`} />
      </View>
      <View className="flex-row gap-3 mb-4">
        <MetricCard icon="user-check" iconColor="#2D6A4F" label="BMI" value={todayBmi ? `${todayBmi} kg/m²` : EMTPY_VALUE_PLACEHOLDER} />
        <MetricCard icon="heart-pulse" iconColor="#E07A5F" label="静息心率" value={`${formatNumber(todayHeart)} bpm`} />
      </View>
      <View className="flex-row gap-3 mb-4">
        <MetricCard icon="chart-line" iconColor="#2D6A4F" label="腰围 / 臀围" value={`${formatNumber(todayWaist)} / ${formatNumber(todayHip)} cm`} />
        <MetricCard icon="moon" iconColor="#D4A276" label="睡眠 / 血压" value={`${formatNumber(todaySleep)} h • ${formatNumber(todaySys)}/${formatNumber(todayDia)}`} />
      </View>
    </>
  );

  if (!isAuthenticated) {
    return (
      <Screen backgroundColor="#FDF8F0">
        <View className="flex-1 items-center justify-center p-6">
          <FontAwesome6 name="heart-pulse" size={36} color="#2D6A4F" />
          <Text className="text-xl font-bold text-[#3D3229] mt-3">身体健康档案</Text>
          <Text className="text-sm text-[#8B7D6B] text-center mt-2 mb-6">
            登录后可记录体重、体脂、腰臀围、血压、心率与饮水数据。
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/login")}
            className="bg-[#2D6A4F] px-8 py-3.5 rounded-2xl active:opacity-90"
          >
            <Text className="text-sm font-bold text-white">立即登录</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, paddingTop: 16 }}
      >
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-2xl font-black text-[#3D3229]">身体指标</Text>
            <Text className="text-xs text-[#8B7D6B] mt-0.5">记录详细身体数据，追踪趋势变化</Text>
          </View>
          <TouchableOpacity
            onPress={openEditorWithToday}
            className="bg-[#2D6A4F] px-3.5 py-2 rounded-2xl flex-row items-center gap-1.5 shadow-sm"
          >
            <FontAwesome6 name="pen" size={12} color="#FFF" />
            <Text className="text-xs font-bold text-white">测身体</Text>
          </TouchableOpacity>
        </View>

        {requestError ? (
          <View className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3">
            <Text className="text-xs text-red-700">{requestError}</Text>
          </View>
        ) : null}

        <View className="bg-white p-5 rounded-[28px] border border-[#EBE3D5] shadow-sm mb-4">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <View className="w-9 h-9 rounded-full bg-sky-500/15 items-center justify-center">
                <FontAwesome6 name="droplet" size={16} color="#0EA5E9" />
              </View>
              <View>
                <Text className="text-base font-bold text-[#3D3229]">今日水份补给</Text>
                <Text className="text-xs text-[#8B7D6B]">目标 2000 ml</Text>
              </View>
            </View>

            <Text className="text-xl font-black text-[#0EA5E9]">
              {formatNumber(todayWater)} <Text className="text-xs font-normal text-[#8B7D6B]">ml</Text>
            </Text>
          </View>

          <View className="w-full bg-[#F5EFE6] h-3 rounded-full overflow-hidden my-2">
            <View
              className="bg-sky-500 h-full rounded-full"
              style={{ width: `${waterPercent}%` }}
            />
          </View>

          <View className="flex-row gap-2 mt-3">
            <TouchableOpacity
              onPress={() => handleAddWater(250)}
              className="flex-1 bg-sky-50 py-2.5 rounded-xl border border-sky-200 items-center flex-row justify-center gap-1.5 active:opacity-80"
            >
              <FontAwesome6 name="glass-water" size={13} color="#0EA5E9" />
              <Text className="text-xs font-bold text-[#0EA5E9]">+250ml</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleAddWater(500)}
              className="flex-1 bg-sky-50 py-2.5 rounded-xl border border-sky-200 items-center flex-row justify-center gap-1.5 active:opacity-80"
            >
              <FontAwesome6 name="bottle-water" size={13} color="#0EA5E9" />
              <Text className="text-xs font-bold text-[#0EA5E9]">+500ml</Text>
            </TouchableOpacity>
          </View>
        </View>

        {renderMetricGrid()}

        <View className="bg-white p-5 rounded-[28px] border border-[#EBE3D5] shadow-sm">
          <Text className="text-base font-bold text-[#3D3229] mb-4">近 7 天体重趋势</Text>
          {loading ? (
            <ActivityIndicator color="#2D6A4F" />
          ) : latestWeightLogs.length === 0 ? (
            <Text className="text-sm text-[#8B7D6B]">暂无数据，先记录一次体重</Text>
          ) : (
            <View className="flex-row items-end justify-between h-36 pt-4 px-2">
              {latestWeightLogs.map((log) => {
                const safeWeight = log.weight;
                const heightPercent = safeWeight === undefined || safeWeight === null
                  ? 0
                  : Math.min(Math.max(((safeWeight - 40) / 40) * 100, 16), 100);
                return (
                  <View key={log.id} className="items-center flex-1">
                    <Text className="text-[10px] font-bold text-[#2D6A4F] mb-1">{formatNumber(safeWeight)}</Text>
                    <View className="w-5 bg-[#F5EFE6] rounded-t-lg h-24 justify-end overflow-hidden">
                      <View
                        className="bg-[#2D6A4F] w-full rounded-t-lg"
                        style={{ height: `${safeWeight === null || safeWeight === undefined ? 12 : heightPercent}%` }}
                      />
                    </View>
                    <Text className="text-[10px] text-[#8B7D6B] mt-1.5">{formatDate(log.recorded_date)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View className="bg-white p-5 rounded-[28px] border border-[#EBE3D5] shadow-sm mt-4">
          <Text className="text-base font-bold text-[#3D3229] mb-4">详细记录列表</Text>
          {loading ? (
            <ActivityIndicator color="#2D6A4F" />
          ) : logs.length === 0 ? (
            <Text className="text-sm text-[#8B7D6B]">暂无历史数据，点击“测身体”开始记录</Text>
          ) : (
            <View className="gap-3">
              {logs
                .slice(-10)
                .reverse()
                .map((log) => (
                  <View
                    key={log.id}
                    className="border border-[#F0EADD] rounded-2xl p-3 bg-[#FAF8F4]"
                  >
                    <View className="flex-row justify-between items-center mb-2">
                      <Text className="font-black text-[#3D3229]">{log.recorded_date}</Text>
                      <Text className="text-xs text-[#8B7D6B]">记录 ID：{log.id}</Text>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      {DETAIL_METRICS.map((metric) => {
                        const value = log[metric.key];
                        return (
                          <View
                            key={`${log.id}-${metric.key}`}
                            className="rounded-xl border border-[#E9DDC7] bg-white px-2.5 py-1.5 min-w-[120px] flex-1"
                          >
                            <Text className="text-[10px] text-[#8B7D6B]">{metric.label}</Text>
                            <Text className="text-sm font-bold text-[#3D3229]">
                              {formatMetric(value as number | null | undefined, metric.unit)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-[32px] p-6">
            <View className="flex-row items-center justify-between mb-4 border-b border-[#F5EFE6] pb-3">
              <Text className="text-lg font-black text-[#3D3229]">更新身体数据</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            <View className="space-y-4">
              <TextInputBlock label="体重 (kg)" value={weight} onChangeText={setWeight} />
              <TextInputBlock label="身高 (cm)" value={heightCm} onChangeText={setHeightCm} />
              <TextInputBlock label="体脂率 (%)" value={bodyFat} onChangeText={setBodyFat} />
              <TextInputBlock label="腰围 (cm)" value={waistCm} onChangeText={setWaistCm} />
              <TextInputBlock label="臀围 (cm)" value={hipCm} onChangeText={setHipCm} />
              <TextInputBlock label="饮水 (ml)" value={waterMl} onChangeText={setWaterMl} />
              <TextInputBlock label="静息心率 (bpm)" value={heartRate} onChangeText={setHeartRate} />

              <View>
                <Text className="text-xs font-bold text-[#8B7D6B] mb-1">血压（收缩压 / 舒张压）</Text>
                <View className="flex-row gap-2">
                  <TextInput
                    value={sysBP}
                    onChangeText={setSysBP}
                    keyboardType="numeric"
                    placeholder="收缩压"
                    placeholderTextColor="#8B7D6B"
                    className="flex-1 bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                  />
                  <TextInput
                    value={diaBP}
                    onChangeText={setDiaBP}
                    keyboardType="numeric"
                    placeholder="舒张压"
                    placeholderTextColor="#8B7D6B"
                    className="flex-1 bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                  />
                </View>
              </View>

              <TextInputBlock label="睡眠 (小时)" value={sleepHours} onChangeText={setSleepHours} />

              <TouchableOpacity
                onPress={handleSaveLog}
                disabled={submitting}
                className="bg-[#2D6A4F] py-4 rounded-2xl items-center mt-4 shadow-sm"
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text className="text-base font-bold text-white">打卡保存</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function TextInputBlock({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View>
      <Text className="text-xs font-bold text-[#8B7D6B] mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="numeric"
        className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
      />
    </View>
  );
}

function MetricCard({
  icon,
  iconColor,
  label,
  value,
}: {
  icon: string;
  iconColor: string;
  label: string;
  value: string;
}) {
  return (
    <View className="flex-1 bg-white p-4.5 rounded-[24px] border border-[#EBE3D5] shadow-sm">
      <View className="flex-row items-center gap-2 mb-2">
        <FontAwesome6 name={icon as any} size={14} color={iconColor} />
        <Text className="text-xs font-bold text-[#8B7D6B]">{label}</Text>
      </View>
      <Text className="text-xl font-black text-[#3D3229]">{value}</Text>
    </View>
  );
}

async function parseApiError(response: Response, fallback = "请求失败") {
  try {
    const data = await response.json();
    if (typeof data?.error === "string") return data.error;
    if (typeof data?.message === "string") return data.message;
    return fallback;
  } catch {
    return fallback;
  }
}
