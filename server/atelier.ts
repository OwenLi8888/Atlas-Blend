/**
 * The atelier: a deep agent (LangChain deepagents, running on Gemini) that
 * turns two people's tastes into a commission. It works in a virtual
 * filesystem that starts with each person's taste portrait.
 *
 *   art-director  reads the portraits, writes /commission/brief.md and hands it
 *                 to the studio, which starts painting straight away
 *   label-writer  reads the brief and writes /commission/label.md: a title and
 *                 the story of the piece, with both people's loves woven through it
 *   critic        checks it against the brief and the portraits; the writer revises once
 *
 * The brief is handed over as soon as it exists, so the painting never waits
 * for the label.
 */
import { ChatGoogle } from '@langchain/google';
import { createDeepAgent } from 'deepagents';
import { tool, toolStrategy } from 'langchain';
import { z } from 'zod';
import type { CommissionLabel } from '../src/rec/api';
import type { Patron } from './commission';

export interface Atelier {
  /**
   * Makes the brief and the label for one piece. `onBrief` is called once, as
   * soon as the brief is written. Rejects if no usable label was produced.
   */
  make(you: Patron, friend: Patron, onBrief: (brief: string) => void): Promise<CommissionLabel>;
}

/** The fastest Gemini text model; a full run takes about 15 seconds. Set GEMINI_AGENT_MODEL to change it. */
export const DEFAULT_AGENT_MODEL = 'gemini-flash-lite-latest';

const RUN_TIMEOUT_MS = 45_000;
/** Upper bound on agent steps, so a confused run stops instead of looping. */
const RECURSION_LIMIT = 60;
const EXAMPLES_PER_LEANING = 3;
const MAX_CAPTION_LENGTH = 320;

const labelSchema = z.object({
  title: z.string().describe('The title of the piece'),
  story: z.string().describe('The wall text describing the piece'),
});

const DIRECTOR_PROMPT = `You are the art director of a small atelier that paints one new artwork for two people.
Read /portraits/you.md and /portraits/friend.md.
Compose a brief of at most 130 words describing ONE painting that is a chimera of both tastes. One scene,
not a collage or a split image. Take subjects and motifs from both people, and let the palette and surface of one
run through the forms of the other. Weigh each leaning by its share. Use concrete visual language only: what is in
the picture, where, in what colours, with what kind of mark.
Work in this order to save time: compose the brief, call start_painting with its full text first, then save the same
text to /commission/brief.md, then reply "done".`;

const WRITER_PROMPT = `You write the wall text for a new artwork made for two people.
Read /commission/brief.md (what the painting shows), /portraits/you.md and /portraits/friend.md.
Write /commission/label.md with exactly these two lines:
Title: a short, specific title.
Story: two or three sentences, at most 65 words. The first sentence must begin with both names and the words
"'s piece", then a verb such as gathers, holds or opens onto, and say what the painting shows. Then say what the
painting takes from each of them, by name: a medium, a way of making marks, a palette or a subject that their
portrait shows they love. Weave these into the description of the picture so that one person's part runs into the
other's, one thing fading, opening or settling into the next. Fold their own words from the portraits into the
sentences where they fit, without quotation marks.
Shape only, with a different subject: "Ada and Bo's piece gathers a winter orchard inside a tiled courtyard. Ada's
loose charcoal branches thin into Bo's blue glaze, and the last apples sit where a fountain would be."
Rules: apart from what the painting takes from them, the two people do nothing in the story; they do not admire,
stand, meet or look. Credit each person only with things their own portrait supports. Describe only what the brief
puts in the picture. Never invent events or facts about the two people. Name no artist. Do not mention AI, models
or blending. Plain, concrete sentences, not one long list.
If you are asked to revise, edit the file. Reply with the text of the file.`;

const CRITIC_PROMPT = `You check wall text before it goes on the wall.
Read /commission/label.md, /commission/brief.md and both portraits in /portraits/.
Check each of these: the story begins with both names followed by "'s piece"; it says what the painting takes
from each person, and each of those things is supported by that person's own portrait; apart from that the two
people do nothing (they do not admire, stand, meet or look); it describes the painting in the brief and adds
nothing that is not there; no artist is named; it is two or three sentences, at most 65 words, and could not be
about any other pair.
Reply "APPROVED", or a short list of the changes required.`;

const LEAD_PROMPT = `You run a small atelier that makes one new artwork for two people from what each of them loves.
Their taste portraits are in /portraits/you.md and /portraits/friend.md.
Work in this order:
1. Delegate to "art-director". It writes /commission/brief.md and starts the painting.
2. Delegate to "label-writer". It writes /commission/label.md from the brief and the portraits.
3. Delegate to "critic". If it asks for changes, have "label-writer" revise once. Do not ask the critic again.
4. Finish with the final title and story.`;

interface Options {
  apiKey: string;
  model?: string;
}

export function createAtelier({ apiKey, model: modelName = DEFAULT_AGENT_MODEL }: Options): Atelier {
  const model = new ChatGoogle({ model: modelName, apiKey, temperature: 0.9 });

  return {
    async make(you, friend, onBrief) {
      let briefed = false;
      const startPainting = tool(
        ({ brief }: { brief: string }) => {
          if (!briefed && brief.trim() !== '') {
            briefed = true;
            onBrief(brief.trim());
          }
          return 'The studio has started painting. Do not wait for it.';
        },
        {
          name: 'start_painting',
          description: 'Hand the finished brief to the studio so that painting starts. Call it exactly once.',
          schema: z.object({ brief: z.string().describe('The complete text of the brief') }),
        },
      );

      const agent = createDeepAgent({
        model,
        systemPrompt: LEAD_PROMPT,
        responseFormat: toolStrategy(labelSchema),
        subagents: [
          {
            name: 'art-director',
            description: 'Writes the painting brief and hands it to the studio.',
            systemPrompt: DIRECTOR_PROMPT,
            model,
            tools: [startPainting],
          },
          {
            name: 'label-writer',
            description: 'Writes or revises the wall text: a title and the story of the piece.',
            systemPrompt: WRITER_PROMPT,
            model,
          },
          {
            name: 'critic',
            description: 'Checks the wall text against the brief and the two portraits.',
            systemPrompt: CRITIC_PROMPT,
            model,
          },
        ],
      });

      const result = await agent.invoke(
        {
          messages: [{ role: 'user', content: 'Make the piece for ' + nameOf(you, 'the first person') + ' and ' + nameOf(friend, 'the second person') + '.' }],
          files: { '/portraits/you.md': textFile(portrait(you)), '/portraits/friend.md': textFile(portrait(friend)) },
        },
        { recursionLimit: RECURSION_LIMIT, signal: AbortSignal.timeout(RUN_TIMEOUT_MS) },
      );

      const parsed = labelSchema.safeParse(result.structuredResponse);
      if (!parsed.success) throw new Error('The atelier finished without a usable label');
      const label: CommissionLabel = { title: parsed.data.title.trim(), story: parsed.data.story.trim() };
      if (Object.values(label).some(value => value === '')) throw new Error('The atelier left part of the label empty');
      return label;
    },
  };
}

/** A person's taste as the agents read it: each leaning with its share, a few loved works and their own words. */
export function portrait(patron: Patron): string {
  const lines = ['# ' + nameOf(patron, 'This person'), ''];
  for (const trend of patron.trends) {
    lines.push('## ' + trend.family + ' (' + Math.round(trend.share * 100) + '% of what they love)');
    if (trend.why) lines.push('In their words: "' + trend.why + '"');
    for (const work of trend.works.slice(0, EXAMPLES_PER_LEANING)) {
      const facts = [work.artist, work.date, work.medium].filter(Boolean).join(', ');
      lines.push('- "' + work.title + '"' + (facts ? ' (' + facts + ')' : '') + (work.caption ? ': ' + clip(work.caption) : ''));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function nameOf(patron: Patron, fallback: string): string {
  return patron.name.trim() || fallback;
}

function textFile(content: string) {
  const now = new Date().toISOString();
  return { content, mimeType: 'text/markdown', created_at: now, modified_at: now };
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_CAPTION_LENGTH ? flat : flat.slice(0, MAX_CAPTION_LENGTH).replace(/\s+\S*$/, '') + '…';
}
