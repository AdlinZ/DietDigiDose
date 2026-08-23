import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import { BlurView } from "expo-blur";

export function GlassSurface({ children, style, ...props }: ViewProps) {
  return (
    <View {...props} style={[{ overflow: "hidden" }, style]}>
      <BlurView
        pointerEvents="none"
        tint="systemMaterialLight"
        intensity={62}
        {...(Platform.OS === "android" ? { experimentalBlurMethod: "dimezisBlurView" as const } : {})}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(255,255,255,0.12)" }]} />
      {children}
    </View>
  );
}
