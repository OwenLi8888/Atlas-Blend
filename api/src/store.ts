/**
 * Persistence. Supabase (Postgres + Storage) when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
 * set; otherwise a local JSON file store + files served from data/runtime. Same interface.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RUNTIME } from "./paths.js";

export interface User { id: string; display_name: string; created_at: string }
export interface Gallery {
  user_id: string;
  artwork_ids: string[];
  means: Record<string, unknown>;
  spreads: Record<string, unknown>;
  centroid: number[];
  title: string;
  summary: Record<string, unknown>; // bars, top subjects, top hues, dominant medium
  blend_tiles: BlendTile[];
  updated_at: string;
}
export interface BlendTile { blend_id: string; thumb_url: string; video_url: string; partner: string; score: number }
export interface Session {
  code: string; host_id: string; guest_id: string | null;
  status: "waiting" | "ready" | "painting" | "done" | "error";
  blend_id: string | null; expires_at: string; created_at: string;
}
export interface BlendEvent { seq: number; at: number; type: string; data: unknown }
export interface Blend {
  id: string; session_code: string | null; user_a: string; user_b: string;
  status: "matching" | "painting" | "ready" | "error";
  score: number | null; per_variable: unknown; pairs: unknown; groups: unknown; targets: unknown;
  references: unknown; medium: string | null; prompt: string | null; still_source: string | null;
  painting_variables: unknown; gallery_a: unknown; gallery_b: unknown; names: { a: string; b: string };
  still_url: string | null; thumb_url: string | null; video_url: string | null;
  panel: unknown; panel_status: "pending" | "ready" | "error";
  video_status: "pending" | "ready" | "error";
  cache_key: string; timings: Record<string, number>; error: string | null;
  events: BlendEvent[]; created_at: string;
}

export interface Store {
  kind: "file" | "supabase";
  getUser(id: string): Promise<User | null>;
  upsertUser(u: User): Promise<User>;
  getGallery(userId: string): Promise<Gallery | null>;
  saveGallery(g: Gallery): Promise<Gallery>;
  getSession(code: string): Promise<Session | null>;
  saveSession(s: Session): Promise<Session>;
  getBlend(id: string): Promise<Blend | null>;
  findBlendByCacheKey(key: string): Promise<Blend | null>;
  saveBlend(b: Blend): Promise<Blend>;
  /** Copies a local file into storage and returns a URL path or absolute URL. */
  putFile(localPath: string, key: string, contentType: string): Promise<string>;
}

// ------------------------------------------------------------------ file store
interface DB { users: Record<string, User>; galleries: Record<string, Gallery>; sessions: Record<string, Session>; blends: Record<string, Blend> }

class FileStore implements Store {
  kind = "file" as const;
  private path = join(RUNTIME, "db.json");
  private db: DB;
  private timer: NodeJS.Timeout | null = null;
  constructor() {
    mkdirSync(RUNTIME, { recursive: true });
    this.db = existsSync(this.path)
      ? JSON.parse(readFileSync(this.path, "utf8"))
      : { users: {}, galleries: {}, sessions: {}, blends: {} };
  }
  private flush() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      writeFileSync(this.path, JSON.stringify(this.db));
    }, 150);
  }
  async getUser(id: string) { return this.db.users[id] ?? null; }
  async upsertUser(u: User) { this.db.users[u.id] = { ...this.db.users[u.id], ...u }; this.flush(); return this.db.users[u.id]; }
  async getGallery(id: string) { return this.db.galleries[id] ?? null; }
  async saveGallery(g: Gallery) { this.db.galleries[g.user_id] = g; this.flush(); return g; }
  async getSession(c: string) { return this.db.sessions[c] ?? null; }
  async saveSession(s: Session) { this.db.sessions[s.code] = s; this.flush(); return s; }
  async getBlend(id: string) { return this.db.blends[id] ?? null; }
  async findBlendByCacheKey(k: string) {
    return Object.values(this.db.blends).find((b) => b.cache_key === k && b.status === "ready" && b.panel_status === "ready") ?? null;
  }
  async saveBlend(b: Blend) { this.db.blends[b.id] = b; this.flush(); return b; }
  async putFile(localPath: string, key: string) {
    const dest = join(RUNTIME, "files", key);
    if (localPath !== dest) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(localPath, dest);
    }
    return `/files/${key}`;
  }
}

// -------------------------------------------------------------- supabase store
class SupabaseStore implements Store {
  kind = "supabase" as const;
  private sb: SupabaseClient;
  private bucket = process.env.SUPABASE_BUCKET ?? "blend";
  constructor(url: string, key: string) {
    this.sb = createClient(url, key, { auth: { persistSession: false } });
  }
  private async one<T>(table: string, col: string, val: string): Promise<T | null> {
    const { data, error } = await this.sb.from(table).select("*").eq(col, val).maybeSingle();
    if (error) throw error;
    return (data as T) ?? null;
  }
  private async up<T extends object>(table: string, row: T, onConflict: string): Promise<T> {
    const { data, error } = await this.sb.from(table).upsert(row as never, { onConflict }).select().single();
    if (error) throw error;
    return data as T;
  }
  getUser(id: string) { return this.one<User>("users", "id", id); }
  upsertUser(u: User) { return this.up("users", u, "id"); }
  getGallery(id: string) { return this.one<Gallery>("galleries", "user_id", id); }
  saveGallery(g: Gallery) { return this.up("galleries", g, "user_id"); }
  getSession(c: string) { return this.one<Session>("sessions", "code", c); }
  saveSession(s: Session) { return this.up("sessions", s, "code"); }
  getBlend(id: string) { return this.one<Blend>("blends", "id", id); }
  async findBlendByCacheKey(k: string) {
    const { data } = await this.sb.from("blends").select("*").eq("cache_key", k).eq("status", "ready")
      .eq("panel_status", "ready").limit(1);
    return (data?.[0] as Blend) ?? null;
  }
  saveBlend(b: Blend) { return this.up("blends", b, "id"); }
  async putFile(localPath: string, key: string, contentType: string) {
    const body = readFileSync(localPath);
    const { error } = await this.sb.storage.from(this.bucket).upload(key, body, { contentType, upsert: true });
    if (error) throw error;
    return this.sb.storage.from(this.bucket).getPublicUrl(key).data.publicUrl;
  }
}

export function makeStore(): Store {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return new SupabaseStore(url, key);
  return new FileStore();
}
