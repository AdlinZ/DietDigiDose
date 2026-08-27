import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/src/legacy";
import * as Network from "expo-network";
import * as Speech from "expo-speech";
import { Base64 } from "js-base64";
import { Platform } from "react-native";

import type { ApiFetch } from "@/services/api/client";
import { voicePackApi, type VoicePackManifest } from "@/services/api/ai";

const PACK_ROOT = Platform.OS === "web" || !FileSystem.documentDirectory
  ? null
  : `${FileSystem.documentDirectory}voice-packs-v1/`;
const AUDIO_CACHE_ROOT = Platform.OS === "web" || !FileSystem.cacheDirectory
  ? null
  : `${FileSystem.cacheDirectory}voice-output-v1/`;
const STATE_KEY = "voice-pack-state-v1";
const CACHE_INDEX_KEY = "voice-audio-cache-index-v1";
const MAX_AUDIO_CACHE_BYTES = 80 * 1024 * 1024;
const VOICE_CACHE_SCHEMA = 1;

export type VoiceSource = "local" | "server" | "system";
export type VoicePreference = "automatic" | "system-only";
export type VoicePackState = {
  installed: VoicePackManifest | null;
  preference: VoicePreference;
  benchmark: null | { modelLoadMs: number; firstAudioMs: number; realtimeFactor: number; peakMemoryMb: number | null; passed: boolean; measuredAt: string };
  pausedDownload: null | { manifest: VoicePackManifest; resourcePath: string; completedBytes: number; resumeData: string };
};
type AudioCacheRow = { uri: string; bytes: number; accessedAt: number; sensitive: boolean; userScope: string };

const defaultState: VoicePackState = { installed: null, preference: "automatic", benchmark: null, pausedDownload: null };
let activeDownload: FileSystem.DownloadResumable | null = null;
let activeDownloadContext: VoicePackState["pausedDownload"] = null;
let activeSound: Audio.Sound | null = null;
let playbackGeneration = 0;
let localSession: null | { key: string; session: any; vocabulary: Record<string, number>; manifest: VoicePackManifest } = null;

async function ensureDirectory(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
}

function requireNativeRoot(root: string | null) {
  if (!root) throw new Error("当前平台不支持本地音色文件存储");
  return root;
}

export async function getVoicePackState(): Promise<VoicePackState> {
  try {
    const stored = JSON.parse(await AsyncStorage.getItem(STATE_KEY) || "null") as VoicePackState | null;
    return stored ? { ...defaultState, ...stored } : defaultState;
  } catch {
    return defaultState;
  }
}

async function saveState(state: VoicePackState) {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  return state;
}

export async function setVoicePreference(preference: VoicePreference) {
  return saveState({ ...await getVoicePackState(), preference });
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256File(uri: string) {
  const bytes = await new File(uri).bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return bytesToHex(new Uint8Array(digest));
}

function safeResourcePath(path: string) {
  if (!/^(?!_)\w[\w./-]{0,199}$/i.test(path) || path.includes("..")) throw new Error("音色包资源路径无效");
  return path;
}

export async function installVoicePack(
  manifest: VoicePackManifest,
  options: { allowCellular?: boolean; onProgress?: (progress: number) => void } = {},
) {
  if (Platform.OS === "web") throw new Error("Web 暂不支持本地 ONNX 音色包，请使用云端或系统语音");
  const packRoot = requireNativeRoot(PACK_ROOT);
  const network = await Network.getNetworkStateAsync();
  if (network.isConnected === false || network.isInternetReachable === false) throw new Error("当前没有可用网络");
  if (!options.allowCellular && network.type === Network.NetworkStateType.CELLULAR) throw new Error("默认仅允许 Wi-Fi 下载；确认使用移动网络后再试");
  await ensureDirectory(packRoot);
  const staging = `${packRoot}.staging-${manifest.voiceId}-${manifest.version}/`;
  const finalDirectory = `${packRoot}${manifest.voiceId}/${manifest.version}/`;
  const priorState = await getVoicePackState();
  const resume = priorState.pausedDownload?.manifest.voiceId === manifest.voiceId
    && priorState.pausedDownload.manifest.version === manifest.version
    ? priorState.pausedDownload
    : null;
  if (!resume) await FileSystem.deleteAsync(staging, { idempotent: true });
  await ensureDirectory(staging);
  const totalBytes = manifest.resources.reduce((sum, resource) => sum + resource.bytes, 0);
  let completedBytes = 0;
  try {
    for (const resource of manifest.resources) {
      safeResourcePath(resource.path);
      if (!resource.url.startsWith("https://")) throw new Error("音色包只允许从 HTTPS 受控地址下载");
      const destination = `${staging}${resource.path}`;
      await ensureDirectory(destination.slice(0, destination.lastIndexOf("/") + 1));
      const existing = await FileSystem.getInfoAsync(destination);
      if (existing.exists && await sha256File(destination) === resource.sha256.toLowerCase()) {
        completedBytes += resource.bytes;
        continue;
      }
      activeDownloadContext = { manifest, resourcePath: resource.path, completedBytes, resumeData: "" };
      activeDownload = FileSystem.createDownloadResumable(resource.url, destination, {}, ({ totalBytesWritten }) => {
        options.onProgress?.(Math.min(1, (completedBytes + totalBytesWritten) / Math.max(1, totalBytes)));
      }, resume?.resourcePath === resource.path ? resume.resumeData : undefined);
      const result = await activeDownload.downloadAsync();
      activeDownload = null;
      activeDownloadContext = null;
      if (!result?.uri) throw new Error(`下载失败：${resource.path}`);
      const actualSha256 = await sha256File(result.uri);
      if (actualSha256.toLowerCase() !== resource.sha256.toLowerCase()) throw new Error(`摘要校验失败：${resource.path}`);
      completedBytes += resource.bytes;
      options.onProgress?.(Math.min(1, completedBytes / Math.max(1, totalBytes)));
    }
    await FileSystem.writeAsStringAsync(`${staging}manifest.json`, JSON.stringify(manifest));
    await ensureDirectory(`${packRoot}${manifest.voiceId}/`);
    await FileSystem.deleteAsync(finalDirectory, { idempotent: true });
    await FileSystem.moveAsync({ from: staging, to: finalDirectory });
    const previous = await getVoicePackState();
    await saveState({ installed: manifest, preference: previous.preference, benchmark: null, pausedDownload: null });
    localSession = null;
    if (previous.installed && (previous.installed.voiceId !== manifest.voiceId || previous.installed.version !== manifest.version)) {
      await FileSystem.deleteAsync(`${packRoot}${previous.installed.voiceId}/${previous.installed.version}/`, { idempotent: true });
    }
    return manifest;
  } catch (error) {
    const paused = (await getVoicePackState()).pausedDownload;
    if (paused?.manifest.voiceId !== manifest.voiceId || paused.manifest.version !== manifest.version) {
      await FileSystem.deleteAsync(staging, { idempotent: true });
    }
    activeDownload = null;
    activeDownloadContext = null;
    throw error;
  }
}

export async function pauseVoicePackDownload() {
  if (!activeDownload || !activeDownloadContext) return false;
  const paused = await activeDownload.pauseAsync();
  const state = await getVoicePackState();
  await saveState({ ...state, pausedDownload: { ...activeDownloadContext, resumeData: paused.resumeData || "" } });
  activeDownload = null;
  activeDownloadContext = null;
  return true;
}

export async function resumeVoicePackDownload(options: { allowCellular?: boolean; onProgress?: (progress: number) => void } = {}) {
  const paused = (await getVoicePackState()).pausedDownload;
  if (!paused) throw new Error("没有可恢复的音色包下载");
  return installVoicePack(paused.manifest, options);
}

export async function deleteVoicePack(deleteGeneratedAudio = false) {
  const state = await getVoicePackState();
  await stopVoiceOutput();
  if (state.installed && PACK_ROOT) await FileSystem.deleteAsync(`${PACK_ROOT}${state.installed.voiceId}/`, { idempotent: true });
  localSession = null;
  if (deleteGeneratedAudio) await purgeVoiceAudioCache();
  return saveState({ ...state, installed: null, benchmark: null, pausedDownload: null });
}

function encodePcmWav(samples: Float32Array, sampleRate: number) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return bytes;
}

async function localEngine() {
  const state = await getVoicePackState();
  const manifest = state.installed;
  if (!manifest || Platform.OS === "web") throw new Error("本地音色包未安装");
  const packRoot = requireNativeRoot(PACK_ROOT);
  const key = `${manifest.voiceId}@${manifest.version}`;
  if (localSession?.key === key) return localSession;
  const directory = `${packRoot}${manifest.voiceId}/${manifest.version}/`;
  const [{ InferenceSession }, vocabularyText] = await Promise.all([
    import("onnxruntime-react-native"),
    FileSystem.readAsStringAsync(`${directory}${safeResourcePath(manifest.model.vocabularyPath)}`),
  ]);
  const started = Date.now();
  const session = await InferenceSession.create(`${directory}${safeResourcePath(manifest.model.path)}`);
  localSession = { key, session, vocabulary: JSON.parse(vocabularyText), manifest };
  const current = await getVoicePackState();
  if (!current.benchmark) await saveState({ ...current, benchmark: {
    modelLoadMs: Date.now() - started, firstAudioMs: 0, realtimeFactor: 0, peakMemoryMb: null, passed: true, measuredAt: new Date().toISOString(),
  } });
  return localSession;
}

function tokenize(text: string, vocabulary: Record<string, number>) {
  const unknown = vocabulary["<unk>"] ?? 0;
  const start = vocabulary["<bos>"];
  const end = vocabulary["<eos>"];
  return [
    ...(start === undefined ? [] : [start]),
    ...[...text.normalize("NFKC")].map((character) => vocabulary[character] ?? unknown),
    ...(end === undefined ? [] : [end]),
  ];
}

async function synthesizeLocal(text: string) {
  const engine = await localEngine();
  const { Tensor } = await import("onnxruntime-react-native");
  const ids = tokenize(text, engine.vocabulary);
  const names = engine.manifest.model.inputNames;
  const feeds: Record<string, any> = {
    [names.tokens]: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    [names.lengths]: new Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
  };
  if (names.scales) feeds[names.scales] = new Tensor("float32", Float32Array.from([0.667, 1, 0.8]), [3]);
  if (names.speakerId) feeds[names.speakerId] = new Tensor("int64", BigInt64Array.from([BigInt(engine.manifest.model.speakerId || 0)]), [1]);
  const started = Date.now();
  const result = await engine.session.run(feeds);
  const output = result[engine.manifest.model.outputName || engine.session.outputNames[0]];
  if (!output || !(output.data instanceof Float32Array)) throw new Error("本地音色模型输出格式无效");
  const samples = output.data as Float32Array;
  const firstAudioMs = Date.now() - started;
  const durationMs = samples.length / engine.manifest.sampleRate * 1_000;
  const state = await getVoicePackState();
  const realtimeFactor = firstAudioMs / Math.max(1, durationMs);
  await saveState({ ...state, benchmark: {
    modelLoadMs: state.benchmark?.modelLoadMs || 0, firstAudioMs, realtimeFactor,
    peakMemoryMb: null, passed: firstAudioMs <= 2_500 && realtimeFactor <= 1.2, measuredAt: new Date().toISOString(),
  } });
  if (firstAudioMs > 5_000 || realtimeFactor > 1.5) throw new Error("设备本地语音性能不足");
  return encodePcmWav(samples, engine.manifest.sampleRate);
}

async function cacheIndex(): Promise<Record<string, AudioCacheRow>> {
  try { return JSON.parse(await AsyncStorage.getItem(CACHE_INDEX_KEY) || "{}"); } catch { return {}; }
}

async function trimAudioCache(index: Record<string, AudioCacheRow>) {
  let total = Object.values(index).reduce((sum, row) => sum + row.bytes, 0);
  for (const [key, row] of Object.entries(index).sort((left, right) => left[1].accessedAt - right[1].accessedAt)) {
    if (total <= MAX_AUDIO_CACHE_BYTES) break;
    await FileSystem.deleteAsync(row.uri, { idempotent: true });
    total -= row.bytes;
    delete index[key];
  }
  await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
}

async function cachedAudio(text: string, userId: number | undefined, sensitive: boolean, producer: () => Promise<{ bytes: Uint8Array; extension: string }>) {
  const audioCacheRoot = requireNativeRoot(AUDIO_CACHE_ROOT);
  await ensureDirectory(audioCacheRoot);
  const state = await getVoicePackState();
  const scope = sensitive ? `user:${userId || "anonymous"}` : "public";
  const key = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify({ schema: VOICE_CACHE_SCHEMA, voice: state.installed ? `${state.installed.voiceId}@${state.installed.version}` : "server", text, rate: 1, style: "default", scope }));
  const index = await cacheIndex();
  const existing = index[key];
  if (existing && (await FileSystem.getInfoAsync(existing.uri)).exists) {
    existing.accessedAt = Date.now();
    await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    return existing.uri;
  }
  const output = await producer();
  const uri = `${audioCacheRoot}${key}.${output.extension}`;
  await FileSystem.writeAsStringAsync(uri, Base64.fromUint8Array(output.bytes), { encoding: "base64" });
  index[key] = { uri, bytes: output.bytes.byteLength, accessedAt: Date.now(), sensitive, userScope: scope };
  await trimAudioCache(index);
  return uri;
}

async function playUri(uri: string, generation: number) {
  if (generation !== playbackGeneration) return;
  if (activeSound) await activeSound.unloadAsync().catch(() => undefined);
  const created = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  activeSound = created.sound;
  await new Promise<void>((resolve) => created.sound.setOnPlaybackStatusUpdate((status) => {
    if (status.isLoaded && status.didJustFinish) resolve();
  }));
  await created.sound.unloadAsync().catch(() => undefined);
  if (activeSound === created.sound) activeSound = null;
}

function sentences(text: string) {
  return text.match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map((item) => item.trim()).filter(Boolean) || [text];
}

export async function speakWithVoiceFallback(apiFetch: ApiFetch, text: string, options: { userId?: number; sensitive?: boolean } = {}): Promise<VoiceSource> {
  const generation = ++playbackGeneration;
  await stopActiveSoundOnly();
  const state = await getVoicePackState();
  if (state.preference !== "system-only" && state.installed && state.benchmark?.passed !== false) {
    try {
      for (const sentence of sentences(text)) {
        if (generation !== playbackGeneration) return "local";
        const uri = await cachedAudio(sentence, options.userId, Boolean(options.sensitive), async () => ({ bytes: await synthesizeLocal(sentence), extension: "wav" }));
        await playUri(uri, generation);
      }
      return "local";
    } catch {
      // Continue to the configured server TTS.
    }
  }
  if (state.preference !== "system-only") {
    try {
      const response = await voicePackApi.synthesize(apiFetch, text);
      const uri = Platform.OS === "web"
        ? `data:${response.mimeType || "audio/mpeg"};base64,${response.audioBase64}`
        : await cachedAudio(text, options.userId, Boolean(options.sensitive), async () => ({
          bytes: Base64.toUint8Array(response.audioBase64), extension: "mp3",
        }));
      await playUri(uri, generation);
      return "server";
    } catch {
      // The system voice is the final, offline-capable fallback.
    }
  }
  if (generation === playbackGeneration) Speech.speak(text, { language: "zh-CN", rate: 1 });
  return "system";
}

async function stopActiveSoundOnly() {
  if (activeSound) {
    await activeSound.stopAsync().catch(() => undefined);
    await activeSound.unloadAsync().catch(() => undefined);
    activeSound = null;
  }
  await Speech.stop();
}

export async function stopVoiceOutput() {
  playbackGeneration += 1;
  await stopActiveSoundOnly();
}

export async function purgeVoiceAudioCache() {
  if (AUDIO_CACHE_ROOT) await FileSystem.deleteAsync(AUDIO_CACHE_ROOT, { idempotent: true });
  await AsyncStorage.removeItem(CACHE_INDEX_KEY);
}
