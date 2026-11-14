import { Image, StyleSheet, Text, View } from "react-native";
import type { Gallery } from "../api";
import { C, serif } from "../theme";
import { Bars } from "./Bars";

/** M3: title, six variable bars, top artworks. Describes the art, not the person. */
export function GalleryCard({ g, color = C.a }: { g: Gallery; color?: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>YOUR GALLERY</Text>
      <Text style={styles.title}>{g.title}</Text>
      <Text style={styles.meta}>
        {g.artworks.length} artworks · {g.top_subjects.slice(0, 2).join(", ")} · mostly {g.dominant_medium}
        {g.top_hues.length ? ` · ${g.top_hues.slice(0, 2).join(" and ")} tones` : ""}
      </Text>
      <View style={styles.thumbs}>
        {g.artworks.slice(0, 5).map((a) => <Image key={a.id} source={{ uri: a.image }} style={styles.thumb} />)}
      </View>
      <Bars series={[{ label: "You", color, values: g.bars }]} compact />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.panel, borderRadius: 20, padding: 18, gap: 10, borderWidth: 1, borderColor: C.line },
  kicker: { color: C.faint, fontSize: 11, letterSpacing: 1.6, fontWeight: "700" },
  title: { color: C.text, fontSize: 28, fontFamily: serif },
  meta: { color: C.dim, fontSize: 13 },
  thumbs: { flexDirection: "row", gap: 6, marginVertical: 4 },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.panel2 },
});
