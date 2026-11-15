/**
 * The contract between the gallery server and the frontend.
 * Types only: both sides import from here so the shapes cannot drift apart.
 */

export interface Artwork {
  id: string;
  title: string;
  artist: string;
  date: string | null;
  medium: string | null;
  /** Museum or gallery the work comes from, e.g. "moma". */
  source: string;
  /** Human-readable name of the visual family the work belongs to. */
  cluster: string;
  cluster_id: number;
  image_url: string;
  caption: string | null;
}

export interface Profile {
  id: string;
  name: string;
  blend_code: string;
  created_at: string;
}

export interface Heart {
  art_id: string;
  why: string | null;
  created_at: string;
}

export interface HeartedWork {
  work: Artwork;
  why: string | null;
  hearted_at: string;
}

/** POST /api/profile */
export interface CreateProfileRequest {
  name: string;
}

/** GET /api/profile/:user_id */
export interface ProfileResponse {
  profile: Profile;
  /** Newest first. */
  hearts: HeartedWork[];
}

/** GET /api/onboarding */
export interface OnboardingResponse {
  works: Artwork[];
  min_picks: number;
}

/** POST /api/heart */
export interface HeartRequest {
  user_id: string;
  art_id: string;
  /** Omit to keep whatever reason was saved before. */
  why?: string;
}

export interface HeartResponse {
  heart: Heart;
}

export interface Recommendation {
  work: Artwork;
  /** The hearted work this recommendation is closest to. */
  because: Artwork;
}

/** GET /api/recs/:user_id */
export interface RecsResponse {
  /** Empty until the person has hearted something. */
  works: Recommendation[];
  /** How many separate tastes the hearts were grouped into (0 to 3). */
  taste_count: number;
}

/** POST /api/blend */
export interface BlendRequest {
  user_id: string;
  code: string;
}

/** One of a person's leanings: a group of similar hearts, summed up. */
export interface Trend {
  /** Name of the visual family most of the group belongs to. */
  family: string;
  /** Share of the person's hearts in this group, 0 to 1. */
  share: number;
  /** A few hearts from the group, the most central first. */
  works: Artwork[];
  /** A reason the person gave for one of these hearts, if they gave any. */
  why: string | null;
}

/**
 * The piece made for the two people. `pending` while it is being made,
 * `unavailable` when this server has no image model, in which case the blend
 * reveals `top_artwork` instead.
 */
export interface Commission {
  status: 'pending' | 'ready' | 'failed' | 'unavailable';
  /** Same-origin address of the finished image; null until it is ready. */
  image_url: string | null;
  /** A plain title, there from the start; the label's title replaces it once written. */
  title: string | null;
  /** Whether the wall label has been written. It can arrive after the image. */
  label_status: 'pending' | 'ready' | 'failed' | 'unavailable';
  label: CommissionLabel | null;
}

/** The wall label written for a commissioned piece. */
export interface CommissionLabel {
  title: string;
  /** Wall text describing the piece, with both people's loves woven through it. */
  story: string;
}

/** Whose work a piece on the shared wall is. */
export type WallSource =
  /** One of your hearts that your friend is close to. */
  | 'you'
  /** One of your friend's hearts that you are close to. */
  | 'friend'
  /** A work you both hearted. */
  | 'both'
  /** A work neither of you has hearted, close to both. */
  | 'new';

export interface WallItem {
  work: Artwork;
  from: WallSource;
}

export interface BlendResponse {
  id: string;
  created_at: string;
  friend: { name: string };
  /** Taste match, 50 to 100: lifted and curved from the raw overlap so it reads like a familiar match score. */
  score: number;
  /** A new artwork made for the two of them: the centrepiece. Poll GET /api/blend/:id/commission. */
  commission: Commission;
  /** The work in the collection that best fits both people's whole taste. */
  top_artwork: Artwork;
  /**
   * The shared wall, in hanging order: works you both hearted, each person's
   * hearts the other is closest to, and new works for both. Never the reveal.
   */
  wall: WallItem[];
  /** What each person leans toward, largest leaning first. */
  trends: { you: Trend[]; friend: Trend[] };
  story: string;
}

export interface ErrorResponse {
  error: string;
}
