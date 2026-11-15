import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { api, type Artwork, type BlendEvent } from "../api";
import { Button } from "../components/Button";
import type { Identity } from "../identity";
import { C, serif } from "../theme";

/**
 * Two-image blend = technique transfer: image A is the picture (pick a painting or upload a photo),
 * painting B lends its technique (medium, palette, mark length, stroke direction, ground). The
 * server paints A that way, stroke by stroke, in a few seconds; the video plays here and
 * "Add to globe" goes Home, where the painting lands on the globe.
 *
 * Rules: only oil and watercolor paintings with a clear subject are offered, and B must be the
 * other medium from A (oil A -> watercolor B, and vice versa). An uploaded A can take either.
 */
type Medium = "oil" | "watercolor";
interface Pick { ref: string; title: string; image: string; medium: Medium | null }
const other = (m: Medium): Medium => (m === "oil" ? "watercolor" : "oil");
const label = (m: Medium) => (m === "oil" ? "Oil" : "Watercolor");

export function PairBlend({ me, onBack, onDone }: { me: Identity; onBack: () => void; onDone: (blendId: string) => void }) {
  const [blendId, setBlendId] = useState<string | null>(null);
  const [picks, setPicks] = useState<{ a: Pick | null; b: Pick | null }>({ a: null, b: null });
  if (blendId && picks.a && picks.b) return <Progress blendId={blendId} a={picks.a} b={picks.b} onDone={() => onDone(blendId)} onBack={onBack} />;
  return <Picker me={me} picks={picks} setPicks={setPicks} onBack={onBack} onStart={setBlendId} />;
}

// ------------------------------------------------------------------ 1. pick A, then B
function Picker({ me, picks, setPicks, onBack, onStart }: {
  me: Identity; picks: { a: Pick | null; b: Pick | null }; setPicks: (p: { a: Pick | null; b: Pick | null }) => void;
  onBack: () => void; onStart: (blendId: string) => void;
}) {
  const [arts, setArts] = useState<Artwork[] | null>(null);
  const [slot, setSlot] = useState<"a" | "b">(picks.a ? "b" : "a");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);

  useEffect(() => { api.artworks(true).then((r) => setArts(r.artworks)).catch((e) => setErr(e.message)); }, []);

  // B must be the other medium from A (an uploaded A can take either)
  const needB: Medium | null = picks.a?.medium ? other(picks.a.medium) : null;
  const shown = useMemo(() => (arts ?? []).filter((a) => slot === "a" || !needB || a.pick_medium === needB), [arts, slot, needB]);

  const choose = (p: Pick) => {
    if (slot === "a") {
      const keepB = picks.b && (!p.medium || picks.b.medium === other(p.medium)) ? picks.b : null;
      setPicks({ a: p, b: keepB });
      if (!keepB) setSlot("b");
    } else {
      setPicks({ ...picks, b: p });
    }
  };

  const onFile = (e: any) => {
    const f: File | undefined = e.target?.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      setErr(null);
      try {
        const r = await api.upload(String(reader.result), f.name);
        setSlot("a");
        setPicks({ a: { ref: r.ref, title: r.title, image: r.image, medium: null }, b: picks.b });
        if (!picks.b) setSlot("b");
      } catch (x: any) { setErr(x.message); } finally { setBusy(false); if (file.current) file.current.value = ""; }
    };
    reader.readAsDataURL(f);
  };

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { blend_id } = await api.pairBlend(me.id, picks.a!.ref, picks.b!.ref);
      onStart(blend_id);
    } catch (x: any) { setErr(x.message); setBusy(false); }
  };

  const hint = slot === "a"
    ? "Pick the picture to repaint, or upload your own."
    : needB ? `Your first is ${label(picks.a!.medium!).toLowerCase()}, so pick a ${needB} painting whose technique to use.`
      : "Pick the painting whose technique to use.";

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <Pressable onPress={onBack}><Text style={styles.back}>‹ Back</Text></Pressable>
        <Text style={styles.title}>Blend two images</Text>
        <Text style={styles.dim}>B's technique (medium, palette, brushwork) repaints A.</Text>
        <View style={styles.slots}>
          {(["a", "b"] as const).map((k) => (
            <Pressable key={k} onPress={() => setSlot(k)} disabled={k === "b" && !picks.a}
              style={[styles.slot, slot === k && { borderColor: k === "a" ? C.a : C.b }, k === "b" && !picks.a && { opacity: 0.45 }]}>
              {picks[k] ? <Image source={{ uri: picks[k]!.image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
              <View style={styles.slotLabel}>
                <Text style={[styles.slotKey, { color: k === "a" ? C.a : C.b }]}>
                  {k === "a" ? "A · PICTURE" : "B · TECHNIQUE"}{picks[k]?.medium ? ` · ${label(picks[k]!.medium!).toUpperCase()}` : ""}
                </Text>
                <Text style={styles.slotTitle} numberOfLines={1}>{picks[k]?.title ?? (k === "b" && needB ? `Pick a ${needB}` : "Tap, then pick")}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>{hint}</Text>
        {Platform.OS === "web" && slot === "a" && (
          <>
            <Pressable onPress={() => file.current?.click()} style={styles.upload}>
              <Text style={styles.uploadText}>Upload your own picture for A</Text>
            </Pressable>
            {createElement("input", { ref: file, type: "file", accept: "image/png,image/jpeg,image/webp", style: { display: "none" }, onChange: onFile })}
          </>
        )}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}>
        {!arts && !err && <ActivityIndicator color={C.text} style={{ marginTop: 30 }} />}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: "2.75%" as any, rowGap: 8 }}>
          {shown.map((a) => {
            const on = picks.a?.ref === a.id ? C.a : picks.b?.ref === a.id ? C.b : null;
            return (
              <Pressable key={a.id} onPress={() => choose({ ref: a.id, title: a.title, image: a.image, medium: a.pick_medium ?? null })}
                style={{ width: "31.5%", aspectRatio: 1, borderRadius: 10, overflow: "hidden", borderWidth: 2, borderColor: on ?? "transparent" }}>
                <Image source={{ uri: a.image }} style={{ flex: 1, backgroundColor: C.panel }} resizeMode="cover" />
                <Text style={styles.badge}>{a.pick_medium === "oil" ? "OIL" : "WATERCOLOR"}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {err && <Text style={styles.err}>{err}</Text>}
        <Button title="Paint it" onPress={start} disabled={!picks.a || !picks.b} busy={busy} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ 2. technique -> painting video
function useEvents(id: string) {
  const [s, setS] = useState({ stage: "Starting…", summary: [] as string[], swatches: [] as string[],
    paintPct: 0, videoUrl: null as string | null, strokes: 0, medium: "", done: false, error: null as string | null, t0: Date.now(), took: 0 });
  useEffect(() => {
    let after = 0, alive = true, timer: ReturnType<typeof setTimeout>;
    const apply = (e: BlendEvent) => setS((x) => {
      const d = e.data ?? {};
      switch (e.type) {
        case "stage": return { ...x, stage: d.detail ?? x.stage };
        case "technique": return { ...x, summary: d.summary ?? [], swatches: d.swatches ?? [], medium: d.medium };
        case "painting": return { ...x, paintPct: d.stage === "painting" ? d.pct : x.paintPct, stage: d.stage === "planning" ? "Planning the strokes" : d.stage === "painting" ? "Laying down the strokes" : "Finishing the video" };
        case "video": return { ...x, videoUrl: d.video_url, strokes: d.strokes };
        case "done": return { ...x, done: true, took: d.timings?.total ?? 0 };
        case "error": return { ...x, error: d.message };
        default: return x;
      }
    });
    const poll = async () => {
      try {
        const r = await api.events(id, after);
        r.events.forEach((e) => { after = Math.max(after, e.seq); apply(e); });
        if (r.events.some((e) => e.type === "done" || e.type === "error")) return;
      } catch { /* keep polling */ }
      if (alive) timer = setTimeout(poll, 300);
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);
  return s;
}

function Technique({ summary, swatches }: { summary: string[]; swatches: string[] }) {
  if (!summary.length) return null;
  return (
    <View style={styles.tech}>
      <Text style={styles.techKey}>TECHNIQUE TAKEN FROM B</Text>
      {summary.map((t) => <Text key={t} style={styles.techLine}>· {t}</Text>)}
      <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
        {swatches.map((c) => <View key={c} style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: c }} />)}
      </View>
    </View>
  );
}

function Progress({ blendId, a, b, onDone, onBack }: { blendId: string; a: Pick; b: Pick; onDone: () => void; onBack: () => void }) {
  const s = useEvents(blendId);
  const { height } = useWindowDimensions();

  if (s.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>This blend hit a snag</Text>
        <Text style={styles.dim}>{s.error}</Text>
        <Button title="Back" onPress={onBack} style={{ marginTop: 20, alignSelf: "stretch" }} />
      </View>
    );
  }

  if (s.videoUrl) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={styles.title}>{a.title}, painted like {b.title}</Text>
        <Text style={styles.dim}>{s.strokes} strokes, underpainting to accents{s.took ? ` · made in ${s.took.toFixed(1)} s` : ""}</Text>
        <PaintingVideo url={s.videoUrl} height={height * 0.55} />
        <Button title={s.done ? "Add to globe" : "Saving…"} onPress={onDone} disabled={!s.done} />
        <Technique summary={s.summary} swatches={s.swatches} />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 16, justifyContent: "center" }}>
      <View style={styles.pairRow}>
        <Image source={{ uri: a.image }} style={[styles.pairImg, { borderColor: C.a }]} />
        <Text style={styles.plus}>←</Text>
        <Image source={{ uri: b.image }} style={[styles.pairImg, { borderColor: C.b }]} />
      </View>
      <ActivityIndicator color={C.gold} size="large" />
      <Text style={styles.stage}>{s.stage}</Text>
      <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(s.paintPct * 100)}%` }]} /></View>
    </View>
  );
}

function PaintingVideo({ url, height }: { url: string; height: number }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.muted = true; p.play(); });
  useEventListener(player, "playToEnd", () => {});
  // web: play() in the setup runs before the <video> element exists, so start it again once mounted
  useEffect(() => {
    const t = setTimeout(() => { try { if (!player.playing) player.play(); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(t);
  }, [player]);
  return (
    <View style={{ height, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingTop: 6, gap: 8, paddingBottom: 12 },
  back: { color: C.dim, fontSize: 15 },
  title: { color: C.text, fontSize: 24, fontFamily: serif },
  dim: { color: C.dim, fontSize: 14 },
  hint: { color: C.text, fontSize: 13 },
  slots: { flexDirection: "row", gap: 10, marginTop: 6 },
  slot: { flex: 1, height: 130, borderRadius: 14, backgroundColor: C.panel, borderWidth: 2, borderColor: C.line, overflow: "hidden", justifyContent: "flex-end" },
  slotLabel: { backgroundColor: "rgba(15,14,12,.78)", padding: 8 },
  slotKey: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  slotTitle: { color: C.text, fontSize: 13 },
  badge: { position: "absolute", left: 4, bottom: 4, fontSize: 9, fontWeight: "700", letterSpacing: 0.8, color: C.text, backgroundColor: "rgba(15,14,12,.7)", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  upload: { borderWidth: 1, borderColor: C.line, borderStyle: "dashed", borderRadius: 12, padding: 10, alignItems: "center" },
  uploadText: { color: C.dim, fontSize: 13 },
  footer: { position: "absolute", left: 20, right: 20, bottom: 24, gap: 8 },
  err: { color: C.danger, fontSize: 13, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  pairRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  pairImg: { width: 120, height: 120, borderRadius: 12, borderWidth: 2 },
  plus: { color: C.gold, fontSize: 28 },
  stage: { color: C.text, fontSize: 16, textAlign: "center" },
  bar: { height: 6, borderRadius: 3, backgroundColor: C.panel2, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: C.gold },
  tech: { backgroundColor: C.panel, borderRadius: 14, padding: 14, gap: 4 },
  techKey: { color: C.b, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  techLine: { color: C.text, fontSize: 14 },
});
