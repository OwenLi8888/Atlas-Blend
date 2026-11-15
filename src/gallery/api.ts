/** Typed calls to the gallery server. Every path is same-origin under /api. */
import type {
  BlendRequest,
  BlendResponse,
  CreateProfileRequest,
  ErrorResponse,
  HeartRequest,
  HeartResponse,
  OnboardingResponse,
  Profile,
  ProfileResponse,
  RecsResponse,
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

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
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
    throw new ApiFailure(response.status, typeof message === 'string' ? message : 'Something went wrong.');
  }
  return payload as T;
}

export const api = {
  onboarding: () => request<OnboardingResponse>('GET', '/api/onboarding'),
  createProfile: (name: string) => request<Profile>('POST', '/api/profile', { name } satisfies CreateProfileRequest),
  profile: (userId: string) => request<ProfileResponse>('GET', '/api/profile/' + userId),
  heart: (userId: string, artId: string, why?: string) =>
    request<HeartResponse>('POST', '/api/heart', { user_id: userId, art_id: artId, why } satisfies HeartRequest),
  unheart: (userId: string, artId: string) =>
    request<void>('DELETE', '/api/heart?user_id=' + userId + '&art_id=' + encodeURIComponent(artId)),
  recs: (userId: string) => request<RecsResponse>('GET', '/api/recs/' + userId),
  blend: (userId: string, code: string) =>
    request<BlendResponse>('POST', '/api/blend', { user_id: userId, code } satisfies BlendRequest),
  /** Same-origin copy of an artwork image, for the canvas (the image host sends no CORS headers). */
  imageUrl: (artId: string) => '/api/image?id=' + encodeURIComponent(artId),
};
