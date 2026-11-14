import { API_URL } from "./config";

export interface Artwork {
  id: string; title: string; artist: string; year: number; medium: string; brush: string;
  subjects: string[]; source_url: string; license: string; image: string;
  variables: Record<string, number>;
}
export interface Round { round: number; artwork_ids: string[]; design_note: string; artworks: Artwork[] }
export interface BlendTile { blend_id: string; thumb_url: string; video_url: string; partner: string; score: number }
export interface Gallery {
  user_id: string; title: string; artwork_ids: string[]; artworks: Artwork[];
  bars: Record<string, number>; top_subjects: string[]; top_hues: string[]; dominant_medium: string;
  blend_tiles: BlendTile[];
}
export interface SessionSide { id: string; name: string; has_gallery: boolean; title: string | null; artwork_count: number }
export interface Session {
  code: string; status: string; host: SessionSide | null; guest: SessionSide | null; ready: boolean; blend_id: string | null;
}
export interface BlendEvent { seq: number; at: number; type: string; data: any }
export interface Panel {
  combined_from: { group_id: string; label: string; kind: string; whose: string; year_span: [number, number];
    artworks: { id: string; title: string; image: string; owner: string }[] }[];
  era_span: { start: number; end: number };
  stats: { a: Record<string, number>; b: Record<string, number>; painting: Record<string, number> };
  notable_qualities: string[];
  why_matched: string;
  source_history: { artwork_id: string; title: string; artist: string; year: number; medium: string; history: string; link: string; image: string }[];
  score: number;
  agent?: { mode: string; seconds: number };
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(API_URL + path, {
      method, signal: ctl.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j as T;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Can't reach the Blend server at ${API_URL}`);
    if (String(e?.message).includes("Network request failed")) throw new Error(`Can't reach the Blend server at ${API_URL}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  quiz: () => req<{ rounds: Round[] }>("GET", "/quiz"),
  user: (id: string, display_name: string) => req("POST", "/users", { id, display_name }),
  saveGallery: (user_id: string, artwork_ids: string[]) => req<Gallery>("POST", "/gallery", { user_id, artwork_ids }),
  gallery: (userId: string) => req<Gallery>("GET", `/gallery/${userId}`),
  createSession: (host_id: string) => req<Session>("POST", "/session", { host_id }),
  session: (code: string) => req<Session>("GET", `/session/${code}`),
  join: (code: string, guest_id: string) => req<Session>("POST", `/session/${code}/join`, { guest_id }),
  paint: (code: string, user_id: string) => req<{ blend_id: string }>("POST", `/session/${code}/paint`, { user_id }),
  demoTeammate: (user_id: string) => req<Session>("POST", "/demo/teammate", { user_id }),
  blend: (id: string) => req<any>("GET", `/blends/${id}`),
  events: (id: string, after: number) => req<{ status: string; events: BlendEvent[] }>("GET", `/blends/${id}/events?after=${after}`),
};
