import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { Button } from "../components/Button";
import { Lcd } from "../components/PixelBeaver";
import { saveIdentity, type Identity } from "../identity";
import { C, S, SKIN, kicker, titleFace } from "../theme";

/** Flow A.1: enter a display name. No account; device id + name is the identity. */
export function Welcome({ existing, onDone }: { existing: Identity | null; onDone: (i: Identity) => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const ident = await saveIdentity(name, existing);
      await api.user(ident.id, ident.name);
      onDone(ident);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style={S.statusBar} />
      <View style={{ flex: 1, justifyContent: "center", gap: 14 }}>
        {SKIN === "night" && (
          // a picture light on the wall behind the title: stacked warm discs stand in for a gradient
          <View pointerEvents="none" style={styles.light}>
            <View style={[styles.pool, { width: 340, height: 340, opacity: 0.05 }]} />
            <View style={[styles.pool, { width: 230, height: 230, opacity: 0.07 }]} />
            <View style={[styles.pool, { width: 130, height: 130, opacity: 0.09 }]} />
          </View>
        )}
        {SKIN === "scrapbook" && (
          <View pointerEvents="none" style={styles.stamp}>
            <Text style={styles.stampText}>ADMIT{"\n"}ONE{"\n"}· 2026 ·</Text>
          </View>
        )}
        {SKIN === "pet" ? (
          <>
            <Lcd text={S.copy.kicker} />
            <View style={styles.keys}>
              {["#FF6FA3", "#FFD447", "#6FE0C8"].map((c, i) => (
                <View key={c} style={[styles.key, { backgroundColor: c }, i === 1 && { marginTop: 14 }]} />
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.kicker}>{S.copy.kicker}</Text>
        )}
        <Text style={styles.logo}>Blend</Text>
        {SKIN === "night" && <View style={styles.rule} />}
        <Text style={styles.tag}>{S.copy.tag}</Text>
      </View>
      <View style={{ gap: 12 }}>
        <Text style={styles.label}>{S.copy.label}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={C.faint}
          style={S.input}
          autoFocus={SKIN !== "pet"} // the pet's LCD needs the room the keyboard would take
          maxLength={24}
          returnKeyType="go"
          onSubmitEditing={() => name.trim() && go()}
        />
        {err && <Text style={styles.err}>{err}</Text>}
        <Button title="Start the quiz" onPress={go} disabled={!name.trim()} busy={busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, paddingBottom: 36 },
  light: { position: "absolute", left: -90, top: "50%", marginTop: -210, width: 340, height: 340, alignItems: "center", justifyContent: "center" },
  pool: { position: "absolute", borderRadius: 999, backgroundColor: C.glow },
  stamp: { position: "absolute", right: 0, top: 24, width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: C.gold, alignItems: "center", justifyContent: "center", transform: [{ rotate: "14deg" }], opacity: 0.8 },
  stampText: { color: C.gold, fontSize: 9, fontWeight: "700", letterSpacing: 1.4, textAlign: "center", lineHeight: 13 },
  keys: { flexDirection: "row", justifyContent: "center", gap: 22, marginTop: 6 },
  key: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: C.ink, shadowColor: C.ink, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 4 } },
  kicker: { ...kicker, color: C.gold },
  logo: { ...titleFace, color: C.text, fontSize: SKIN === "pet" ? 56 : 88, lineHeight: SKIN === "pet" ? 62 : 98, letterSpacing: -1 },
  rule: { width: 56, height: 1, backgroundColor: C.gold },
  tag: { color: C.dim, fontSize: 17, lineHeight: 26, fontFamily: SKIN === "scrapbook" ? S.hand : undefined },
  label: SKIN === "night" ? { color: C.gold, fontSize: 20, fontFamily: S.hand } : { ...kicker, color: C.dim },
  err: { color: C.danger, fontSize: 13 },
});
