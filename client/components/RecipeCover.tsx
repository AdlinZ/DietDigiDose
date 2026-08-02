import { useState } from "react";
import { Image, View } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";

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
      resizeMode="cover"
      onError={() => setFailedUri(uri || null)}
    />
  );
}
