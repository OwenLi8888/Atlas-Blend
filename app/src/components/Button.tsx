import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { C } from "../theme";

export function Button({ title, onPress, disabled, busy, kind = "primary", style }: {
  title: string; onPress: () => void; disabled?: boolean; busy?: boolean; kind?: "primary" | "ghost"; style?: ViewStyle;
}) {
  const primary = kind === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.btn, primary ? styles.primary : styles.ghost,
        (disabled || busy) && { opacity: 0.4 }, pressed && { opacity: 0.75 }, style]}
    >
      {busy ? <ActivityIndicator color={primary ? C.bg : C.text} />
        : <Text style={[styles.text, { color: primary ? C.bg : C.text }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  primary: { backgroundColor: C.text },
  ghost: { borderWidth: 1, borderColor: C.line },
  text: { fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
});
