import { Platform } from "react-native";

export const C = {
  bg: "#0F0E0C",
  panel: "#1A1815",
  panel2: "#24211D",
  line: "#3A352E",
  text: "#F3EDE2",
  dim: "#A79F92",
  faint: "#6E675D",
  a: "#FF7A59", // person A
  b: "#4CC9D8", // person B
  gold: "#E8C47A", // paintings / shared
  danger: "#FF6B6B",
};

export const serif = Platform.select({ ios: "Georgia", default: "serif" });

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
