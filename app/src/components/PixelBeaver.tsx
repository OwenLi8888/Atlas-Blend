import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View, type ViewStyle } from "react-native";

// 16x16 sprite. . empty, k outline, b fur, c belly, t teeth, p palette tail, r and y paint dabs.
const SPRITE = [
  "................", "...kk......kk...", "..kbbkkkkkkbbk..", "..kbbbbbbbbbbk..", ".kbbbbbbbbbbbbk.", ".kbbkbbbbbbkbbk.",
  ".kbbbbbkkbbbbbk.", ".kbbbcckkccbbbk.", ".kbbbccttccbbbk.", "..kbbcccccbbk...", "..kbbcccccbbkkk.", ".kbbbcccccbbkppk",
  ".kbbbbcccbbbkrpk", "..kbbbbbbbbkpypk", "..kkbkkkkbkkkkk.", "...kk....kk.....",
];
// LCD inks: four greens, dark to light
const INK: Record<string, string> = { k: "#23401C", b: "#5F8A4B", c: "#9CC088", t: "#E9F5DC", p: "#7FA56A", r: "#23401C", y: "#E9F5DC" };

/** Each row as runs of one colour, so the sprite is about 90 views instead of 256. */
const RUNS = SPRITE.map((line) => {
  const runs: { x: number; w: number; ch: string }[] = [];
  for (let x = 0; x < line.length; x++) {
    const last = runs[runs.length - 1];
    if (last && last.ch === line[x]) last.w++;
    else runs.push({ x, w: 1, ch: line[x] });
  }
  return runs.filter((r) => INK[r.ch]);
});

/** The pixel beaver, bobbing in two steps like a handheld pet sprite. `px` is one sprite pixel. */
export function PixelBeaver({ px = 8 }: { px?: number }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const hop = (to: number) => Animated.timing(y, { toValue: to, duration: 1, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([Animated.delay(550), hop(-px), Animated.delay(550), hop(0)]));
    loop.start();
    return () => loop.stop();
  }, [y, px]);
  return (
    <Animated.View style={{ width: px * 16, height: px * 16, transform: [{ translateY: y }] }}>
      {RUNS.map((runs, row) => runs.map((r) => (
        <View key={`${row}-${r.x}`} style={{ position: "absolute", left: r.x * px, top: row * px, width: r.w * px, height: px, backgroundColor: INK[r.ch] }} />
      )))}
    </Animated.View>
  );
}

/** The handheld's LCD window: the beaver, plus an optional line of screen text. `row` lays them side by side. */
export function Lcd({ text, px = 8, row = false, style }: { text?: string; px?: number; row?: boolean; style?: ViewStyle }) {
  return (
    <View style={[styles.lcd, row && styles.row, style]}>
      <PixelBeaver px={px} />
      {!!text && <Text style={[styles.text, row && { flex: 1 }]}>{text}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  lcd: {
    backgroundColor: "#B9D7A3", borderWidth: 4, borderColor: "#2C1F4A", borderRadius: 22, padding: 14, alignItems: "center", gap: 8,
    shadowColor: "#2C1F4A", shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 6 },
  },
  row: { flexDirection: "row", paddingVertical: 8, gap: 12 },
  text: { color: "#23401C", fontSize: 12, fontWeight: "700", letterSpacing: 1, fontFamily: "Courier New" },
});
