import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * Three separate looks for the same screens. Pick one when starting Expo:
 *
 *   EXPO_PUBLIC_SKIN=scrapbook npx expo start     (night | scrapbook | pet, default night)
 *
 * `C` is the palette, `S` the shapes and copy that differ between skins. Screens read both and
 * hold no skin-specific numbers of their own. Mock of all three: design/studies/screen-styles.html
 */
export type Skin = "night" | "scrapbook" | "pet";
const asked = process.env.EXPO_PUBLIC_SKIN;
export const SKIN: Skin = asked === "scrapbook" || asked === "pet" ? asked : "night";

// System faces only: nothing to install or bundle, and the look holds without network.
const ios = (name: string) => Platform.select({ ios: name, default: "serif" }) as string;
/** A hard offset shadow, like a sticker or a chunky plastic button (iOS). */
const hard = (color: string, y = 5, x = 0): ViewStyle =>
  ({ shadowColor: color, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: x, height: y } });

interface Palette {
  bg: string; panel: string; panel2: string; line: string; text: string; dim: string; faint: string;
  a: string; b: string;
  /** accent: frames, selection, paintings / shared */
  gold: string; goldDim: string; glow: string;
  /** card stock and the ink on it */
  paper: string; paper2: string; ink: string; inkDim: string; danger: string;
}

interface Shape {
  statusBar: "light" | "dark";
  display: string; hand: string; titleItalic: boolean;
  btn: ViewStyle; btnText: TextStyle; btnUpper: boolean; ghost: ViewStyle; ghostText: TextStyle;
  /** ticket: perforated stub; page: taped journal page; chunky: outlined plastic card */
  card: "ticket" | "page" | "chunky";
  thumb: { borderRadius: number; borderWidth: number; borderColor: string }; thumbTilt: number;
  /** quiz artwork: resting frame, chosen frame, alternate tilt in degrees, tape colour when chosen */
  frame: ViewStyle; frameOn: ViewStyle; frameTilt: number; canvasRadius: number; tape: string | null; offOpacity: number;
  input: TextStyle; plaque: ViewStyle;
  copy: {
    kicker: string; tag: string; label: string; room: string; ask: string; count: (n: number) => string;
    cardRight: string; cardNote: string; codeKicker: string; codeNote: string;
  };
}

const NIGHT: { C: Palette; S: Shape } = {
  // near-black navy hall, warm picture-light gold, paper keepsakes for cards
  C: {
    bg: "#05060C", panel: "#0C0F1A", panel2: "#141826", line: "#252A3B", text: "#F1E9D8", dim: "#A29C8E", faint: "#676574",
    a: "#FF7A59", b: "#4CC9D8", gold: "#D9B56D", goldDim: "#5C4E30", glow: "#FFC878",
    paper: "#EFE6D2", paper2: "#E2D6BC", ink: "#2A2318", inkDim: "#6B5F4C", danger: "#FF6B6B",
  },
  S: {
    statusBar: "light", display: ios("Didot"), hand: ios("Bradley Hand"), titleItalic: false,
    // a lit brass plate
    btn: { backgroundColor: "#D9B56D", borderRadius: 27, shadowColor: "#FFC878", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
    btnText: { color: "#2A2318", fontSize: 13, fontWeight: "700", letterSpacing: 2.2 }, btnUpper: true,
    ghost: { borderRadius: 27, borderWidth: 1, borderColor: "#5C4E30" }, ghostText: { color: "#D9B56D", fontSize: 13, fontWeight: "700", letterSpacing: 2.2 },
    card: "ticket",
    thumb: { borderRadius: 2, borderWidth: 3, borderColor: "#FFFDF6" }, thumbTilt: 2,
    // unlit brass until chosen, then the picture light comes on
    frame: { borderRadius: 3, padding: 4, backgroundColor: "#0C0F1A", borderWidth: 2, borderColor: "#5C4E30" },
    frameOn: { borderColor: "#D9B56D", shadowColor: "#FFC878", shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
    frameTilt: 0, canvasRadius: 1, tape: null, offOpacity: 0.55,
    // a signature line in the guest book
    input: { height: 52, color: "#F1E9D8", fontSize: 26, fontFamily: ios("Didot"), borderBottomWidth: 1, borderColor: "#5C4E30", marginBottom: 6 },
    plaque: { borderRadius: 4, borderWidth: 1, backgroundColor: "#0C0F1A" },
    copy: {
      kicker: "A NIGHT GALLERY FOR TWO",
      tag: "Build a gallery in five quick rooms, blend it with a friend's, and watch a new painting paint itself.",
      label: "What should we call you?", room: "Room", ask: "Tap every one you like.",
      count: (n) => (n === 0 ? "nothing on your wall yet" : `${n} on your wall`),
      cardRight: "ADMIT ONE", cardNote: "what your walls say", codeKicker: "ADMIT TWO · JOIN CODE",
      codeNote: "read it to a friend, or show them this ticket",
    },
  },
};

const SCRAPBOOK: { C: Palette; S: Shape } = {
  // cream journal paper, taped prints, a red stamp, handwriting
  C: {
    bg: "#EFE7D6", panel: "#FFFDF6", panel2: "#E3D9C4", line: "#D2C7B0", text: "#2B2520", dim: "#6F6558", faint: "#9A8F7E",
    a: "#E0603F", b: "#1F9FB0", gold: "#C8553D", goldDim: "#D9B9A8", glow: "#C8553D",
    paper: "#FFFDF6", paper2: "#E3D9C4", ink: "#2B2520", inkDim: "#6F6558", danger: "#C0392B",
  },
  S: {
    statusBar: "dark", display: ios("Bodoni 72"), hand: ios("Bradley Hand"), titleItalic: true,
    // an ink block with a red offset, like a rubber stamp
    btn: { backgroundColor: "#2B2520", borderRadius: 4, ...hard("#C8553D", 3, 3) },
    btnText: { color: "#EFE7D6", fontSize: 18, fontFamily: ios("Bradley Hand") }, btnUpper: false,
    ghost: { borderRadius: 4, borderWidth: 2, borderColor: "#2B2520" }, ghostText: { color: "#2B2520", fontSize: 18, fontFamily: ios("Bradley Hand") },
    card: "page",
    thumb: { borderRadius: 1, borderWidth: 3, borderColor: "#FFFDF6" }, thumbTilt: 2,
    // an instant print: white border, thick at the bottom
    frame: { borderRadius: 1, padding: 6, paddingBottom: 20, backgroundColor: "#FFFDF6", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
    frameOn: { shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
    frameTilt: 2.2, canvasRadius: 0, tape: "rgba(200,85,61,0.6)", offOpacity: 0.8,
    input: { height: 52, color: "#2B2520", fontSize: 26, fontFamily: ios("Bradley Hand"), borderBottomWidth: 2, borderColor: "#2B2520", borderStyle: "dotted", marginBottom: 8 },
    plaque: { borderRadius: 2, borderWidth: 1, backgroundColor: "#FFFDF6" },
    copy: {
      kicker: "AN ART TASTE JOURNAL",
      tag: "Fill five pages with art you like, swap journals with a friend, and watch a new painting paint itself.",
      label: "This journal belongs to", room: "Page", ask: "Tape in the ones you like.",
      count: (n) => (n === 0 ? "nothing taped in yet" : `${n} taped in`),
      cardRight: "", cardNote: "what your pages say", codeKicker: "JOIN CODE",
      codeNote: "read it to a friend, or show them this page",
    },
  },
};

const PET: { C: Palette; S: Shape } = {
  // pastel handheld: an LCD with the pixel beaver, outlined candy buttons
  C: {
    bg: "#CDB8F2", panel: "#FFFFFF", panel2: "#E9DEFC", line: "#B79BE8", text: "#2C1F4A", dim: "#5B4B82", faint: "#7D6EA6",
    a: "#FF7A59", b: "#1FA7B8", gold: "#FF6FA3", goldDim: "#2C1F4A", glow: "#FF6FA3",
    paper: "#FFFFFF", paper2: "#E9DEFC", ink: "#2C1F4A", inkDim: "#5B4B82", danger: "#D33A4B",
  },
  S: {
    statusBar: "dark", display: ios("Arial Rounded MT Bold"), hand: ios("Chalkboard SE"), titleItalic: false,
    btn: { backgroundColor: "#FFD447", borderRadius: 18, borderWidth: 3, borderColor: "#2C1F4A", ...hard("#2C1F4A") },
    btnText: { color: "#2C1F4A", fontSize: 16, fontFamily: ios("Arial Rounded MT Bold") }, btnUpper: false,
    ghost: { backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 3, borderColor: "#2C1F4A", ...hard("#2C1F4A") },
    ghostText: { color: "#2C1F4A", fontSize: 16, fontFamily: ios("Arial Rounded MT Bold") },
    card: "chunky",
    thumb: { borderRadius: 12, borderWidth: 2, borderColor: "#2C1F4A" }, thumbTilt: 0,
    frame: { borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: "#2C1F4A" },
    frameOn: { borderColor: "#FF6FA3", ...hard("#FF6FA3") },
    frameTilt: 0, canvasRadius: 14, tape: null, offOpacity: 1,
    input: { height: 54, color: "#2C1F4A", fontSize: 20, fontFamily: ios("Arial Rounded MT Bold"), backgroundColor: "#FFFFFF", borderWidth: 3, borderColor: "#2C1F4A", borderRadius: 16, paddingHorizontal: 14, marginBottom: 8 },
    plaque: { borderRadius: 16, borderWidth: 3, backgroundColor: "#FFFFFF" },
    copy: {
      kicker: "HELLO! I'M YOUR TASTE PET",
      tag: "Feed your beaver the art you like. Blend it with a friend's and watch a new painting paint itself.",
      label: "NAME YOUR KEEPER", room: "Round", ask: "Feed me the ones you like!",
      count: (n) => (n === 0 ? "I'm hungry..." : `yum, ${n} so far`),
      cardRight: "", cardNote: "what I learned about you", codeKicker: "JOIN CODE",
      codeNote: "read it to a friend, or show them this screen",
    },
  },
};

const ACTIVE = { night: NIGHT, scrapbook: SCRAPBOOK, pet: PET }[SKIN];
export const C: Palette = ACTIVE.C;
export const S: Shape = ACTIVE.S;

/** Body serif, kept for screens that predate the skins. */
export const serif = Platform.select({ ios: "Georgia", default: "serif" });
/** Display face for titles. */
export const display = S.display;
/** Handwriting for notes. */
export const hand = S.hand;
/** Title style shared by all screens: face plus the skin's italic. */
export const titleFace: TextStyle = { fontFamily: S.display, fontStyle: S.titleItalic ? "italic" : "normal" };

/** Small caps label: wall plaques, ticket headers. */
export const kicker = { fontSize: 11, letterSpacing: 2.4, fontWeight: "700" as const };

export const VARS = ["warmth", "brightness", "saturation", "detail", "hue", "era"] as const;
export type VarName = (typeof VARS)[number];
export const VAR_LABEL: Record<VarName, [string, string, string]> = {
  warmth: ["Warmth", "cool", "warm"],
  brightness: ["Brightness", "dark", "bright"],
  saturation: ["Saturation", "muted", "vivid"],
  detail: ["Detail", "sparse", "detailed"],
  hue: ["Palette", "broad", "focused"],
  era: ["Era", "older", "newer"],
};
