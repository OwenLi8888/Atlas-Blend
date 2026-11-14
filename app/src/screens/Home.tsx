import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { Gallery } from "../api";
import { ArtworkSheet } from "../components/ArtworkSheet";
import { Button } from "../components/Button";
import { GalleryCard } from "../components/GalleryCard";
import { Globe, type GlobeTile } from "../components/Globe";
import type { Identity } from "../identity";
import { C, serif } from "../theme";

/** Your gallery on the sphere (M4) + gallery card (M3). Blend paintings appear as gold tiles. */
export function Home({ me, gallery, onBlend, onRetake }: { me: Identity; gallery: Gallery; onBlend: () => void; onRetake: () => void }) {
  const { height } = useWindowDimensions();
  const [tapped, setTapped] = useState<string | null>(null);
  const tiles = useMemo<GlobeTile[]>(() => [
    ...gallery.blend_tiles.map((t) => ({ id: `blend:${t.blend_id}`, img: t.thumb_url, kind: "painting" as const })),
    ...gallery.artworks.map((a) => ({ id: a.id, img: a.image, kind: "art" as const })),
  ], [gallery]);
  const art = tapped && !tapped.startsWith("blend:") ? gallery.artworks.find((a) => a.id === tapped) : null;
  const tile = tapped?.startsWith("blend:") ? gallery.blend_tiles.find((t) => `blend:${t.blend_id}` === tapped) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <Text style={styles.hello}>{me.name}'s gallery</Text>
        <Pressable onPress={onRetake}><Text style={styles.retake}>Retake quiz</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <Globe tiles={tiles} onTap={setTapped} style={{ height: height * 0.46 }} />
        <Text style={styles.hint}>Drag to explore · tap a tile</Text>
        <View style={{ paddingHorizontal: 20, gap: 16 }}>
          <GalleryCard g={gallery} />
          {gallery.blend_tiles.length > 0 && (
            <Text style={styles.blends}>{gallery.blend_tiles.length} blend painting{gallery.blend_tiles.length > 1 ? "s" : ""} on your sphere (gold tiles)</Text>
          )}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Blend with a friend" onPress={onBlend} />
      </View>
      <ArtworkSheet art={art} tile={tile} onClose={() => setTapped(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 20, paddingTop: 6 },
  hello: { color: C.text, fontSize: 22, fontFamily: serif },
  retake: { color: C.dim, fontSize: 13 },
  hint: { color: C.faint, fontSize: 12, textAlign: "center", marginBottom: 14 },
  blends: { color: C.gold, fontSize: 13, textAlign: "center" },
  footer: { position: "absolute", left: 20, right: 20, bottom: 30 },
});
