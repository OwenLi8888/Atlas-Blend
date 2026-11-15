import { StatusBar } from "expo-status-bar";
import { Image, StyleSheet, Text, View } from "react-native";
import type { Gallery } from "../api";
import { C, S, SKIN, kicker, titleFace } from "../theme";
import { Bars } from "./Bars";
import { Lcd } from "./PixelBeaver";
import { Ticket } from "./Ticket";

/** M3: title, six variable bars, top artworks. Describes the art, not the person. */
export function GalleryCard({ g, color = C.a }: { g: Gallery; color?: string }) {
  return (
    <View style={{ gap: 18 }}>
      {/* the screen that hosts this card predates the skins: set the bar colour from here */}
      <StatusBar style={S.statusBar} />
      {SKIN === "pet" && <Lcd row px={4} text={`${g.artworks.length} ARTWORKS · ${g.title.toUpperCase()}`} />}
      <Ticket
        stub={
          <>
            <View style={styles.head}>
              <Text style={styles.kicker}>YOUR GALLERY</Text>
              {!!S.copy.cardRight && <Text style={styles.kicker}>{S.copy.cardRight}</Text>}
            </View>
            <Text style={styles.title}>{g.title}</Text>
            <Text style={styles.meta}>
              {g.artworks.length} artworks · {g.top_subjects.slice(0, 2).join(", ")} · mostly {g.dominant_medium}
              {g.top_hues.length ? ` · ${g.top_hues.slice(0, 2).join(" and ")} tones` : ""}
            </Text>
            <View style={styles.thumbs}>
              {g.artworks.slice(0, 5).map((a, i) => (
                <Image key={a.id} source={{ uri: a.image }}
                  style={[styles.thumb, S.thumb, { transform: [{ rotate: `${(i % 2 ? 1 : -1) * S.thumbTilt}deg` }] }]} />
              ))}
            </View>
          </>
        }
      >
        <Text style={styles.note}>{S.copy.cardNote}</Text>
        <Bars series={[{ label: "You", color, values: g.bars }]} compact onPaper />
      </Ticket>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between" },
  kicker: { ...kicker, color: C.inkDim },
  title: { ...titleFace, color: C.ink, fontSize: 30, lineHeight: 34 },
  meta: { color: C.inkDim, fontSize: 13, lineHeight: 18 },
  thumbs: { flexDirection: "row", gap: 6, marginTop: 4 },
  thumb: { width: 48, height: 48, backgroundColor: C.paper2 },
  note: { color: C.inkDim, fontSize: 17, fontFamily: S.hand, marginBottom: 2 },
});
