import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { S } from "../theme";

export function Button({ title, onPress, disabled, busy, kind = "primary", style }: {
  title: string; onPress: () => void; disabled?: boolean; busy?: boolean; kind?: "primary" | "ghost"; style?: ViewStyle;
}) {
  const primary = kind === "primary";
  const text = primary ? S.btnText : S.ghostText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.btn, primary ? S.btn : S.ghost,
        (disabled || busy) && { opacity: 0.4 }, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }, style]}
    >
      {busy ? <ActivityIndicator color={text.color} />
        : <Text style={text}>{S.btnUpper ? title.toUpperCase() : title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { height: 54, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
});
