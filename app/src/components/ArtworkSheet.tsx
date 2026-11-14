import { useVideoPlayer, VideoView } from "expo-video";
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { Artwork, BlendTile } from "../api";
import { C, serif } from "../theme";

/** Tap-a-tile details: an artwork record, or a saved blend painting (replays its video). */
export function ArtworkSheet({ art, tile, onClose }: { art?: Artwork | null; tile?: BlendTile | null; onClose: () => void }) {
  return (
    <Modal visible={!!(art || tile)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        {art && (
          <>
            <Image source={{ uri: art.image }} style={styles.img} resizeMode="contain" />
            <Text style={styles.title}>{art.title}</Text>
            <Text style={styles.meta}>{art.artist} · {art.year}</Text>
            <Text style={styles.meta}>{art.medium}</Text>
            <Text style={styles.small}>{art.license}</Text>
            <Pressable onPress={() => Linking.openURL(art.source_url)}>
              <Text style={styles.link}>View museum record ↗</Text>
            </Pressable>
          </>
        )}
        {tile && <BlendReplay tile={tile} />}
        <Pressable style={styles.close} onPress={onClose}><Text style={styles.closeText}>Close</Text></Pressable>
      </View>
    </Modal>
  );
}

function BlendReplay({ tile }: { tile: BlendTile }) {
  const player = useVideoPlayer(tile.video_url, (p) => { p.loop = true; p.play(); });
  return (
    <>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />
      <Text style={styles.title}>Blend with {tile.partner}</Text>
      <Text style={styles.meta}>Blend score {tile.score}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,.55)" },
  sheet: { backgroundColor: C.panel, padding: 20, paddingBottom: 40, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 6 },
  img: { width: "100%", height: 300, borderRadius: 12, backgroundColor: C.panel2, marginBottom: 8 },
  video: { width: "100%", height: 340, borderRadius: 12, backgroundColor: "#000", marginBottom: 8 },
  title: { color: C.text, fontSize: 22, fontFamily: serif },
  meta: { color: C.dim, fontSize: 14 },
  small: { color: C.faint, fontSize: 12 },
  link: { color: C.b, fontSize: 14, marginTop: 6 },
  close: { alignSelf: "center", marginTop: 14, paddingHorizontal: 24, paddingVertical: 10 },
  closeText: { color: C.dim, fontSize: 15 },
});
