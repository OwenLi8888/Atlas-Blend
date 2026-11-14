import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "../api";
import { Button } from "../components/Button";
import { saveIdentity, type Identity } from "../identity";
import { C, serif } from "../theme";

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
      <View style={{ flex: 1, justifyContent: "center", gap: 14 }}>
        <Text style={styles.logo}>Blend</Text>
        <Text style={styles.tag}>Spotify Blend, for art. Build a gallery in five quick rounds, blend it with a friend's, and watch a new painting paint itself.</Text>
      </View>
      <View style={{ gap: 12 }}>
        <Text style={styles.label}>What should we call you?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={C.faint}
          style={styles.input}
          autoFocus
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
  logo: { color: C.text, fontSize: 64, fontFamily: serif },
  tag: { color: C.dim, fontSize: 17, lineHeight: 25 },
  label: { color: C.dim, fontSize: 14 },
  input: { height: 56, borderRadius: 16, backgroundColor: C.panel, color: C.text, fontSize: 18, paddingHorizontal: 18, borderWidth: 1, borderColor: C.line },
  err: { color: C.danger, fontSize: 13 },
});
