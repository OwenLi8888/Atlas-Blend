/**
 * The curator: a deep agent (LangChain deepagents on Gemini) that keeps notes
 * on one person and hangs a small show for them.
 *
 * Each person has their own folder on disk, which is the agent's filesystem.
 * It persists between runs, so the curator remembers:
 *
 *   /memories/taste.md   the curator's own notes on the person (it rewrites these)
 *   /memories/notes.md   what the person has told it, word for word
 *   /saved.md            the works they have saved (written before each run)
 *   /rooms/plan.md       the rooms it has decided on
 *   /rooms/room-N.md     each room as hung by a room-maker subagent
 *
 * Two things set it off. Saving works (or leaving a note) makes it rehang in
 * the background: it writes a short portrait and, once enough is saved, plans
 * two rooms and gives each to a room-maker, which searches the collection for
 * works that belong beside the saved ones. Leaving a note gets a short answer
 * straight away, and what the note says goes into its notes for next time.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatGoogle } from '@langchain/google';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { tool, toolStrategy } from 'langchain';
import { z } from 'zod';
import type { Artwork } from '../src/rec/api';

/** A work the person has saved, with the reason they gave. */
export interface SavedWork {
  work: Artwork;
  why: string | null;
}

export interface CuratorPerson {
  id: string;
  name: string;
  /** Newest first. */
  saved: readonly SavedWork[];
}

/** A room as the curator hung it: works by ID, checked against the catalog by the caller. */
export interface HungRoom {
  title: string;
  text: string;
  workIds: string[];
}

/** Something the curator wants to know, with a few short answers the person can pick from. */
export interface CuratorQuestion {
  text: string;
  answers: string[];
}

export interface CuratorView {
  /** `working` while a rehang is running in the background. */
  status: 'working' | 'ready';
  portrait: string | null;
  /** The curator's current question; null when it has none. */
  question: CuratorQuestion | null;
  rooms: HungRoom[];
}

export interface Curator {
  /** What the curator has for a person now. Starts a rehang when what they saved or said has changed. */
  view(person: CuratorPerson): Promise<CuratorView>;
  /**
   * Takes something the person said, remembers it, and acknowledges it in a few
   * words. `question` is the curator's question it answers, when it answers one.
   */
  note(person: CuratorPerson, text: string, question?: string): Promise<string>;
  /** The curator's notes on a person, for other agents to read; null when it has none. */
  notesOn(personId: string): Promise<string | null>;
}

/** The parts of the collection the curator can reach. */
export interface Collection {
  /** Works whose title, artist, medium, family or caption contain words from `query`, best first. */
  search(query: string, limit: number): Artwork[];
  /** Works that look like the given one, or an empty list for an unknown ID. */
  moreLike(artId: string, limit: number): Artwork[];
}

interface Options {
  apiKey: string;
  model?: string;
  /** Folder holding one subfolder per person. */
  dir: string;
  collection: Collection;
}

/** The fastest Gemini text model. Set GEMINI_AGENT_MODEL to change it. */
const DEFAULT_MODEL = 'gemini-flash-lite-latest';
/** Rooms are hung once a person has saved this many works; before that there is only a portrait. */
export const ROOMS_MIN_SAVED = 8;
const ROOM_COUNT = 2;
const MIN_WORKS_PER_ROOM = 3;
const MAX_WORKS_PER_ROOM = 8;
const HANG_TIMEOUT_MS = 90_000;
const NOTE_TIMEOUT_MS = 30_000;
const RECURSION_LIMIT = 80;
const MAX_SAVED_LISTED = 40;
const MAX_CAPTION_LENGTH = 260;
const TOOL_RESULTS = 8;
const MAX_ANSWERS = 3;
/** Person IDs become folder names, so only plain IDs are accepted. */
const SAFE_ID = /^[0-9a-f-]{1,64}$/i;

const TASTE_FILE = '/memories/taste.md';
const NOTES_FILE = '/memories/notes.md';

const hangSchema = z.object({
  portrait: z.string().describe('One or two plain sentences to the person about what they keep saving'),
  question: z.string().describe('One short question for the person, or an empty string'),
  answers: z.array(z.string()).describe('Two or three very short answers the person could pick'),
  rooms: z
    .array(
      z.object({
        title: z.string().describe('Two to four words'),
        text: z.string().describe('The wall text for the room'),
        work_ids: z.array(z.string()).describe('IDs of the works in hanging order'),
      }),
    )
    .describe('The rooms, or an empty list when none were hung'),
});

const replySchema = z.object({ reply: z.string().describe('One short sentence to the person') });

const VOICE = `Write the way a friend who works at a gallery would talk to you: short, plain, everyday words. No poetry, no
metaphors, no grand words like "stillness", "weight", "solace", "evoke" or "contemplative". Address the person as
"you". No exclamation marks, and never mention AI, models, files or notes.`;

const PORTRAIT_RULES = `a portrait: one or two sentences, at most 30 words, saying plainly what they keep saving, the way you
would point it out to a friend ("You keep saving harbours at first light, and faces that look away.")`;

const QUESTION_RULES = `Then ask ONE question that would help you choose works for them. It must be easy: a choice between two
or three concrete things, answerable in a word or two. At most 10 words. Give two or three answers they could
pick, each at most four words.
Start light. Count the questions they have already answered in ${NOTES_FILE}. For the first three, ask only about
how a picture looks: colour or line, busy or bare, close up or far away, soft or sharp ("Soft edges, or sharp
ones?"). After that, take turns: one question about looks, then one about what a picture is about, such as a time
of day, a kind of place or a mood ("Early morning, or late evening?", "Calm, or a bit stormy?").
Never ask about their life, their memories, their feelings or anything personal, and never ask why. Never ask
something they have already answered; if there is nothing worth asking, leave the question empty.`;

const PORTRAIT_PROMPT = `You are the curator of one person's private gallery. Your own notes on them are shown to you
above (${TASTE_FILE}); they may be empty. What they have told you is in ${NOTES_FILE}. The works they have saved are in
/saved.md.
1. Read /saved.md and ${NOTES_FILE}.
2. Rewrite ${TASTE_FILE}: what this person is drawn to (subjects, moods, ways of painting, places, times), in at most
120 words. Keep everything they told you that still holds.
3. Finish with ${PORTRAIT_RULES}. Leave the rooms empty.
${QUESTION_RULES}
${VOICE}`;

const HANG_PROMPT = `You are the curator of one person's private gallery. Your own notes on them are shown to you above
(${TASTE_FILE}); they may be empty. What they have told you is in ${NOTES_FILE}. The works they have saved are in
/saved.md.
1. Read /saved.md and ${NOTES_FILE}.
2. Decide on exactly ${ROOM_COUNT} rooms. A room is something this person keeps returning to: a subject, a mood, a way
of painting, a place or a time. What they told you counts for more than any single work. Write /rooms/plan.md: for
each room its number, a working title, the theme in one sentence, and the IDs of the saved works that belong in it.
3. In ONE turn, delegate every room to "room-maker" at the same time, giving each its room number.
4. Rewrite ${TASTE_FILE}: what this person is drawn to, in at most 120 words. Keep everything they told you that
still holds.
5. Finish with ${PORTRAIT_RULES}, and the ${ROOM_COUNT} rooms exactly as the room files give them: title, text and
work IDs.
${QUESTION_RULES}
${VOICE}`;

const ROOM_MAKER_PROMPT = `You hang one room in a person's private gallery. You are told the room number.
Read /rooms/plan.md for your room, then /saved.md and ${NOTES_FILE}.
Find works for the room: use search_collection with a few words from the theme, and more_like with the ID of a saved
work in the room. Two or three searches are enough. Choose six works in all: begin with the saved works the plan
gives the room (at most four of them), then add at least two works from your searches that the person has not
saved, which belong beside them and widen the theme a little. A room of only saved works is not finished.
Use only IDs that appear in /saved.md or in the results of your searches, copied exactly.
Write /rooms/room-<number>.md with three parts:
Title: two to four words.
Text: two or three sentences, at most 60 words, on what these works share and how they speak to each other, naming
one or two of them. Use only what the captions say. Address the person as "you" if you address them at all.
Works: the IDs, one per line, in the order they should hang.
Reply with the text of the file.`;

const NOTE_PROMPT = `You are the curator of one person's private gallery, and they have just told you something. Your own
notes on them are shown to you above (${TASTE_FILE}); they may be empty.
1. Update ${TASTE_FILE} with what it tells you about what they like. Keep it under 150 words and keep what was
already there if it still holds.
2. Answer in ONE short sentence, at most 14 words, that shows you heard them and says what you will do with it
("Got it: more light than water. I'll rehang with that in mind."). Do not ask a question. Do not name artworks.
${VOICE}`;

interface StoredResult {
  /** What the person had saved and said when this was made. */
  fingerprint: string;
  portrait: string | null;
  question: CuratorQuestion | null;
  rooms: HungRoom[];
}

interface PersonState {
  running: Promise<void> | null;
  /** A fingerprint that failed, so the same inputs are not retried on every look. */
  failed: string | null;
}

export function createCurator({ apiKey, model: modelName = DEFAULT_MODEL, dir, collection }: Options): Curator {
  const model = new ChatGoogle({ model: modelName, apiKey, temperature: 0.8 });
  const people = new Map<string, PersonState>();

  const folderOf = (personId: string) => {
    if (!SAFE_ID.test(personId)) throw new Error('Unusable person ID');
    return path.join(dir, personId);
  };
  const resultFile = (personId: string) => path.join(dir, personId + '.json');

  const describeWork = (work: Artwork) =>
    [work.id, '"' + work.title + '"', [work.artist, work.date].filter(Boolean).join(', '), work.medium ?? '', work.cluster, clip(work.caption ?? '')]
      .filter(Boolean)
      .join(' | ');

  const searchCollection = tool(
    ({ query }: { query: string }) => {
      const found = collection.search(query, TOOL_RESULTS);
      return found.length > 0 ? found.map(describeWork).join('\n') : 'Nothing found. Try other words.';
    },
    {
      name: 'search_collection',
      description: 'Find works in the collection by words in their title, artist, medium, family or caption.',
      schema: z.object({ query: z.string().describe('A few plain words, such as "harbour dawn mist"') }),
    },
  );
  const moreLike = tool(
    ({ work_id }: { work_id: string }) => {
      const found = collection.moreLike(work_id, TOOL_RESULTS);
      return found.length > 0 ? found.map(describeWork).join('\n') : 'No work has that ID.';
    },
    {
      name: 'more_like',
      description: 'Find works in the collection that look like a given work.',
      schema: z.object({ work_id: z.string().describe('The ID of a work, copied exactly') }),
    },
  );

  /** Makes sure the person's folder has its memory files and an up-to-date list of what they saved. */
  async function prepare(person: CuratorPerson): Promise<string> {
    const folder = folderOf(person.id);
    await mkdir(path.join(folder, 'memories'), { recursive: true });
    await mkdir(path.join(folder, 'rooms'), { recursive: true });
    await writeFile(path.join(folder, 'memories', 'taste.md'), '', { flag: 'a' });
    await writeFile(path.join(folder, 'memories', 'notes.md'), '', { flag: 'a' });

    const saved = person.saved.slice(0, MAX_SAVED_LISTED);
    const lines = ['# Works ' + (person.name.trim() || 'this person') + ' has saved, newest first', ''];
    for (const { work, why } of saved) lines.push('- ' + describeWork(work) + (why ? ' | They said: "' + why + '"' : ''));
    await writeFile(path.join(folder, 'saved.md'), lines.join('\n') + '\n');
    return folder;
  }

  async function fingerprintOf(person: CuratorPerson): Promise<string> {
    const notes = await readText(path.join(folderOf(person.id), 'memories', 'notes.md'));
    const saved = person.saved.map(({ work, why }) => work.id + ':' + (why ?? '')).sort();
    return createHash('sha256').update(saved.join('\n') + '\n--\n' + notes).digest('hex').slice(0, 16);
  }

  async function storedResult(personId: string): Promise<StoredResult | null> {
    try {
      return JSON.parse(await readFile(resultFile(personId), 'utf8')) as StoredResult;
    } catch {
      // Nothing has been hung for this person yet.
      return null;
    }
  }

  /** One background run: a portrait, and rooms when enough is saved. */
  async function hang(person: CuratorPerson, fingerprint: string): Promise<void> {
    const started = performance.now();
    const folder = await prepare(person);
    const withRooms = person.saved.length >= ROOMS_MIN_SAVED;
    const agent = createDeepAgent({
      model,
      backend: new FilesystemBackend({ rootDir: folder, virtualMode: true }),
      memory: [TASTE_FILE],
      systemPrompt: withRooms ? HANG_PROMPT : PORTRAIT_PROMPT,
      responseFormat: toolStrategy(hangSchema),
      subagents: withRooms
        ? [
            {
              name: 'room-maker',
              description: 'Hangs one room: finds works for its theme, chooses and orders them, and writes its wall text.',
              systemPrompt: ROOM_MAKER_PROMPT,
              model,
              tools: [searchCollection, moreLike],
            },
          ]
        : [],
    });

    const result = await agent.invoke(
      { messages: [{ role: 'user', content: 'Rehang the gallery of ' + (person.name.trim() || 'this person') + '.' }] },
      { recursionLimit: RECURSION_LIMIT, signal: AbortSignal.timeout(HANG_TIMEOUT_MS) },
    );
    const parsed = hangSchema.safeParse(result.structuredResponse);
    if (!parsed.success) throw new Error('The curator finished without a usable result');

    const rooms: HungRoom[] = parsed.data.rooms
      .map(room => ({
        title: room.title.trim(),
        text: room.text.trim(),
        workIds: [...new Set(room.work_ids.map(id => id.trim()))].slice(0, MAX_WORKS_PER_ROOM),
      }))
      .filter(room => room.title !== '' && room.text !== '');
    const answers = parsed.data.answers.map(answer => answer.trim()).filter(Boolean).slice(0, MAX_ANSWERS);
    const questionText = parsed.data.question.trim();
    const stored: StoredResult = {
      fingerprint,
      portrait: parsed.data.portrait.trim() || null,
      // A question nobody could answer with a tap is not worth showing.
      question: questionText !== '' && answers.length >= 2 ? { text: questionText, answers } : null,
      rooms,
    };
    await writeFile(resultFile(person.id), JSON.stringify(stored));
    console.log(
      'Curator rehung ' + person.id + ' in ' + Math.round(performance.now() - started) + ' ms: ' +
        rooms.length + ' room(s), ' + rooms.map(room => room.workIds.length).join('+') + ' works',
    );
  }

  return {
    async view(person) {
      const state = people.get(person.id) ?? { running: null, failed: null };
      people.set(person.id, state);
      await prepare(person);
      const [fingerprint, stored] = await Promise.all([fingerprintOf(person), storedResult(person.id)]);

      const stale = stored?.fingerprint !== fingerprint && state.failed !== fingerprint;
      if (stale && !state.running && person.saved.length > 0) {
        state.running = hang(person, fingerprint)
          .catch(error => {
            state.failed = fingerprint;
            console.error('Curator failed for ' + person.id + ': ' + (error instanceof Error ? error.message : String(error)));
          })
          .finally(() => {
            state.running = null;
          });
      }
      return {
        status: state.running ? 'working' : 'ready',
        portrait: stored?.portrait ?? null,
        question: stored?.question ?? null,
        rooms: (stored?.rooms ?? []).filter(room => room.workIds.length >= MIN_WORKS_PER_ROOM),
      };
    },

    async note(person, text, question) {
      const folder = await prepare(person);
      const agent = createDeepAgent({
        model,
        backend: new FilesystemBackend({ rootDir: folder, virtualMode: true }),
        memory: [TASTE_FILE],
        systemPrompt: NOTE_PROMPT,
        responseFormat: toolStrategy(replySchema),
      });
      const result = await agent.invoke(
        { messages: [{ role: 'user', content: (question ? 'You asked: ' + question + '\nThey answered: ' : 'They told you: ') + text }] },
        { recursionLimit: RECURSION_LIMIT, signal: AbortSignal.timeout(NOTE_TIMEOUT_MS) },
      );
      const parsed = replySchema.safeParse(result.structuredResponse);
      const reply = parsed.success ? parsed.data.reply.trim() : '';
      if (reply === '') throw new Error('The curator had no answer');

      // Kept word for word, so later runs read what was actually said, not a summary of it.
      const day = new Date().toISOString().slice(0, 10);
      const said = question ? 'you asked: ' + flat(question) + ' They answered: ' + flat(text) : 'they told you: ' + flat(text);
      await appendFile(path.join(folder, 'memories', 'notes.md'), '- ' + day + ' ' + said + '\n');
      return reply;
    },

    async notesOn(personId) {
      if (!SAFE_ID.test(personId)) return null;
      const taste = (await readText(path.join(folderOf(personId), 'memories', 'taste.md'))).trim();
      return taste === '' ? null : taste;
    },
  };
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    // The file does not exist yet.
    return '';
  }
}

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string): string {
  const one = flat(text);
  return one.length <= MAX_CAPTION_LENGTH ? one : one.slice(0, MAX_CAPTION_LENGTH).replace(/\s+\S*$/, '') + '…';
}
