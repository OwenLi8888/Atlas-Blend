/** Typed calls to the gallery server. Every path is same-origin under /api. */
import { cachedGet, invalidateReads } from './requestCache';
import type {
  BlendRequest,
  BlendResponse,
  BlendsResponse,
  Commission,
  CreateProfileRequest,
  CuratorNoteRequest,
  CuratorNoteResponse,
  CuratorResponse,
  DiscoverResponse,
  ErrorResponse,
  HeartRequest,
  HeartResponse,
  OnboardingResponse,
  PicksRequest,
  ProfileResponse,
  RecsResponse,
  SimilarResponse,
} from '../rec/api';

/** A request the server answered with an error, or that never reached it. */
export class ApiFailure extends Error {
  constructor(
    /** HTTP status, or 0 when the server could not be reached. */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

/** Fired on `window` when the server answers that the visitor's profile does not exist. */
export const SESSION_LOST = 'gallery-blend:session-lost';

async function networkRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, 'The gallery is not reachable right now.');
  }
  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiFailure(response.status, 'The gallery is not reachable right now.');
  }
  if (!response.ok) {
    const message = (payload as Partial<ErrorResponse> | null)?.error;
    // The server no longer has this visitor's profile: whatever screen is open, start again.
    if (response.status === 404 && message === 'Profile not found') window.dispatchEvent(new Event(SESSION_LOST));
    throw new ApiFailure(response.status, typeof message === 'string' ? message : 'Something went wrong.');
  }
  return payload as T;
}

function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (method === 'GET') {
    // Short-lived recs survive tab switches; profile/status reads only share in-flight requests.
    const ttl = path === '/api/onboarding' ? 300_000 : path.startsWith('/api/recs/') ? 30_000 : 0;
    return cachedGet(path, () => networkRequest<T>(method, path), ttl);
  }
  invalidateReads();
  return networkRequest<T>(method, path, body).finally(invalidateReads);
}

export const api = {
  onboarding: () => request<OnboardingResponse>('GET', '/api/onboarding'),
  /** Signs up with the works chosen at the entrance; the profile and its hearts are made together. */
  createProfile: (name: string, picks: string[]) =>
    request<ProfileResponse>('POST', '/api/profile', { name, picks } satisfies CreateProfileRequest),
  /** Chooses again for a profile left with no hearts. */
  choosePicks: (userId: string, picks: string[]) =>
    request<ProfileResponse>('POST', '/api/profile/' + userId + '/picks', { picks } satisfies PicksRequest),
  profile: (userId: string) => request<ProfileResponse>('GET', '/api/profile/' + userId),
  heart: (userId: string, artId: string, why?: string) =>
    request<HeartResponse>('POST', '/api/heart', { user_id: userId, art_id: artId, why } satisfies HeartRequest),
  unheart: (userId: string, artId: string) =>
    request<void>('DELETE', '/api/heart?user_id=' + userId + '&art_id=' + encodeURIComponent(artId)),
  recs: (userId: string) => request<RecsResponse>('GET', '/api/recs/' + userId),
  discover: (seed: number, offset: number, userId: string) =>
    request<DiscoverResponse>('GET', '/api/discover?seed=' + seed + '&offset=' + offset + '&user_id=' + userId),
  similar: (artId: string) => request<SimilarResponse>('GET', '/api/similar?id=' + encodeURIComponent(artId)),
  curator: (userId: string) => request<CuratorResponse>('GET', '/api/curator/' + userId),
  curatorNote: (userId: string, text: string, question?: string) =>
    request<CuratorNoteResponse>('POST', '/api/curator/' + userId + '/note', { text, question } satisfies CuratorNoteRequest),
  blends: (userId: string) => request<BlendsResponse>('GET', '/api/blends/' + userId),
  savedBlend: (blendId: string, userId: string) => request<BlendResponse>('GET', '/api/blend/' + blendId + '?user_id=' + userId),
  blend: (userId: string, code: string) =>
    request<BlendResponse>('POST', '/api/blend', { user_id: userId, code } satisfies BlendRequest),
  commission: (blendId: string) => request<Commission>('GET', '/api/blend/' + blendId + '/commission'),
  /** Same-origin copy of an artwork image, for the canvas (the image host sends no CORS headers). */
  imageUrl: (artId: string) => '/api/image?id=' + encodeURIComponent(artId),
};
