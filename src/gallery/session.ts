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

export function forgetUserId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }
}
