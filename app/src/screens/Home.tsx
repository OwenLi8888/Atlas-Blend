import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { Gallery } from "../api";
import { ArtworkSheet } from "../components/ArtworkSheet";
import { Button } from "../components/Button";
import { GalleryCard } from "../components/GalleryCard";
import { Globe, type GlobeTile } from "../components/Globe";
import type { Identity } from "../identity";
import { C, serif } from "../theme";

/**
 * Home: the globe of your finished blend paintings (one tile per blend, newest first) + your
 * gallery card (M3). `justBlended` is the blend that just finished: it lands on the globe last.
 */
export function Home({ me, gallery, justBlended, onBlend, onPair, onRetake }: {
  me: Identity; gallery: Gallery; justBlended?: string; onBlend: () => void; onPair: () => void; onRetake: () => void;
}) {
  const { height } = useWindowDimensions();
  const [tapped, setTapped] = useState<string | null>(null);
  const tiles = useMemo<GlobeTile[]>(() => gallery.blend_tiles.map((t) => (
    { id: `blend:${t.blend_id}`, img: t.thumb_url, kind: "painting" as const, label: t.partner.includes(" + ") ? t.partner : `With ${t.partner}` }
  )), [gallery]);
  const n = gallery.blend_tiles.length;
  const tile = tapped ? gallery.blend_tiles.find((t) => `blend:${t.blend_id}` === tapped) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <Text style={styles.hello}>{me.name}'s gallery</Text>
        <Pressable onPress={onRetake}><Text style={styles.retake}>Retake quiz</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 190 }}>
        <Globe tiles={tiles} onTap={setTapped} style={{ height: height * 0.55 }} fill={false}
          arrive={justBlended ? `blend:${justBlended}` : undefined}
          emblem={n ? `${String(n).padStart(2, "0")} painting${n > 1 ? "s" : ""}` : "No blends yet"} />
        <Text style={styles.hint}>{n ? "Drag to explore · tap a painting to replay it" : "Blend with a friend to put your first painting on the globe"}</Text>
        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          <GalleryCard g={gallery} />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Blend two images" onPress={onPair} />
        <Button title="Blend with a friend" kind="ghost" onPress={onBlend} style={{ backgroundColor: C.bg }} />
      </View>
      <ArtworkSheet tile={tile} onClose={() => setTapped(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 20, paddingTop: 6 },
  hello: { color: C.text, fontSize: 22, fontFamily: serif },
  retake: { color: C.dim, fontSize: 13 },
  hint: { color: C.faint, fontSize: 12, textAlign: "center", marginBottom: 14 },
  footer: { position: "absolute", left: 20, right: 20, bottom: 30, gap: 10 },
});
