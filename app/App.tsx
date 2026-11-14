import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from "react-native";
import { api, type Gallery } from "./src/api";
import { loadIdentity, type Identity } from "./src/identity";
import { Home } from "./src/screens/Home";
import { Lobby } from "./src/screens/Lobby";
import { Quiz } from "./src/screens/Quiz";
import { Reveal } from "./src/screens/Reveal";
import { Welcome } from "./src/screens/Welcome";
import { C } from "./src/theme";

type Screen =
  | { name: "boot" } | { name: "welcome" } | { name: "quiz" } | { name: "home"; justBlended?: string }
  | { name: "lobby" } | { name: "reveal"; blendId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "boot" });
  const [me, setMe] = useState<Identity | null>(null);
  const [gallery, setGallery] = useState<Gallery | null>(null);

  useEffect(() => {
    (async () => {
      const ident = await loadIdentity();
      setMe(ident);
      if (!ident) return setScreen({ name: "welcome" });
      try {
        await api.user(ident.id, ident.name);
        setGallery(await api.gallery(ident.id));
        setScreen({ name: "home" });
      } catch {
        setScreen({ name: "quiz" }); // known device, no gallery yet (or server was reset)
      }
    })();
  }, []);

  // a finished blend ends on Home, where its painting lands on the globe
  const refresh = async (justBlended?: string) => {
    if (me) setGallery(await api.gallery(me.id).catch(() => gallery));
    setScreen({ name: "home", justBlended });
  };

  let body: React.ReactNode;
  switch (screen.name) {
    case "boot":
      body = <View style={styles.center}><ActivityIndicator color={C.text} /></View>;
      break;
    case "welcome":
      body = <Welcome existing={me} onDone={(i) => { setMe(i); setScreen({ name: "quiz" }); }} />;
      break;
    case "quiz":
      body = <Quiz me={me!} onDone={(g) => { setGallery(g); setScreen({ name: "home" }); }} />;
      break;
    case "home":
      body = <Home me={me!} gallery={gallery!} justBlended={screen.justBlended} onBlend={() => setScreen({ name: "lobby" })} onRetake={() => setScreen({ name: "quiz" })} />;
      break;
    case "lobby":
      body = <Lobby me={me!} onBack={() => setScreen({ name: "home" })} onBlend={(blendId) => setScreen({ name: "reveal", blendId })} />;
      break;
    case "reveal":
      body = <Reveal blendId={screen.blendId} onDone={() => refresh(screen.blendId)} />;
      break;
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
