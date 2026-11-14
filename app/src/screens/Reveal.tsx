import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { api, type BlendEvent, type Panel } from "../api";
import { Bars } from "../components/Bars";
import { Button } from "../components/Button";
import { Globe, type GlobeHandle, type GlobeTile } from "../components/Globe";
import { SidePanel } from "../components/SidePanel";
import { API_URL } from "../config";
import { C, serif } from "../theme";

type Phase = "comparing" | "merge" | "fold" | "video" | "panel" | "error";
const MERGE_MIN_MS = 6500; // pairs glow + score count-up before the fold

/** Live state of one blend, built from the job's event stream (polled; RN has no EventSource). */
function useBlend(id: string) {
  const [state, setState] = useState({
    matched: null as any, videoUrl: null as string | null, panel: null as Panel | null,
    todos: [] as { content: string; status: string }[], steps: [] as string[], paintPct: 0,
    done: false, error: null as string | null, panelError: null as string | null,
  });
  useEffect(() => {
    let after = 0, alive = true, timer: ReturnType<typeof setTimeout>;
    const apply = (e: BlendEvent) => setState((s) => {
      switch (e.type) {
        case "matched": return { ...s, matched: e.data };
        case "video": return { ...s, videoUrl: e.data.video_url };
        case "panel": return { ...s, panel: e.data };
        case "todos": return { ...s, todos: e.data.todos ?? [] };
        case "agent": return { ...s, steps: [...s.steps, e.data.detail].slice(-6) };
        case "painting": return { ...s, paintPct: e.data.pct ?? s.paintPct };
        case "panel_error": return { ...s, panelError: e.data.message };
        case "video_error": case "error": return { ...s, error: e.data.message };
        case "done": return { ...s, done: true };
        default: return s;
      }
    });
    const poll = async () => {
      try {
        const r = await api.events(id, after);
        r.events.forEach((e) => { after = Math.max(after, e.seq); apply(e); });
        if (r.events.some((e) => e.type === "done" || e.type === "error")) return;
      } catch { /* keep polling through blips */ }
      if (alive) timer = setTimeout(poll, 500);
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);
  return state;
}

export function Reveal({ blendId, onDone }: { blendId: string; onDone: () => void }) {
  const b = useBlend(blendId);
  const { height } = useWindowDimensions();
  const globe = useRef<GlobeHandle>(null);
  const [phase, setPhase] = useState<Phase>("comparing");
  const [score, setScore] = useState(0);
  const mergeAt = useRef(0);
  const slide = useRef(new Animated.Value(height)).current;
  const fade = useRef(new Animated.Value(0)).current;

  const [who, setWho] = useState({ a: "A", b: "B" });
  useEffect(() => { api.blend(blendId).then((r) => setWho(r.names)).catch(() => {}); }, [blendId]);

  const tiles = useMemo<GlobeTile[]>(() => {
    if (!b.matched) return [];
    const A: string[] = b.matched.gallery_a.artwork_ids, B: string[] = b.matched.gallery_b.artwork_ids;
    const ids = [...new Set([...A, ...B])];
    return ids.map((id) => {
      const inA = A.includes(id), inB = B.includes(id);
      return { id, img: `${API_URL}/catalog/images/${id}.jpg`, tint: inA ? C.a : C.b, tint2: inA && inB ? C.b : undefined };
    });
  }, [b.matched]);

  // matched -> merged sphere, pairs glow, score counts up
  useEffect(() => {
    if (!b.matched || phase !== "comparing") return;
    setPhase("merge");
    mergeAt.current = Date.now();
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    const t1 = setTimeout(() => globe.current?.glowPairs(b.matched.pairs.map((p: any) => [p.a, p.b])), 1500);
    const target = b.matched.score as number;
    const t0 = Date.now();
    const iv = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0 - 1200) / 1800);
      setScore(Math.max(0, Math.round(target * (1 - Math.pow(1 - Math.max(0, k), 3)))));
      if (k >= 1) clearInterval(iv);
    }, 40);
    return () => { clearTimeout(t1); clearInterval(iv); };
  }, [b.matched]); // eslint-disable-line react-hooks/exhaustive-deps

  // video ready + enough reveal time -> fold into the center -> play
  useEffect(() => {
    if (phase !== "merge" || !b.videoUrl) return;
    const wait = Math.max(0, MERGE_MIN_MS - (Date.now() - mergeAt.current));
    const t = setTimeout(() => {
      setPhase("fold");
      globe.current?.fold();
      Animated.timing(fade, { toValue: 0, duration: 900, useNativeDriver: true }).start();
      setTimeout(() => setPhase("video"), 1300);
    }, wait);
    return () => clearTimeout(t);
  }, [phase, b.videoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (b.error && phase !== "video" && phase !== "panel") setPhase("error"); }, [b.error, phase]);

  const showPanel = () => {
    setPhase("panel");
    Animated.spring(slide, { toValue: height * 0.34, useNativeDriver: true, bounciness: 4 }).start();
  };

  if (phase === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.h}>This blend hit a snag</Text>
        <Text style={styles.dim}>{b.error}</Text>
        <Button title="Back to gallery" onPress={onDone} style={{ marginTop: 20, alignSelf: "stretch" }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {(phase === "comparing" || phase === "merge" || phase === "fold") && (
        <View style={{ flex: 1 }}>
          <Globe ref={globe} tiles={tiles} style={{ position: "absolute", left: 0, right: 0, top: 0, height: height * 0.55 }} />
          {phase === "comparing" && (
            <View style={styles.comparing}>
              <Text style={styles.h}>Comparing whole galleries…</Text>
              <Text style={styles.dim}>Six variables plus CLIP subject matching</Text>
            </View>
          )}
          <Animated.View style={[styles.scoreBox, { top: height * 0.5, opacity: fade }]}>
            <View style={styles.scoreRow}>
              <Text style={[styles.name, { color: C.a }]}>{who.a}</Text>
              <View style={{ alignItems: "center" }}>
                <Text style={styles.kicker}>BLEND SCORE</Text>
                <Text style={styles.score}>{score}</Text>
              </View>
              <Text style={[styles.name, { color: C.b }]}>{who.b}</Text>
            </View>
            {b.matched && (
              <Bars animate compact series={[
                { label: who.a, color: C.a, values: b.matched.gallery_a.bars },
                { label: who.b, color: C.b, values: b.matched.gallery_b.bars },
              ]} />
            )}
            {b.matched && <Text style={styles.pairs}>{b.matched.pairs.length} matched pair{b.matched.pairs.length === 1 ? "" : "s"} glowing · painting in {b.matched.medium}{!b.videoUrl ? ` · ${Math.round(b.paintPct * 100)}%` : ""}</Text>}
          </Animated.View>
        </View>
      )}

      {(phase === "video" || phase === "panel") && b.videoUrl && (
        <PaintingVideo url={b.videoUrl} compact={phase === "panel"} height={height} onEnd={() => phase === "video" && showPanel()} />
      )}
      {phase === "video" && (
        <Pressable style={styles.skip} onPress={showPanel}><Text style={styles.skipText}>Why we matched ›</Text></Pressable>
      )}

      <Animated.View style={[styles.sheet, { height: height * 0.66, transform: [{ translateY: slide }] }]}>
        <View style={styles.grab} />
        <SidePanel panel={b.panel} todos={b.todos} steps={b.steps} names={who} score={b.matched?.score ?? null}
          bars={{ a: b.matched?.gallery_a?.bars, b: b.matched?.gallery_b?.bars, painting: b.matched?.painting_bars }} />
        {phase === "panel" && (
          <View style={styles.saved}>
            <Text style={styles.savedText}>{b.done ? "Saved to both galleries" : "Saving…"}</Text>
            <Button title="Done" onPress={onDone} style={{ height: 44, paddingHorizontal: 20 }} />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

function PaintingVideo({ url, compact, height, onEnd }: { url: string; compact: boolean; height: number; onEnd: () => void }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.play(); });
  useEventListener(player, "playToEnd", onEnd);
  return (
    <View style={{ height: compact ? height * 0.36 : height * 0.82, paddingHorizontal: 16 }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  comparing: { position: "absolute", left: 0, right: 0, bottom: 120, alignItems: "center", gap: 6 },
  h: { color: C.text, fontSize: 22, fontFamily: serif, textAlign: "center" },
  dim: { color: C.dim, fontSize: 14, textAlign: "center" },
  scoreBox: { position: "absolute", left: 20, right: 20, gap: 10 },
  scoreRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 16, fontWeight: "700", width: 90 },
  kicker: { color: C.faint, fontSize: 11, letterSpacing: 1.6, fontWeight: "700" },
  score: { color: C.gold, fontSize: 64, fontFamily: serif, lineHeight: 70 },
  pairs: { color: C.dim, fontSize: 12, textAlign: "center" },
  skip: { position: "absolute", bottom: 36, alignSelf: "center", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: "rgba(0,0,0,.5)" },
  skipText: { color: C.text, fontSize: 14 },
  sheet: { position: "absolute", left: 0, right: 0, top: 0, backgroundColor: C.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginTop: 8 },
  saved: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingBottom: 30, backgroundColor: C.panel2 },
  savedText: { color: C.gold, fontSize: 14, fontWeight: "600" },
});
