/**
 * The bridge from our screens to the Gallery API (server/, see server/README.md): profiles, hearts
 * and blends. The API is optional: every call here fails soft (null) after a short timeout, and the
 * screens then fall back to what the two devices know on their own (the picks in /api/picks).
 */
import type { BlendResponse, Commission, Profile, ProfileResponse, Recommendation, RecsResponse } from '../rec/api';

export interface GalleryPlayer {
  profileId: string;
  blendCode: string;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 4000): Promise<T | null> {
  try {
    const res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    // A dev server without the API answers /api/* with index.html: anything that is not JSON is "no".
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Makes a profile for this player. Null when the Gallery API is not running. */
export async function joinGallery(name: string): Promise<GalleryPlayer | null> {
  const profile = await call<Profile>('POST', 'api/profile', { name });
  return profile?.id && profile.blend_code ? { profileId: profile.id, blendCode: profile.blend_code } : null;
}

/** Hearts the picked artworks, so the player's taste exists before a blend. Unknown works are skipped. */
export async function heartPicks(player: GalleryPlayer, artIds: string[]): Promise<void> {
  await Promise.all(artIds.map((art_id) => call('POST', 'api/heart', { user_id: player.profileId, art_id })));
}

/** Blends this player with the friend whose code this is. Null when it cannot be done. */
export function blendWith(player: GalleryPlayer, friendCode: string): Promise<BlendResponse | null> {
  return call<BlendResponse>('POST', 'api/blend', { user_id: player.profileId, code: friendCode }, 12000);
}

/**
 * Waits for the piece made for the two people (image, then its wall label). Resolves with the last
 * state seen once the image is ready and the label is settled, when it fails, or at the deadline.
 */
export async function waitForCommission(blendId: string, first: Commission, deadlineMs = 30000): Promise<Commission> {
  let last = first;
  const end = Date.now() + deadlineMs;
  const settled = (c: Commission) =>
    c.status === 'failed' || c.status === 'unavailable' || (c.status === 'ready' && c.label_status !== 'pending');
  while (!settled(last) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 1200));
    last = (await call<Commission>('GET', `api/blend/${blendId}/commission`)) ?? last;
  }
  return last;
}

/** Same-origin copy of a collection artwork's image (the image host sends no CORS headers). */
export const artworkImageUrl = (artId: string) => `api/image?id=${encodeURIComponent(artId)}`;

/** The works the gallery recommends to this profile, best first. Empty until they have a heart, or when the API is not running. */
export async function recommendations(profileId: string): Promise<Recommendation[]> {
  const recs = await call<RecsResponse>('GET', `api/recs/${encodeURIComponent(profileId)}`);
  return recs?.works ?? [];
}

/**
 * Waits until a profile has hearts: a friend's device hearts their picks a moment after it saves
 * them, and a blend or recommendations asked for before that would see an empty taste.
 */
export async function waitForHearts(profileId: string, deadlineMs = 8000): Promise<boolean> {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const profile = await call<ProfileResponse>('GET', `api/profile/${encodeURIComponent(profileId)}`);
    if (profile?.hearts?.length) return true;
    if (!profile || Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
