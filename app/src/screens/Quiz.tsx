import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { api, type Gallery, type Round } from "../api";
import { Button } from "../components/Button";
import type { Identity } from "../identity";
import { StatusBar } from "expo-status-bar";
import { C, S, kicker, titleFace } from "../theme";

/** Flow A.2-3 (M2): 5 rounds of 4, tap every one you like (at least one), back + progress. */
export function Quiz({ me, onDone }: { me: Identity; onDone: (g: Gallery) => void }) {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const tile = (width - 24 * 2 - 12) / 2;

  useEffect(() => {
    api.quiz().then((q) => setRounds(q.rounds)).catch((e) => setErr(e.message));
  }, []);

  if (!rounds) {
    return (
      <View style={styles.center}>
        {err ? <Text style={styles.err}>{err}</Text> : <ActivityIndicator color={C.text} />}
      </View>
    );
  }
  const r = rounds[i];
  const chosen = picks[i] ?? [];
  const toggle = (id: string) =>
    setPicks((p) => ({ ...p, [i]: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] }));

  async function next() {
    if (i < rounds!.length - 1) return setI(i + 1);
    setBusy(true);
    setErr(null);
    try {
      const all = Object.values(picks).flat();
      onDone(await api.saveGallery(me.id, all));
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.progress}>
        {rounds.map((_, k) => <View key={k} style={[styles.pip, k <= i && { backgroundColor: C.gold }]} />)}
      </View>
      <StatusBar style={S.statusBar} />
      <Text style={styles.round}>{S.copy.room} {i + 1} of {rounds.length}</Text>
      <Text style={styles.ask}>{S.copy.ask}</Text>
      <View style={styles.grid}>
        {r.artworks.map((a, k) => {
          const on = chosen.includes(a.id);
          return (
            <Pressable key={a.id} onPress={() => toggle(a.id)}
              style={[S.frame, { width: tile, height: tile * 1.15 }, on && S.frameOn,
                S.frameTilt !== 0 && { transform: [{ rotate: `${(k % 2 ? 1 : -1) * S.frameTilt}deg` }] }]}>
              <View style={styles.canvas}>
                <Image source={{ uri: a.image }} style={[StyleSheet.absoluteFill, !on && chosen.length > 0 && { opacity: S.offOpacity }]} resizeMode="cover" />
              </View>
              {on && !!S.tape && <View style={[styles.tape, { backgroundColor: S.tape }]} />}
              {on && <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      <Text style={styles.count}>{S.copy.count(chosen.length)}</Text>
      {err && <Text style={styles.err}>{err}</Text>}
      <View style={styles.nav}>
        <Button title="Back" kind="ghost" onPress={() => setI(i - 1)} disabled={i === 0 || busy} style={{ flex: 1 }} />
        <Button title={i === rounds.length - 1 ? "Build my gallery" : "Next"} onPress={next}
          disabled={chosen.length === 0} busy={busy} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 30 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  progress: { flexDirection: "row", gap: 6, marginBottom: 18 },
  pip: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.line },
  round: { ...kicker, color: C.gold, textTransform: "uppercase" },
  ask: { ...titleFace, color: C.text, fontSize: 30, lineHeight: 36, marginTop: 6, marginBottom: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  // the frame itself (brass, instant print or plastic) comes from the skin: S.frame / S.frameOn
  canvas: { flex: 1, overflow: "hidden", borderRadius: S.canvasRadius, backgroundColor: C.panel2 },
  tape: { position: "absolute", alignSelf: "center", top: -10, width: 64, height: 20, transform: [{ rotate: "-4deg" }] },
  check: { position: "absolute", right: -8, top: -8, width: 28, height: 28, borderRadius: 14, backgroundColor: C.gold, alignItems: "center", justifyContent: "center" },
  checkText: { color: C.ink, fontWeight: "800", fontSize: 15 },
  count: { color: C.dim, fontSize: 18, fontFamily: S.hand, textAlign: "center", marginBottom: 14 },
  nav: { flexDirection: "row", gap: 12 },
  err: { color: C.danger, fontSize: 13, marginBottom: 8, textAlign: "center" },
});
