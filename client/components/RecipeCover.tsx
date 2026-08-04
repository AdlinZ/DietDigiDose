import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";

interface RecipeCoverProps {
  uri?: string | null;
  className: string;
  placeholderClassName: string;
  iconSize?: number;
}

export function RecipeCover({
  uri,
  className,
  placeholderClassName,
  iconSize = 30,
}: RecipeCoverProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const failed = Boolean(uri && failedUri === uri);

  if (!uri || failed) {
    return (
      <View className={placeholderClassName}>
        <FontAwesome6 name="utensils" size={iconSize} color="#2D6A4F" />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      className={className}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={180}
      onError={() => setFailedUri(uri || null)}
    />
  );
}
