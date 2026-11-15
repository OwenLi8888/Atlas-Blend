/** Remembers which profile this browser belongs to. Storage can be blocked, so every call is guarded. */
const KEY = 'gallery-blend.user-id';

export function rememberedUserId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberUserId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Without storage the gallery still works; it just asks again after a reload.
  }
}

/**
 * A new random profile ID (a version 4 UUID). `crypto.randomUUID` only exists
 * on secure pages, and the dev server opened from a phone is plain http.
 */
export function newUserId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function forgetUserId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }
}
