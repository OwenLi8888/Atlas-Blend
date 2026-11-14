import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

/** v1 identity: a device id plus a display name. No accounts. */
export interface Identity { id: string; name: string }

const KEY = "blend.identity.v1";

export async function loadIdentity(): Promise<Identity | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export async function saveIdentity(name: string, existing?: Identity | null): Promise<Identity> {
  const id = existing?.id ?? `dev-${Crypto.randomUUID()}`;
  const ident = { id, name: name.trim().slice(0, 24) };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(ident));
  } catch { /* storage unavailable: identity lives for this session only */ }
  return ident;
}
