import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { API_URL } from "../config";
import { GLOBE_HTML } from "./globeHtml";
import type { GlobeHandle, GlobeTile } from "./Globe";

export type { GlobeHandle, GlobeTile } from "./Globe";

/**
 * Web build of the globe: the same GLOBE_HTML as the native WebView, rendered in an iframe.
 * Commands go in by calling the iframe's window.G directly (srcdoc iframes share our origin);
 * ready/tap events come back via window.parent.postMessage (see post() in globeHtml).
 */
interface Props {
  tiles: GlobeTile[]; onTap?: (id: string) => void; style?: ViewStyle; emblem?: string; fill?: boolean; arrive?: string;
}

// <base> so relative image URLs resolve against the API, like the WebView's baseUrl.
const HTML = GLOBE_HTML.replace("<head>", `<head><base href="${API_URL}/">`);

export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ tiles, onTap, style, emblem, fill = true, arrive }, ref) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  const run = useCallback((fn: (G: any) => void) => {
    try {
      const G = (frame.current?.contentWindow as any)?.G;
      if (G) fn(G);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      try {
        const m = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (m.type === "ready") setReady(true);
        if (m.type === "tap") tapRef.current?.(m.id);
      } catch { /* ignore */ }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (ready) run((G) => G.setTiles(tiles, { fill, arrive }));
  }, [ready, tiles, run]); // eslint-disable-line react-hooks/exhaustive-deps -- arrive/fill only matter with new tiles
  useEffect(() => {
    if (ready) run((G) => G.setEmblem(emblem ?? ""));
  }, [ready, emblem, run]);

  useImperativeHandle(ref, () => ({
    glowPairs: (pairs) => run((G) => G.glowPairs(pairs)),
    fold: () => run((G) => G.fold()),
    unfold: () => run((G) => G.unfold()),
  }), [run]);

  return (
    <View style={[styles.wrap, style]}>
      {createElement("iframe", {
        ref: frame,
        srcDoc: HTML,
        style: { border: 0, width: "100%", height: "100%", background: "transparent" },
        allowTransparency: true,
      })}
    </View>
  );
});

// flexGrow (not flex: 1): on web flex: 1 sets flex-basis 0, which ignores a passed height inside a
// ScrollView and leaves the iframe at the browser's default 150 px
const styles = StyleSheet.create({ wrap: { flexGrow: 1, flexShrink: 0 } });
