import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api, type Session } from "../api";
import { Button } from "../components/Button";
import type { Identity } from "../identity";
import { Ticket } from "../components/Ticket";
import { StatusBar } from "expo-status-bar";
import { C, S, kicker, titleFace } from "../theme";

/**
 * Flow B (M5): get a 6-character code or enter a friend's. Both phones poll the session and
 * show "Ready" once both galleries exist; the host taps Paint; both phones jump to the reveal
 * as soon as the session has a blend id.
 */
export function Lobby({ me, onBack, onBlend }: { me: Identity; onBack: () => void; onBlend: (blendId: string, s: Session) => void }) {
  const [mode, setMode] = useState<"pick" | "host" | "join">("pick");
  const [session, setSession] = useState<Session | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  // live readiness: poll the session every second (reconnect-safe: the code is the state)
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.session(session.code);
        if (!alive) return;
        setSession(s);
        if (s.blend_id && !started.current) {
          started.current = true;
          onBlend(s.blend_id, s);
        }
      } catch { /* transient network blip: keep polling */ }
    };
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [session?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const host = () => run(async () => { setSession(await api.createSession(me.id)); setMode("host"); });
  const join = () => run(async () => { setSession(await api.join(code.trim().toUpperCase(), me.id)); });
  const demo = () => run(async () => { setSession(await api.demoTeammate(me.id)); setMode("host"); });
  const paint = () => run(async () => {
    const { blend_id } = await api.paint(session!.code, me.id);
    if (!started.current) { started.current = true; onBlend(blend_id, session!); }
  });

  const isHost = session?.host?.id === me.id;
  const other = isHost ? session?.guest : session?.host;

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style={S.statusBar} />
      <Pressable onPress={onBack}><Text style={styles.back}>‹ Gallery</Text></Pressable>
      <Text style={styles.title}>Blend</Text>

      {!session && mode === "pick" && (
        <View style={{ gap: 12, marginTop: 24 }}>
          <Text style={styles.body}>Every blend needs two galleries. Share a code, or enter the one on your friend's phone.</Text>
          <Button title="Get a join code" onPress={host} busy={busy} />
          <Button title="Enter a code" kind="ghost" onPress={() => setMode("join")} />
          <Pressable onPress={demo} style={{ marginTop: 8 }}>
            <Text style={styles.demo}>No one nearby? Blend with a demo teammate</Text>
          </Pressable>
        </View>
      )}

      {!session && mode === "join" && (
        <View style={{ gap: 12, marginTop: 24 }}>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            placeholder="ABC123"
            placeholderTextColor={C.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            style={styles.codeInput}
          />
          <Button title="Join" onPress={join} disabled={code.length !== 6} busy={busy} />
          <Button title="Cancel" kind="ghost" onPress={() => setMode("pick")} />
        </View>
      )}

      {session && (
        <View style={{ gap: 18, marginTop: 24 }}>
          <Ticket
            tilt={1}
            stub={
              <View style={styles.codeBox}>
                <Text style={styles.kicker}>{S.copy.codeKicker}</Text>
                <Text style={styles.code}>{session.code}</Text>
              </View>
            }
          >
            <Text style={styles.note}>{S.copy.codeNote}</Text>
          </Ticket>
          <Person name={session.host?.name ?? "?"} title={session.host?.title} ready={!!session.host?.has_gallery} color={C.a} you={isHost} />
          <Person name={session.guest?.name ?? "Waiting for a friend…"} title={session.guest?.title}
            ready={!!session.guest?.has_gallery} color={C.b} you={!isHost && !!session.guest} pending={!session.guest} />
          {session.ready && isHost && <Button title="Paint" onPress={paint} busy={busy} />}
          {session.ready && !isHost && <Text style={styles.wait}>Ready. Waiting for {other?.name} to tap Paint…</Text>}
          {session.status === "expired" && <Text style={styles.err}>This code expired. Go back and get a new one.</Text>}
        </View>
      )}
      {err && <Text style={styles.err}>{err}</Text>}
    </KeyboardAvoidingView>
  );
}

function Person({ name, title, ready, color, you, pending }: { name: string; title?: string | null; ready: boolean; color: string; you?: boolean; pending?: boolean }) {
  return (
    <View style={[styles.person, { borderColor: pending ? C.line : color }]}>
      <View style={[styles.swatch, { backgroundColor: pending ? C.line : color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.pname}>{name}{you ? " (you)" : ""}</Text>
        {!!title && <Text style={styles.ptitle}>{title}</Text>}
      </View>
      <Text style={[styles.ready, { color: ready ? color : C.faint }]}>{pending ? "" : ready ? "Ready" : "Building…"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24 },
  back: { color: C.dim, fontSize: 15 },
  title: { ...titleFace, color: C.text, fontSize: 52, lineHeight: 60, marginTop: 10 },
  body: { color: C.dim, fontSize: 16, lineHeight: 24, marginBottom: 8 },
  demo: { color: C.dim, fontSize: 13, textAlign: "center", textDecorationLine: "underline" },
  codeInput: { ...S.plaque, height: 72, backgroundColor: C.paper, borderColor: C.ink, color: C.ink, fontSize: 34, letterSpacing: 10, textAlign: "center", fontWeight: "700" },
  codeBox: { alignItems: "center", gap: 4 },
  kicker: { ...kicker, color: C.inkDim },
  code: { color: C.ink, fontSize: 44, letterSpacing: 8, fontFamily: S.display },
  note: { color: C.inkDim, fontSize: 17, fontFamily: S.hand, textAlign: "center" },
  // a plaque per person; its shape comes from the skin, its border colour from the person
  person: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, ...S.plaque },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  pname: { color: C.text, fontSize: 16, fontWeight: "600" },
  ptitle: { color: C.dim, fontSize: 13 },
  ready: { fontSize: 14, fontWeight: "700" },
  wait: { color: C.dim, fontSize: 14, textAlign: "center" },
  err: { color: C.danger, fontSize: 13, marginTop: 12, textAlign: "center" },
});
