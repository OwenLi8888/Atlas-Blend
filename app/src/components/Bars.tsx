import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { C, VARS, VAR_LABEL } from "../theme";

export interface BarSeries { label: string; color: string; values: Record<string, number> }

/** Six variable bars. One series for a gallery card; A / B / painting on the reveal and panel. */
export function Bars({ series, animate = false, compact = false }: { series: BarSeries[]; animate?: boolean; compact?: boolean }) {
  return (
    <View style={{ gap: compact ? 6 : 10 }}>
      {series.length > 1 && (
        <View style={styles.legend}>
          {series.map((s) => (
            <View key={s.label} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: s.color }]} />
              <Text style={styles.legendText}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}
      {VARS.map((k) => (
        <View key={k}>
          <View style={styles.row}>
            <Text style={styles.name}>{VAR_LABEL[k][0]}</Text>
            <Text style={styles.ends}>{VAR_LABEL[k][1]} / {VAR_LABEL[k][2]}</Text>
          </View>
          {series.map((s) => (
            <Bar key={s.label} value={s.values?.[k] ?? 0} color={s.color} animate={animate} thin={series.length > 1} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Bar({ value, color, animate, thin }: { value: number; color: string; animate: boolean; thin: boolean }) {
  const w = useRef(new Animated.Value(animate ? 0 : value)).current;
  useEffect(() => {
    if (animate) Animated.timing(w, { toValue: value, duration: 1400, useNativeDriver: false }).start();
    else w.setValue(value);
  }, [value, animate, w]);
  return (
    <View style={[styles.track, { height: thin ? 5 : 8, marginTop: thin ? 3 : 4 }]}>
      <Animated.View style={[styles.fill, { backgroundColor: color, width: w.interpolate({ inputRange: [0, 1], outputRange: ["3%", "100%"] }) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  name: { color: C.text, fontSize: 13, fontWeight: "600" },
  ends: { color: C.faint, fontSize: 11 },
  track: { backgroundColor: C.line, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
  legend: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { color: C.dim, fontSize: 12 },
});
