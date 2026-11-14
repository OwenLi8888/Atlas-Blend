import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent } from "react-native-webview";
import { API_URL } from "../config";
import { GLOBE_HTML } from "./globeHtml";

// react-native-webview 14's class typings don't line up with React 19.3's; the runtime is fine.
const WebView = RNWebView as unknown as React.ComponentType<any>;
interface WebViewRef { injectJavaScript(js: string): void }

export interface GlobeTile { id: string; img: string; tint?: string; tint2?: string; kind?: "art" | "painting" }
export interface GlobeHandle {
  glowPairs(pairs: [string, string][]): void;
  fold(): void;
  unfold(): void;
}

interface Props { tiles: GlobeTile[]; onTap?: (id: string) => void; style?: ViewStyle }

export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ tiles, onTap, style }, ref) {
  const web = useRef<WebViewRef>(null);
  const [ready, setReady] = useState(false);
  const run = useCallback((js: string) => web.current?.injectJavaScript(`try{${js}}catch(e){};true;`), []);

  useEffect(() => {
    if (ready) run(`G.setTiles(${JSON.stringify(tiles)})`);
  }, [ready, tiles, run]);

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
