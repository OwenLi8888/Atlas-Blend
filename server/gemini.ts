/** Image generation through the Gemini API (the Interactions endpoint). */
import type { ImageData, ImageMaker } from './commission';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';
const TIMEOUT_MS = 90_000;

/**
 * The fastest Gemini image model. Measured on a three-reference brief: about
 * 5 s, against about 13 s for gemini-nano-banana-2.1. Set GEMINI_IMAGE_MODEL to change it.
 */
export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

interface Options {
  apiKey: string;
  model?: string;
}

export function createGeminiImageMaker({ apiKey, model = DEFAULT_IMAGE_MODEL }: Options): ImageMaker {
  return async (brief, references) => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json', 'Api-Revision': API_REVISION },
      body: JSON.stringify({
        model,
        input: [
          { type: 'text', text: brief },
          ...references.map(image => ({ type: 'image', mime_type: image.mimeType, data: image.bytes.toString('base64') })),
        ],
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '5:4', image_size: '1K' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await response.text();
    if (!response.ok) throw new Error('Gemini answered ' + response.status + ': ' + text.slice(0, 300));
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('Gemini sent a reply that is not JSON');
    }
    const image = findImage(payload);
    if (!image) throw new Error('Gemini returned no image');
    return image;
  };
}

/** The first image in the model's output: steps[type=model_output].content[type=image]. */
function findImage(payload: unknown): ImageData | null {
  if (!isRecord(payload) || !Array.isArray(payload.steps)) return null;
  for (const step of payload.steps) {
    if (!isRecord(step) || step.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      if (isRecord(block) && block.type === 'image' && typeof block.data === 'string' && block.data !== '') {
        const mimeType = typeof block.mime_type === 'string' ? block.mime_type : 'image/jpeg';
        return { bytes: Buffer.from(block.data, 'base64'), mimeType };
      }
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
