import express, { type NextFunction, type Request, type Response } from 'express';
import type {
  Artwork,
  BlendResponse,
  Commission,
  HeartResponse,
  OnboardingResponse,
  Profile,
  ProfileResponse,
  RecsResponse,
  Trend,
  WallItem,
} from '../src/rec/api';
import {
  blendScores,
  closeness,
  findTastes,
  nearest,
  overlapPercent,
  recommend,
  selectDiverse,
  similarity,
  topIndices,
  type Taste,
} from '../src/rec/scoring';
import type { Catalog } from './catalog';
import { noCommissions, type Commissions } from './commission';
import type { Db } from './db';
import { ApiError } from './errors';

const MIN_ONBOARDING_PICKS = 3;
const WALL_SIZE = 12;
/** Only the newest hearts shape a taste, so it follows what the person likes now. */
const MAX_HEARTS = 300;
/** The shared wall: this many of each person's hearts, then new works for both. */
const WALL_HEARTS_EACH = 3;
const WALL_NEW_WORKS = 6;
const BLEND_CANDIDATES = 200;
/** How many hearts illustrate each of a person's leanings. */
const TREND_EXAMPLES = 4;
const IMAGE_TIMEOUT_MS = 20_000;
/** The reveal may be any painterly work among this many best shared matches. */
const REVEAL_SEARCH_DEPTH = 20;

const MAX_NAME_LENGTH = 80;
const MAX_WHY_LENGTH = 500;
const MAX_ART_ID_LENGTH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** New codes are six letters; older profiles may have longer alphanumeric ones. */
const BLEND_CODE = /^[A-Z0-9]{6,12}$/;
/** The painting animation suits oil and watercolour. Word boundaries keep out "foil" and "oilcloth". */
const PAINTERLY_MEDIUM = /\boil\b|watercolou?r/i;
const UNKNOWN_ARTIST = /^(unknown|unidentified|anonymous|artist un(recorded|known))\b/i;

interface HeartedRow {
  index: number;
  why: string | null;
  heartedAt: string;
}

export interface AppOptions {
  /** Fetches an artwork image from where it is hosted. Replaceable for tests. */
  fetchImage?: (url: string, init: { signal: AbortSignal }) => Promise<globalThis.Response>;
  /** Makes the commissioned piece for each blend. Without it, blends reveal a work from the collection. */
  commissions?: Commissions;
}

export function createApp(catalog: Catalog, db: Db, options: AppOptions = {}) {
  const fetchImage = options.fetchImage ?? ((url, init) => fetch(url, init));
  const commissions = options.commissions ?? noCommissions;
  const { corpus, works } = catalog;
  const artistKeys = works.map(artistKey);
  const artistOf = (index: number) => artistKeys[index];
  const onboardingWorks = catalog.onboarding.map(index => works[index]);

  async function requireProfile(id: string): Promise<Profile> {
    const profile = await db.findProfile(id);
    if (!profile) throw new ApiError(404, 'Profile not found');
    return profile;
  }

  /** A person's hearts, newest first, skipping any work no longer in the catalog. */
  async function heartsOf(userId: string): Promise<HeartedRow[]> {
    const hearts = await db.listHearts(userId, MAX_HEARTS);
    const rows: HeartedRow[] = [];
    for (const heart of hearts) {
      const index = catalog.indexOf(heart.art_id);
      if (index !== undefined) rows.push({ index, why: heart.why, heartedAt: heart.created_at });
    }
    return rows;
  }

  /** A person's tastes summed up for display: the family, a few hearts, and a reason they gave. */
  function trendsOf(tastes: readonly Taste[], hearts: readonly HeartedRow[]): Trend[] {
    const reasons = new Map(hearts.map(heart => [heart.index, heart.why]));
    return tastes.map(taste => {
      const others = taste.members
        .filter(member => member !== taste.medoid)
        .map(member => ({ member, score: similarity(corpus, member, taste.medoid) }))
        .sort((a, b) => b.score - a.score || a.member - b.member)
        .map(entry => entry.member);
      return {
        family: commonFamily(taste.members.map(member => works[member].cluster), works[taste.medoid].cluster),
        share: taste.weight,
        works: [taste.medoid, ...others].slice(0, TREND_EXAMPLES).map(index => works[index]),
        why: taste.members.map(member => reasons.get(member)).find(why => why) ?? null,
      };
    });
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));

  // The API is same-origin only (reached through the /api proxy), so there is no CORS.
  app.use((req, _res, next) => {
    if (req.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'Cross-site request blocked');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, works: works.length });
  });

  app.post('/api/profile', async (req, res: Response<Profile>) => {
    const name = text(bodyField(req, 'name'), 'name', MAX_NAME_LENGTH);
    res.status(201).json(await db.createProfile(name));
  });

  app.get('/api/profile/:user_id', async (req, res: Response<ProfileResponse>) => {
    const profile = await requireProfile(uuid(req.params.user_id));
    const hearts = await heartsOf(profile.id);
    res.json({
      profile,
      hearts: hearts.map(heart => ({ work: works[heart.index], why: heart.why, hearted_at: heart.heartedAt })),
    });
  });

  app.get('/api/onboarding', (_req, res: Response<OnboardingResponse>) => {
    res.json({ works: onboardingWorks, min_picks: MIN_ONBOARDING_PICKS });
  });

  // The painting animation reads an image's pixels, which a browser only allows
  // for same-origin images. The image host sends no CORS headers, so the image
  // is passed through here.
  app.get('/api/image', async (req, res) => {
    const index = catalog.indexOf(text(req.query.id, 'id', MAX_ART_ID_LENGTH));
    if (index === undefined) throw new ApiError(404, 'Artwork not found');

    let upstream: globalThis.Response;
    try {
      upstream = await fetchImage(works[index].image_url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    } catch {
      throw new ApiError(502, 'Image host is unreachable');
    }
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !type.startsWith('image/')) throw new ApiError(502, 'Image is unavailable');

    let bytes: Buffer;
    try {
      bytes = Buffer.from(await upstream.arrayBuffer());
    } catch {
      throw new ApiError(502, 'Image host is unreachable');
    }
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(bytes);
  });

  app.post('/api/heart', async (req, res: Response<HeartResponse>) => {
    const userId = uuid(bodyField(req, 'user_id'));
    const artId = text(bodyField(req, 'art_id'), 'art_id', MAX_ART_ID_LENGTH);
    const whyField = bodyField(req, 'why');
    const why = whyField === undefined || whyField === null ? undefined : text(whyField, 'why', MAX_WHY_LENGTH);

    if (catalog.indexOf(artId) === undefined) throw new ApiError(404, 'Artwork not found');
    await requireProfile(userId);
    res.json({ heart: await db.saveHeart(userId, artId, why) });
  });

  app.delete('/api/heart', async (req, res) => {
    const userId = uuid(req.query.user_id);
    const artId = text(req.query.art_id, 'art_id', MAX_ART_ID_LENGTH);
    await requireProfile(userId);
    await db.removeHeart(userId, artId);
    res.status(204).end();
  });

  app.get('/api/recs/:user_id', async (req, res: Response<RecsResponse>) => {
    const profile = await requireProfile(uuid(req.params.user_id));
    const hearted = (await heartsOf(profile.id)).map(heart => heart.index);
    const tastes = findTastes(corpus, hearted);
    const picks = recommend(corpus, tastes, { count: WALL_SIZE, exclude: new Set(hearted), artistOf });

    res.json({
      works: picks.map(pick => {
        const because = nearest(corpus, pick.index, tastes[pick.taste].members) ?? tastes[pick.taste].medoid;
        return { work: works[pick.index], because: works[because] };
      }),
      taste_count: tastes.length,
    });
  });

  app.post('/api/blend', async (req, res: Response<BlendResponse>) => {
    const userId = uuid(bodyField(req, 'user_id'));
    const code = text(bodyField(req, 'code'), 'code', 12).toUpperCase();
    if (!BLEND_CODE.test(code)) throw new ApiError(400, 'Invalid blend code');

    const me = await requireProfile(userId);
    const friend = await db.findProfileByCode(code);
    if (!friend) throw new ApiError(404, 'Blend code not found');
    if (friend.id === me.id) throw new ApiError(400, 'That is your own code. Enter a friend’s.');

    const [mine, theirs] = await Promise.all([heartsOf(me.id), heartsOf(friend.id)]);
    if (mine.length === 0 || theirs.length === 0) throw new ApiError(409, 'Both people need at least one heart');

    const myTastes = findTastes(corpus, mine.map(heart => heart.index));
    const theirTastes = findTastes(corpus, theirs.map(heart => heart.index));
    const scores = blendScores(corpus, myTastes, theirTastes);
    const alreadyHearted = new Set([...mine, ...theirs].map(heart => heart.index));
    const candidates = topIndices(scores, BLEND_CANDIDATES, alreadyHearted);
    if (candidates.length === 0) throw new ApiError(404, 'No shared works found');

    const reveal =
      candidates.slice(0, REVEAL_SEARCH_DEPTH).find(index => isPainterly(works[index])) ?? candidates[0];
    const discoveries = selectDiverse(corpus, candidates, {
      count: WALL_NEW_WORKS,
      relevance: index => scores[index],
      shown: [reveal],
      artistOf,
    });

    // Like a shared playlist, the wall is mostly the two people's own hearts:
    // each person's works that the other is closest to.
    const myHearts = new Set(mine.map(heart => heart.index));
    const theirHearts = new Set(theirs.map(heart => heart.index));
    const both = [...myHearts].filter(index => theirHearts.has(index));
    const closestTo = (hearts: ReadonlySet<number>, other: ReadonlySet<number>, otherTastes: typeof myTastes) =>
      [...hearts]
        .filter(index => !other.has(index))
        .map(index => ({ index, score: closeness(corpus, index, otherTastes) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, WALL_HEARTS_EACH)
        .map(entry => entry.index);
    const wall = hangWall(
      both,
      closestTo(myHearts, theirHearts, theirTastes),
      closestTo(theirHearts, myHearts, myTastes),
      discoveries,
    );

    const trends = { you: trendsOf(myTastes, mine), friend: trendsOf(theirTastes, theirs) };
    const story = blendStory(works[reveal], trends.you, trends.friend, friend.name);
    const saved = await db.saveBlend({
      userA: me.id,
      userB: friend.id,
      topArtId: works[reveal].id,
      pickIds: wall.map(item => works[item.index].id),
      story,
    });

    const commission = commissions.start({
      blendId: saved.id,
      you: { name: me.name, trends: trends.you },
      friend: { name: friend.name, trends: trends.friend },
    });

    res.json({
      id: saved.id,
      created_at: saved.created_at,
      friend: { name: friend.name },
      commission,
      score: overlapPercent(corpus, myTastes, theirTastes, catalog.calibration),
      top_artwork: works[reveal],
      wall: wall.map((item): WallItem => ({ work: works[item.index], from: item.from })),
      trends,
      story,
    });
  });

  app.get('/api/blend/:blend_id/commission', (req, res: Response<Commission>) => {
    const commission = commissions.status(uuid(req.params.blend_id, 'blend_id'));
    if (!commission) throw new ApiError(404, 'No piece is being made for this blend');
    res.json(commission);
  });

  app.get('/api/blend/:blend_id/commission/image', (req, res) => {
    const image = commissions.image(uuid(req.params.blend_id, 'blend_id'));
    if (!image) throw new ApiError(404, 'The piece is not ready');
    res.set('Content-Type', image.mimeType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(image.bytes);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    // Body-parser failures (malformed JSON, body too large) carry their own 4xx status.
    const status = clientErrorStatus(error);
    if (status !== null) {
      res.status(status).json({ error: 'Invalid request' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}

/**
 * The instant, fact-only story shown with the reveal: what each person leans
 * toward, and the work where those leanings meet.
 */
export function blendStory(reveal: Artwork, mine: readonly Trend[], theirs: readonly Trend[], friendName: string): string {
  const friend = friendName.trim() || 'Your friend';
  return (
    'You lean toward ' + listFamilies(mine) + '. ' +
    friend + ' leans toward ' + listFamilies(theirs) + '. ' +
    '“' + reveal.title + '” is where the two of you meet.'
  );
}

/** Family names that start with a proper adjective keep their capital mid-sentence. */
const PROPER_START = /^(Japanese|Indian|Barbizon|Italianate|Cubist|Romantic|Impressionist|Baroque)\b/;

function listFamilies(trends: readonly Trend[]): string {
  const names = [...new Set(trends.map(trend => trend.family))].map(name =>
    PROPER_START.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1),
  );
  if (names.length <= 1) return names[0] ?? 'a little of everything';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/** The family most of a group belongs to; on a tie, the family of its central work. */
function commonFamily(families: readonly string[], central: string): string {
  const counts = new Map<string, number>();
  for (const family of families) counts.set(family, (counts.get(family) ?? 0) + 1);
  const most = Math.max(...counts.values());
  return counts.get(central) === most ? central : [...counts].find(([, count]) => count === most)![0];
}

/**
 * Orders the shared wall: works both people hearted first, then yours, theirs
 * and new works taking turns so no stretch of the wall belongs to one person.
 */
function hangWall(
  both: readonly number[],
  mine: readonly number[],
  theirs: readonly number[],
  discoveries: readonly number[],
): { index: number; from: WallItem['from'] }[] {
  const wall: { index: number; from: WallItem['from'] }[] = both.map(index => ({ index, from: 'both' }));
  const rows = Math.max(mine.length, theirs.length, Math.ceil(discoveries.length / 2));
  for (let row = 0; row < rows; row++) {
    if (row < mine.length) wall.push({ index: mine[row], from: 'you' });
    if (row * 2 < discoveries.length) wall.push({ index: discoveries[row * 2], from: 'new' });
    if (row < theirs.length) wall.push({ index: theirs[row], from: 'friend' });
    if (row * 2 + 1 < discoveries.length) wall.push({ index: discoveries[row * 2 + 1], from: 'new' });
  }
  return wall;
}

function isPainterly(work: Artwork): boolean {
  return work.medium !== null && PAINTERLY_MEDIUM.test(work.medium);
}

/** Key for the per-artist cap, or null when the artist is unknown and should not be capped. */
function artistKey(work: Artwork): string | null {
  const artist = work.artist.trim().toLowerCase();
  return artist === '' || UNKNOWN_ARTIST.test(artist) ? null : artist;
}

function bodyField(req: Request, field: string): unknown {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) throw new ApiError(400, 'Expected a JSON body');
  return (body as Record<string, unknown>)[field];
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new ApiError(400, 'Invalid ' + label);
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > maxLength) throw new ApiError(400, 'Invalid ' + label);
  return trimmed;
}

function uuid(value: unknown, label = 'user_id'): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ApiError(400, 'Invalid ' + label);
  return value.toLowerCase();
}

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}
