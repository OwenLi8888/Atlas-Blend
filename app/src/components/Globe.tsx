import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent } from "react-native-webview";
import { API_URL } from "../config";
import { GLOBE_HTML } from "./globeHtml";

// react-native-webview 14's class typings don't line up with React 19.3's; the runtime is fine.
const WebView = RNWebView as unknown as React.ComponentType<any>;
interface WebViewRef { injectJavaScript(js: string): void }

export interface GlobeTile { id: string; img: string; tint?: string; tint2?: string; kind?: "art" | "painting"; label?: string }
export interface GlobeHandle {
  glowPairs(pairs: [string, string][]): void;
  fold(): void;
  unfold(): void;
}

/**
 * `emblem`: short text at the sphere's core that always faces the viewer.
 * `fill` (default true): repeat a small set of tiles so the sphere looks full; false shows each once.
 * `arrive`: id of a tile that lands last, with the globe turning to face it (a just-finished blend).
 */
interface Props {
  tiles: GlobeTile[]; onTap?: (id: string) => void; style?: ViewStyle; emblem?: string; fill?: boolean; arrive?: string;
}

export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ tiles, onTap, style, emblem, fill = true, arrive }, ref) {
  const web = useRef<WebViewRef>(null);
  const [ready, setReady] = useState(false);
  const run = useCallback((js: string) => web.current?.injectJavaScript(`try{${js}}catch(e){};true;`), []);

  useEffect(() => {
    if (ready) run(`G.setTiles(${JSON.stringify(tiles)},${JSON.stringify({ fill, arrive })})`);
  }, [ready, tiles, run]); // eslint-disable-line react-hooks/exhaustive-deps -- arrive/fill only matter with new tiles
  useEffect(() => {
    if (ready) run(`G.setEmblem(${JSON.stringify(emblem ?? "")})`);
  }, [ready, emblem, run]);

  useImperativeHandle(ref, () => ({
    glowPairs: (pairs) => run(`G.glowPairs(${JSON.stringify(pairs)})`),
    fold: () => run("G.fold()"),
    unfold: () => run("G.unfold()"),
  }), [run]);

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={web}
        originWhitelist={["*"]}
        source={{ html: GLOBE_HTML, baseUrl: API_URL }}
        style={styles.web}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        mixedContentMode="always"
        allowsInlineMediaPlayback
        onMessage={(e: WebViewMessageEvent) => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m.type === "ready") setReady(true);
            if (m.type === "tap") onTap?.(m.id);
          } catch { /* ignore */ }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  web: { flex: 1, backgroundColor: "transparent" },
});
