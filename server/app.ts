import express, { type NextFunction, type Request, type Response } from 'express';
import type {
  Artwork,
  BlendResponse,
  BlendsResponse,
  BlendSummary,
  Commission,
  CuratorNoteResponse,
  CuratorResponse,
  DiscoverResponse,
  Friend,
  HeartResponse,
  OnboardingResponse,
  PainterId,
  PainterResponse,
  Profile,
  ProfileResponse,
  RecsResponse,
  SimilarResponse,
  Trend,
  WallItem,
  WallSource,
} from '../src/rec/api';
import {
  blendScores,
  closeness,
  findTastes,
  nearest,
  overlapPercent,
  recommend,
  selectDiverse,
  similaritiesTo,
  similarity,
  topIndices,
  type Taste,
} from '../src/rec/scoring';
import type { Catalog } from './catalog';
import { noCommissions, type Commissions } from './commission';
import { ROOMS_MIN_SAVED, type Curator, type CuratorPerson } from './curator';
import { MAX_PAINTER_NAME_LENGTH, isPainterId, type BlendRecord, type Db, type StoredBlend, type StoredTrend } from './db';
import { ApiError } from './errors';
import { resizedImages } from './images';

const MIN_ONBOARDING_PICKS = 3;
/** Far more than the entrance shows; only stops a request from hearting the whole collection at once. */
const MAX_ONBOARDING_PICKS = 100;
/** Works on the recommended wall: the default, and the most a request may ask for. */
const WALL_SIZE = 24;
const MAX_WALL_SIZE = 48;
/** Only the newest hearts shape a taste, so it follows what the person likes now. */
const MAX_HEARTS = 300;
/** The shared wall: this many of each person's hearts, then new works for both. */
const WALL_HEARTS_EACH = 3;
const WALL_NEW_WORKS = 6;
const BLEND_CANDIDATES = 200;
/**
 * How many of a person's tastes a blend names as their leanings, largest
 * first. Scoring uses every taste; the page and the commissioned piece only
 * have room for the main ones.
 */
const LEANINGS_SHOWN = 3;
/** How many hearts illustrate each of a person's leanings. */
const TREND_EXAMPLES = 4;
const IMAGE_TIMEOUT_MS = 20_000;
const MAX_BLENDS_LISTED = 50;
/** Discovery pages. */
const DISCOVER_PAGE = 30;
const MAX_DISCOVER_PAGE = 60;
/** In a personal stroll, every this-many-th work is one the person is likely to love. */
const DISCOVER_LIKELY_EVERY = 6;
const SIMILAR_COUNT = 12;
const MAX_SIMILAR_COUNT = 24;
/** Similar works are picked for variety from this many nearest neighbours. */
const SIMILAR_CANDIDATES = 80;
/** How many discovery orders are kept ready; each visitor's seed has its own. */
const MAX_DISCOVER_ORDERS = 20;
/** The reveal may be any painterly work among this many best shared matches. */
const REVEAL_SEARCH_DEPTH = 20;

const MAX_NAME_LENGTH = 80;
const MAX_WHY_LENGTH = 500;
const MAX_NOTE_LENGTH = 600;
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
  /** Keeps notes on each person and hangs their rooms. Without it there are no portraits or rooms. */
  curator?: Curator;
}

export function createApp(catalog: Catalog, db: Db, options: AppOptions = {}) {
  const fetchImage = options.fetchImage ?? ((url, init) => fetch(url, init));
  const commissions = options.commissions ?? noCommissions;
  const curator = options.curator;
  const { corpus, works } = catalog;
  const artistKeys = works.map(artistKey);
  const artistOf = (index: number) => artistKeys[index];
  const onboardingWorks = catalog.onboarding.map(index => works[index]);
  // A family's name, from any member that carries it: a work that hardly
  // resembles its family is shown without the name but still counts as a member.
  const familyNames = new Map<number, string>();
  for (const work of works) if (work.cluster && !familyNames.has(work.cluster_id)) familyNames.set(work.cluster_id, work.cluster);

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

  /** A person's main tastes summed up for keeping: the family, a few hearts by ID, and a reason they gave. */
  function storedTrends(tastes: readonly Taste[], hearts: readonly HeartedRow[]): StoredTrend[] {
    const reasons = new Map(hearts.map(heart => [heart.index, heart.why]));
    return tastes.slice(0, LEANINGS_SHOWN).map(taste => {
      const others = taste.members
        .filter(member => member !== taste.medoid)
        .map(member => ({ member, score: similarity(corpus, member, taste.medoid) }))
        .sort((a, b) => b.score - a.score || a.member - b.member)
        .map(entry => entry.member);
      return {
        family: familyNames.get(commonFamily(taste.members.map(member => works[member].cluster_id), works[taste.medoid].cluster_id)) ?? '',
        share: taste.weight,
        why: taste.members.map(member => reasons.get(member)).find(why => why) ?? null,
        workIds: [taste.medoid, ...others].slice(0, TREND_EXAMPLES).map(index => works[index].id),
      };
    });
  }

  /** Looks artworks up again by ID; any that have left the catalog are skipped. */
  const worksById = (ids: readonly string[]): Artwork[] =>
    ids.flatMap(id => {
      const index = catalog.indexOf(id);
      return index === undefined ? [] : [works[index]];
    });

  const toTrend = (trend: StoredTrend): Trend => ({
    family: trend.family,
    share: trend.share,
    why: trend.why,
    works: worksById(trend.workIds),
  });

  /** A blend as its response, from the point of view of `viewerId` (either of the two people). */
  function presentBlend(
    record: BlendRecord,
    result: StoredBlend,
    viewerId: string,
    friend: Friend,
    commission: Commission,
  ): BlendResponse {
    const viewerIsA = record.userA === viewerId;
    const mine = (viewerIsA ? result.trends.a : result.trends.b).map(toTrend).filter(trend => trend.works.length > 0);
    const theirs = (viewerIsA ? result.trends.b : result.trends.a).map(toTrend).filter(trend => trend.works.length > 0);
    const reveal = worksById([result.revealId])[0];
    const flip: Record<WallSource, WallSource> = { you: 'friend', friend: 'you', both: 'both', new: 'new' };

    return {
      id: record.id,
      created_at: record.created_at,
      friend,
      commission,
      score: result.score,
      top_artwork: reveal,
      wall: result.wall.flatMap(({ id, from }): WallItem[] => {
        const work = worksById([id])[0];
        return work ? [{ work, from: viewerIsA ? from : flip[from] }] : [];
      }),
      trends: { you: mine, friend: theirs },
      story: blendStory(reveal, mine, theirs, friend.name),
    };
  }

  /** The other person in a blend, as the viewer is shown them. Their profile's ID is never part of it. */
  const asFriend = (profile: Profile | null): Friend => ({ name: profile?.name ?? '', painter: profile?.painter ?? null });

  async function otherPerson(record: BlendRecord, viewerId: string): Promise<Friend> {
    return asFriend(await db.findProfile(record.userA === viewerId ? record.userB : record.userA));
  }

  /**
   * An order for strolling the whole collection: each visual family is shuffled,
   * then the families take turns, so neighbours on the page differ and no stretch
   * is all one kind of work.
   */
  const discoverOrders = new Map<number, number[]>();
  function discoverOrder(seed: number): number[] {
    const ready = discoverOrders.get(seed);
    if (ready) return ready;

    const random = seededRandom(seed);
    const families = new Map<number, number[]>();
    works.forEach((work, index) => {
      const family = families.get(work.cluster_id);
      if (family) family.push(index);
      else families.set(work.cluster_id, [index]);
    });
    const queues = [...families.values()].map(members => shuffled(members, random));
    const order: number[] = [];
    while (order.length < works.length) {
      // Each round takes one work from every family that still has any, in a fresh order.
      for (const queue of shuffled(queues.filter(queue => queue.length > 0), random)) {
        const next = queue.pop();
        if (next !== undefined) order.push(next);
      }
    }

    discoverOrders.set(seed, order);
    for (const oldest of discoverOrders.keys()) {
      if (discoverOrders.size <= MAX_DISCOVER_ORDERS) break;
      discoverOrders.delete(oldest);
    }
    return order;
  }

  /**
   * The stroll for one person: the same varied order, with a work they are
   * likely to love slipped in after every few others. It is worked out once
   * per seed and person, so pages stay consistent while they scroll.
   */
  const personalOrders = new Map<string, number[]>();
  async function personalOrder(seed: number, userId: string): Promise<number[]> {
    const key = seed + ':' + userId;
    const ready = personalOrders.get(key);
    if (ready) return ready;

    const profile = await requireProfile(userId);
    const hearted = (await heartsOf(profile.id)).map(heart => heart.index);
    const likely = recommend(corpus, findTastes(corpus, hearted), {
      count: MAX_WALL_SIZE,
      exclude: new Set(hearted),
      artistOf,
    }).map(pick => pick.index);

    const slipped = new Set(likely);
    const order: number[] = [];
    let next = 0;
    for (const index of discoverOrder(seed)) {
      if (slipped.has(index)) continue;
      order.push(index);
      if (order.length % DISCOVER_LIKELY_EVERY === DISCOVER_LIKELY_EVERY - 1 && next < likely.length) order.push(likely[next++]);
    }
    order.push(...likely.slice(next));

    personalOrders.set(key, order);
    for (const oldest of personalOrders.keys()) {
      if (personalOrders.size <= MAX_DISCOVER_ORDERS) break;
      personalOrders.delete(oldest);
    }
    return order;
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

  /** A profile with its hearts, as every profile route answers. */
  async function profileResponse(profile: Profile): Promise<ProfileResponse> {
    const hearts = await heartsOf(profile.id);
    return {
      profile,
      hearts: hearts.map(heart => ({ work: works[heart.index], why: heart.why, hearted_at: heart.heartedAt })),
    };
  }

  /** The works chosen at the entrance: known artworks, each counted once, and enough of them to start a gallery. */
  function onboardingPicks(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > MAX_ONBOARDING_PICKS) throw new ApiError(400, 'Invalid picks');
    const picks = [...new Set(value.map(pick => text(pick, 'picks', MAX_ART_ID_LENGTH)))];
    if (picks.some(pick => catalog.indexOf(pick) === undefined)) throw new ApiError(404, 'Artwork not found');
    if (picks.length < MIN_ONBOARDING_PICKS) throw new ApiError(400, 'Choose at least ' + MIN_ONBOARDING_PICKS + ' works');
    return picks;
  }

  // Signing up is one step: the profile is made with its first hearts or not at all.
  // The browser chooses the profile's ID, so when an answer is lost on the way
  // back and it asks again, it is given the profile already made, not a second one.
  app.post('/api/profile', async (req, res: Response<ProfileResponse>) => {
    const id = uuid(bodyField(req, 'id'), 'id');
    const name = text(bodyField(req, 'name'), 'name', MAX_NAME_LENGTH);
    const picks = onboardingPicks(bodyField(req, 'picks'));
    const chosen = bodyField(req, 'painter_id');
    const painterId = chosen === undefined || chosen === null ? undefined : painter(chosen);

    const existing = await db.findProfile(id);
    if (existing) {
      res.json(await profileResponse(existing));
      return;
    }
    res.status(201).json(await profileResponse(await db.createProfile({ id, name, artIds: picks, painterId })));
  });

  // The person's painter: which one, and what they call it. An empty name means the painter's own.
  app.post('/api/profile/:user_id/painter', async (req, res: Response<PainterResponse>) => {
    const userId = uuid(req.params.user_id);
    const chosen = { id: painter(bodyField(req, 'id')), name: painterName(bodyField(req, 'name')) };
    await db.savePainter(userId, chosen);
    res.json({ painter: chosen });
  });

  // Someone who removed every heart chooses again, under the same rule as signing up.
  app.post('/api/profile/:user_id/picks', async (req, res: Response<ProfileResponse>) => {
    const profile = await requireProfile(uuid(req.params.user_id));
    await db.saveHearts(profile.id, onboardingPicks(bodyField(req, 'picks')));
    res.json(await profileResponse(profile));
  });

  app.get('/api/profile/:user_id', async (req, res: Response<ProfileResponse>) => {
    res.json(await profileResponse(await requireProfile(uuid(req.params.user_id))));
  });

  app.get('/api/onboarding', (_req, res: Response<OnboardingResponse>) => {
    res.json({ works: onboardingWorks, min_picks: MIN_ONBOARDING_PICKS });
  });

  // The painting animation reads an image's pixels, which a browser only allows
  // for same-origin images. The image host sends no CORS headers, so the image
  // is passed through here.
  app.get('/api/image', resizedImages(catalog, fetchImage));
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
    const userId = uuid(req.params.user_id);
    const [, hearts] = await Promise.all([requireProfile(userId), heartsOf(userId)]);
    const hearted = hearts.map(heart => heart.index);
    const tastes = findTastes(corpus, hearted);
    const count = wholeNumber(req.query.count, 'count', WALL_SIZE, 1, MAX_WALL_SIZE);
    const picks = recommend(corpus, tastes, { count, exclude: new Set(hearted), artistOf });

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

    // Looked up together: each is a round trip to the database.
    const [me, friend] = await Promise.all([requireProfile(userId), db.findProfileByCode(code)]);
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

    const result: StoredBlend = {
      score: overlapPercent(corpus, myTastes, theirTastes, catalog.calibration),
      revealId: works[reveal].id,
      wall: wall.map(item => ({ id: works[item.index].id, from: item.from })),
      trends: { a: storedTrends(myTastes, mine), b: storedTrends(theirTastes, theirs) },
    };
    const trends = { you: result.trends.a.map(toTrend), friend: result.trends.b.map(toTrend) };
    const saved = await db.saveBlend({
      userA: me.id,
      userB: friend.id,
      topArtId: result.revealId,
      pickIds: result.wall.map(item => item.id),
      story: blendStory(works[reveal], trends.you, trends.friend, friend.name),
      result,
    });

    // What the curator knows about each of them goes to the atelier too, so things they said can reach the piece.
    const [myNotes, theirNotes] = curator ? await Promise.all([curator.notesOn(me.id), curator.notesOn(friend.id)]) : [null, null];
    const commission = commissions.start({
      blendId: saved.id,
      you: { name: me.name, trends: trends.you, notes: myNotes },
      friend: { name: friend.name, trends: trends.friend, notes: theirNotes },
    });
    const record: BlendRecord = { id: saved.id, created_at: saved.created_at, userA: me.id, userB: friend.id, result };
    res.json(presentBlend(record, result, me.id, asFriend(friend), commission));
  });

  // A person's saved blends: the ones they made and the ones made with them.
  app.get('/api/blends/:user_id', async (req, res: Response<BlendsResponse>) => {
    const viewer = await requireProfile(uuid(req.params.user_id));
    const records = await db.listBlends(viewer.id, MAX_BLENDS_LISTED);

    const otherIds = [...new Set(records.map(record => record.userA === viewer.id ? record.userB : record.userA))];
    const names = new Map((await db.findProfiles(otherIds)).map(profile => [profile.id, profile.name]));
    const summaries = await Promise.all(records.map(async (record): Promise<BlendSummary | null> => {
      const revealIndex = record.result ? catalog.indexOf(record.result.revealId) : undefined;
      if (!record.result || revealIndex === undefined) return null;
      const commission = await commissions.status(record.id);
      return {
        id: record.id,
        created_at: record.created_at,
        friend: { name: names.get(record.userA === viewer.id ? record.userB : record.userA) ?? '' },
        score: record.result.score,
        title: commission?.title ?? null,
        image_url: commission?.image_url ?? null,
        top_artwork: works[revealIndex],
      };
    }));
    const blends = summaries.filter((blend): blend is BlendSummary => blend !== null);
    res.json({ blends });
  });

  // One saved blend, shown from the point of view of whichever of the two people is asking.
  app.get('/api/blend/:blend_id', async (req, res: Response<BlendResponse>) => {
    const viewerId = uuid(req.query.user_id);
    const record = await db.findBlend(uuid(req.params.blend_id, 'blend_id'));
    if (!record || (record.userA !== viewerId && record.userB !== viewerId)) throw new ApiError(404, 'Blend not found');
    if (!record.result || catalog.indexOf(record.result.revealId) === undefined) {
      throw new ApiError(410, 'This blend can no longer be shown');
    }
    const commission = (await commissions.status(record.id)) ?? unavailableCommission;
    res.json(presentBlend(record, record.result, viewerId, await otherPerson(record, viewerId), commission));
  });

  app.get('/api/blend/:blend_id/commission', async (req, res: Response<Commission>) => {
    const commission = await commissions.status(uuid(req.params.blend_id, 'blend_id'));
    if (!commission) throw new ApiError(404, 'No piece is being made for this blend');
    res.json(commission);
  });

  app.get('/api/blend/:blend_id/commission/image', async (req, res) => {
    const image = await commissions.image(uuid(req.params.blend_id, 'blend_id'));
    if (!image) throw new ApiError(404, 'The piece is not ready');
    res.set('Content-Type', image.mimeType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(image.bytes);
  });

  /** A person as the curator needs them: who they are and what they have saved. */
  async function curatorPerson(userId: string): Promise<CuratorPerson> {
    const profile = await requireProfile(userId);
    const hearts = await heartsOf(profile.id);
    return { id: profile.id, name: profile.name, saved: hearts.map(heart => ({ work: works[heart.index], why: heart.why })) };
  }

  // The curator's portrait of a person and the rooms it has hung for them. Asking also starts a
  // rehang in the background when what they saved or said has changed.
  app.get('/api/curator/:user_id', async (req, res: Response<CuratorResponse>) => {
    const person = await curatorPerson(uuid(req.params.user_id));
    const savesUntilRooms = Math.max(0, ROOMS_MIN_SAVED - person.saved.length);
    if (!curator) {
      res.json({ status: 'unavailable', portrait: null, question: null, rooms: [], saves_until_rooms: savesUntilRooms });
      return;
    }
    const view = await curator.view(person);
    res.json({
      status: view.status,
      portrait: view.portrait,
      question: view.question,
      rooms: view.rooms
        .map(room => ({ title: room.title, text: room.text, works: worksById(room.workIds) }))
        .filter(room => room.works.length > 0),
      saves_until_rooms: savesUntilRooms,
    });
  });

  // A note left for the curator. It answers in a sentence or two and remembers what was said.
  app.post('/api/curator/:user_id/note', async (req, res: Response<CuratorNoteResponse>) => {
    const person = await curatorPerson(uuid(req.params.user_id));
    const note = text(bodyField(req, 'text'), 'text', MAX_NOTE_LENGTH);
    const asked = bodyField(req, 'question');
    const question = asked === undefined || asked === null ? undefined : text(asked, 'question', MAX_NOTE_LENGTH);
    if (!curator) throw new ApiError(503, 'The curator is not in today');
    try {
      res.json({ reply: await curator.note(person, note, question) });
    } catch (error) {
      console.error('Curator note failed: ' + (error instanceof Error ? error.message : String(error)));
      throw new ApiError(502, 'The curator could not answer just now');
    }
  });

  // The whole collection as one long, varied stroll. A seed fixes the order, so paging is stable.
  // With a user_id, about one work in six is one that person is likely to love, unmarked.
  app.get('/api/discover', async (req, res: Response<DiscoverResponse>) => {
    const seed = wholeNumber(req.query.seed, 'seed', 0, 0, 0xffffffff);
    const offset = wholeNumber(req.query.offset, 'offset', 0, 0, works.length);
    const limit = wholeNumber(req.query.limit, 'limit', DISCOVER_PAGE, 1, MAX_DISCOVER_PAGE);
    const order = req.query.user_id === undefined ? discoverOrder(seed) : await personalOrder(seed, uuid(req.query.user_id));
    const end = Math.min(offset + limit, order.length);
    res.json({
      works: order.slice(offset, end).map(index => works[index]),
      next_offset: end < order.length ? end : null,
    });
  });

  // One work and a varied handful of the works nearest to it.
  app.get('/api/similar', (req, res: Response<SimilarResponse>) => {
    const index = catalog.indexOf(text(req.query.id, 'id', MAX_ART_ID_LENGTH));
    if (index === undefined) throw new ApiError(404, 'Artwork not found');
    const limit = wholeNumber(req.query.limit, 'limit', SIMILAR_COUNT, 1, MAX_SIMILAR_COUNT);

    const scores = similaritiesTo(corpus, index);
    const nearestWorks = topIndices(scores, SIMILAR_CANDIDATES, new Set([index]));
    const similar = selectDiverse(corpus, nearestWorks, {
      count: limit,
      relevance: candidate => scores[candidate],
      shown: [index],
      artistOf,
    });
    res.json({ work: works[index], similar: similar.map(candidate => works[candidate]) });
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
const PROPER_START = /^(Japanese|Indian|Barbizon|Italianate|Cubism|Fauve|Romantic|Impressionist|Baroque)\b/;

function listFamilies(trends: readonly Trend[]): string {
  const names = [...new Set(trends.map(trend => trend.family).filter(Boolean))].map(name =>
    PROPER_START.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1),
  );
  if (names.length <= 1) return names[0] ?? 'a little of everything';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/** The family most of a group belongs to; on a tie, the family of its central work. */
function commonFamily(families: readonly number[], central: number): number {
  const counts = new Map<number, number>();
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

function painter(value: unknown): PainterId {
  if (!isPainterId(value)) throw new ApiError(400, 'Invalid painter');
  return value;
}

/** What someone calls their painter. Unlike other text it may be empty: the painter then keeps its own name. */
function painterName(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'Invalid name');
  const trimmed = value.trim();
  if (trimmed.length > MAX_PAINTER_NAME_LENGTH) throw new ApiError(400, 'Invalid name');
  return trimmed;
}

/** A whole number from a query string, or `fallback` when it is absent. */
function wholeNumber(value: unknown, label: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const number = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < min || number > max) throw new ApiError(400, 'Invalid ' + label);
  return number;
}

/** A small seeded random number generator (mulberry32): the same seed always gives the same sequence. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const unavailableCommission: Commission = { status: 'unavailable', image_url: null, title: null, label_status: 'unavailable', label: null };

function uuid(value: unknown, label = 'user_id'): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ApiError(400, 'Invalid ' + label);
  return value.toLowerCase();
}

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}
