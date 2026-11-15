import { StyleSheet, View, type ViewStyle } from "react-native";
import { C, S } from "../theme";

/**
 * The keepsake card, one shape per skin:
 * - ticket (night): cream stock, slight tilt, a perforation with a notch punched from each edge
 * - page (scrapbook): a white journal page held by a strip of tape
 * - chunky (pet): an outlined plastic card with a hard shadow
 * `stub` is the upper part, `children` the lower part.
 */
export function Ticket({ stub, children, tilt = -1.2, style }: {
  stub: React.ReactNode; children: React.ReactNode; tilt?: number; style?: ViewStyle;
}) {
  if (S.card === "chunky") {
    return (
      <View style={[styles.chunky, style]}>
        <View style={styles.part}>{stub}</View>
        <View style={[styles.part, { paddingTop: 0 }]}>{children}</View>
      </View>
    );
  }
  if (S.card === "page") {
    return (
      <View style={[styles.page, { transform: [{ rotate: `${-tilt}deg` }] }, style]}>
        <View style={styles.tape} />
        <View style={styles.part}>{stub}</View>
        <View style={[styles.part, { paddingTop: 0 }]}>{children}</View>
      </View>
    );
  }
  return (
    <View style={[styles.ticket, { transform: [{ rotate: `${tilt}deg` }] }, style]}>
      <View style={styles.part}>{stub}</View>
      <View style={styles.perf}>
        <View style={[styles.notch, { left: -11 }]} />
        <View style={styles.dots}>
          {Array.from({ length: 28 }, (_, i) => <View key={i} style={styles.dot} />)}
        </View>
        <View style={[styles.notch, { right: -11 }]} />
      </View>
      <View style={styles.part}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: {
    backgroundColor: C.paper, borderRadius: 6,
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 10 },
  },
  page: {
    backgroundColor: C.paper, borderRadius: 1,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  tape: { position: "absolute", alignSelf: "center", top: -11, width: 84, height: 22, backgroundColor: "rgba(232,196,122,0.8)", transform: [{ rotate: "-4deg" }], zIndex: 1 },
  chunky: {
    backgroundColor: C.paper, borderRadius: 22, borderWidth: 3, borderColor: C.ink,
    shadowColor: C.ink, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 6 },
  },
  part: { padding: 18, gap: 8 },
  perf: { height: 22, justifyContent: "center" },
  dots: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: 18 },
  dot: { width: 4, height: 1.5, backgroundColor: C.inkDim, opacity: 0.55 },
  // the notch takes the wall colour, so the ticket reads as punched
  notch: { position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: C.bg },
});
