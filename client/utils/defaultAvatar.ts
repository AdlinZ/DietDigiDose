import type { ImageSourcePropType } from "react-native";

export const DEFAULT_AVATARS = [
  require("@/assets/avatars/sprout.png"),
  require("@/assets/avatars/citrus.png"),
  require("@/assets/avatars/grain.png"),
  require("@/assets/avatars/mushroom.png"),
  require("@/assets/avatars/salad.png"),
  require("@/assets/avatars/berry.png"),
] as const;

const PRESET_PREFIX = "preset-avatar:";
const LEGACY_DEFAULT_AVATARS = new Set([
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80",
]);

const stableAvatarIndex = (identity?: string | number | null) => {
  const value = String(identity ?? "shiguang");
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash % DEFAULT_AVATARS.length;
};

export const getPresetAvatarValue = (index: number) =>
  `${PRESET_PREFIX}${index % DEFAULT_AVATARS.length}`;

export const getAvatarSource = (
  avatarUrl?: string | null,
  identity?: string | number | null,
): ImageSourcePropType => {
  if (avatarUrl?.startsWith(PRESET_PREFIX)) {
    const presetIndex = Number(avatarUrl.slice(PRESET_PREFIX.length));
    if (Number.isInteger(presetIndex) && presetIndex >= 0) {
      return DEFAULT_AVATARS[presetIndex % DEFAULT_AVATARS.length];
    }
  }

  if (avatarUrl && !LEGACY_DEFAULT_AVATARS.has(avatarUrl)) {
    return { uri: avatarUrl };
  }

  return DEFAULT_AVATARS[stableAvatarIndex(identity)];
};
