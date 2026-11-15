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

/** The painters a person can have: their picture, and who stands in the room when they blend. */
export type PainterId = 'ember' | 'sunny' | 'pop' | 'dot' | 'hue' | 'ivory';

/** A person's own choice of painter. */
export interface ChosenPainter {
  id: PainterId;
  /** What they call it; empty to use the painter's own name. */
  name: string;
}

export interface Profile {
  id: string;
  name: string;
  blend_code: string;
  created_at: string;
  /** Null for a profile that never chose: one is then picked for it, the same every time. */
  painter: ChosenPainter | null;
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

/**
 * POST /api/profile: signs someone up with the works they chose at the
 * entrance, in one step. Answers with a `ProfileResponse`.
 */
export interface CreateProfileRequest {
  /**
   * A new random UUID chosen by the browser, which becomes the profile's ID.
   * Sending the same request again answers with the profile already made (200)
   * instead of making another.
   */
  id: string;
  name: string;
  /** Artwork IDs; at least `min_picks` different ones. */
  picks: string[];
  /** The painter chosen at the entrance. Left out, the profile has none until one is chosen. */
  painter_id?: PainterId;
}

/** POST /api/sign-in: opens an existing gallery by its own blend code. Answers 404 when no profile has it. */
export interface SignInRequest {
  /** The person's username, or their gallery's own code. */
  code: string;
  /** Needed when the gallery has a passcode (401 without it, or with the wrong one). */
  passcode?: string;
}

/** POST /api/profile/:user_id/passcode: sets or changes the passcode, 4 to 64 characters. Answers 204. */
export interface PasscodeRequest {
  passcode: string;
  /** 3 to 20 letters, numbers or underscores; to sign in with instead of the code. 409 when taken. */
  username?: string;
}

/** POST /api/profile/:user_id/painter: chooses the person's painter, or renames it. */
export type PainterRequest = ChosenPainter;

export interface PainterResponse {
  /** The choice as saved: the name trimmed. */
  painter: ChosenPainter;
}

/**
 * POST /api/profile/:user_id/picks: someone who removed every heart choosing
 * again. Answers with a `ProfileResponse`.
 */
export interface PicksRequest {
  /** Artwork IDs; at least `min_picks` different ones. */
  picks: string[];
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

/** GET /api/recs/:user_id?count= */
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

/** The other person in a blend, as much of them as their friend is shown. */
export interface Friend {
  name: string;
  /** The painter they chose, or null when they have not chosen one. */
  painter: ChosenPainter | null;
}

export interface BlendResponse {
  id: string;
  created_at: string;
  friend: Friend;
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

/** A saved blend as it appears in a list. */
export interface BlendSummary {
  id: string;
  created_at: string;
  friend: { name: string };
  score: number;
  /** Title of the piece made for the blend, if one was made. */
  title: string | null;
  /** The piece made for the blend, or null when there is none. */
  image_url: string | null;
  /** The collection work that best fits both people; shown when there is no piece. */
  top_artwork: Artwork;
}

/** GET /api/blends/:user_id */
export interface BlendsResponse {
  /** Newest first. Includes blends other people made with this person. */
  blends: BlendSummary[];
}

/** GET /api/discover?seed=&offset=&limit= */
export interface DiscoverResponse {
  works: Artwork[];
  /** Pass as `offset` for the next page; null at the end of the collection. */
  next_offset: number | null;
}

/** GET /api/similar?id=&limit= */
export interface SimilarResponse {
  work: Artwork;
  similar: Artwork[];
}

/** A room the curator hung: works that belong together, with a short text on why. */
export interface Room {
  title: string;
  text: string;
  /** In hanging order. Some are the person's saved works, some are new to them. */
  works: Artwork[];
}

/** GET /api/curator/:user_id */
export interface CuratorResponse {
  /** `working` while the curator is rehanging; `unavailable` when this server has no curator. */
  status: 'working' | 'ready' | 'unavailable';
  /** A sentence or two on what the person keeps saving; null until the curator has written one. */
  portrait: string | null;
  /** One easy question from the curator, with short answers to pick from; null when it has none. */
  question: { text: string; answers: string[] } | null;
  rooms: Room[];
  /** How many more works the person must save before rooms are hung; 0 once there are enough. */
  saves_until_rooms: number;
}

/** POST /api/curator/:user_id/note */
export interface CuratorNoteRequest {
  text: string;
  /** The curator's question this answers, when it answers one. */
  question?: string;
}

export interface CuratorNoteResponse {
  reply: string;
}

export interface ErrorResponse {
  error: string;
}
