import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Panel } from "../api";
import { C, serif } from "../theme";
import { Bars } from "./Bars";

interface Todo { content: string; status: string }

/** The researched side panel: combined groups, era span, stats, qualities, why you matched, history. */
export function SidePanel({ panel, todos, steps, names, bars, score }: {
  panel: Panel | null; todos: Todo[]; steps: string[]; names: { a: string; b: string };
  bars: { a?: Record<string, number>; b?: Record<string, number>; painting?: Record<string, number> };
  score: number | null;
}) {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 60 }}>
      <View style={styles.header}>
        <Text style={styles.kicker}>BLEND SCORE</Text>
        <Text style={styles.score}>{score ?? "--"}</Text>
      </View>

      {!panel && (
        <View style={styles.box}>
          <Text style={styles.h}>Researching your blend</Text>
          {todos.map((t, i) => (
            <Text key={i} style={[styles.todo, t.status === "completed" && styles.done]}>
              {t.status === "completed" ? "✓" : t.status === "in_progress" ? "…" : "○"}  {t.content}
            </Text>
          ))}
          {steps.length > 0 && <Text style={styles.step}>{steps[steps.length - 1]}</Text>}
        </View>
      )}

      {panel && (
        <>
          <View style={{ gap: 6 }}>
            <Text style={styles.h}>Why you matched</Text>
            <Text style={styles.body}>{panel.why_matched}</Text>
          </View>

          <View style={{ gap: 10 }}>
            <Text style={styles.h}>Combined from</Text>
            {panel.combined_from.map((g) => (
              <View key={g.group_id} style={styles.group}>
                <View style={styles.groupHead}>
                  <Text style={styles.groupLabel}>{g.label}</Text>
                  <Text style={[styles.whose, { color: g.kind === "shared" ? C.gold : g.kind === "signature_a" ? C.a : C.b }]}>
                    {g.kind === "shared" ? "shared" : `${g.whose}'s signature`}
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {g.artworks.map((a) => (
                    <Image key={a.id} source={{ uri: a.image }} style={[styles.gthumb,
                      { borderColor: a.owner === "both" ? C.gold : a.owner === names.a ? C.a : C.b }]} />
                  ))}
                </ScrollView>
                <Text style={styles.small}>{g.year_span[0]} to {g.year_span[1]}</Text>
              </View>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.era}>
              <Text style={styles.kicker}>ERA SPAN</Text>
              <Text style={styles.eraText}>{panel.era_span.start} to {panel.era_span.end}</Text>
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.h}>Notable qualities</Text>
            {panel.notable_qualities.map((q, i) => <Text key={i} style={styles.body}>•  {q}</Text>)}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.h}>Stats</Text>
            <Bars compact series={[
              { label: names.a, color: C.a, values: bars.a ?? {} },
              { label: names.b, color: C.b, values: bars.b ?? {} },
              { label: "Painting", color: C.gold, values: bars.painting ?? {} },
            ]} />
          </View>

          <View style={{ gap: 10 }}>
            <Text style={styles.h}>Source history</Text>
            {panel.source_history.map((h) => (
              <Pressable key={h.artwork_id} style={styles.hist} onPress={() => Linking.openURL(h.link)}>
                <Image source={{ uri: h.image }} style={styles.hthumb} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.histTitle}>{h.title}</Text>
                  <Text style={styles.small}>{h.artist} · {h.year} · {h.medium}</Text>
                  {!!h.history && <Text style={styles.histLine}>{h.history}</Text>}
                  <Text style={styles.link}>Art Institute of Chicago record ↗</Text>
                </View>
              </Pressable>
            ))}
          </View>

          {panel.agent && (
            <Text style={styles.footer}>
              Researched by {panel.agent.mode.startsWith("deepagents") ? "a deepagents research agent" : "the grounded fallback"} in {panel.agent.seconds}s.
              Every date and medium is checked against the catalog.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.panel },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  kicker: { color: C.faint, fontSize: 11, letterSpacing: 1.6, fontWeight: "700" },
  score: { color: C.gold, fontSize: 44, fontFamily: serif },
  h: { color: C.text, fontSize: 17, fontFamily: serif },
  body: { color: C.dim, fontSize: 14, lineHeight: 21 },
  small: { color: C.faint, fontSize: 12 },
  box: { backgroundColor: C.panel2, borderRadius: 14, padding: 14, gap: 6 },
  todo: { color: C.dim, fontSize: 13 },
  done: { color: C.faint, textDecorationLine: "line-through" },
  step: { color: C.gold, fontSize: 13, marginTop: 4 },
  group: { backgroundColor: C.panel2, borderRadius: 14, padding: 12, gap: 8 },
  groupHead: { flexDirection: "row", justifyContent: "space-between" },
  groupLabel: { color: C.text, fontSize: 14, fontWeight: "600" },
  whose: { fontSize: 12, fontWeight: "600" },
  gthumb: { width: 54, height: 54, borderRadius: 8, borderWidth: 2 },
  row: { flexDirection: "row", gap: 12 },
  era: { flex: 1, backgroundColor: C.panel2, borderRadius: 14, padding: 12, gap: 2 },
  eraText: { color: C.text, fontSize: 20, fontFamily: serif },
  hist: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  hthumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: C.panel2 },
  histTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  histLine: { color: C.dim, fontSize: 12, lineHeight: 17 },
  link: { color: C.b, fontSize: 12 },
  footer: { color: C.faint, fontSize: 11, lineHeight: 16 },
});
