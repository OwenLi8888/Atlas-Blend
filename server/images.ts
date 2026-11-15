/** Bounded, disk-cached web images. Originals never reach gallery grids. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { RequestHandler } from 'express';
import type { Catalog } from './catalog';
import { ApiError } from './errors';

export function resizedImages(catalog: Catalog, fetchImage: (url: string, init: { signal: AbortSignal }) => Promise<Response>, dir = path.join(import.meta.dirname, '.cache', 'images')): RequestHandler {
  const pending = new Map<string, Promise<Buffer>>();
  let active = 0;
  const queue: (() => void)[] = [];
  async function resize(url: string, width: number, file: string): Promise<Buffer> {
    try { return await readFile(file); } catch { /* First request makes this variant. */ }
    if (active >= 4) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try {
      const response = await fetchImage(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || !response.body) throw new Error('Image unavailable');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 25 * 1024 * 1024) throw new Error('Image too large');
        chunks.push(chunk);
      }
      const bytes = await sharp(Buffer.concat(chunks), { limitInputPixels: 80_000_000 })
        .rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      await mkdir(dir, { recursive: true });
      await writeFile(file + '.tmp', bytes);
      await rename(file + '.tmp', file);
      return bytes;
    } finally {
      const next = queue.shift();
      if (next) next(); else active--;
    }
  }
  return async (req, res, next) => {
    if (req.query.width === undefined) return next();
    const width = Number(req.query.width);
    if (![480, 1280].includes(width)) throw new ApiError(400, 'Invalid image width');
    const row = typeof req.query.id === 'string' ? catalog.indexOf(req.query.id) : undefined;
    if (row === undefined) throw new ApiError(404, 'Artwork not found');
    const url = catalog.works[row].image_url;
    const key = createHash('sha256').update(url + ':' + width + ':v1').digest('hex');
    let work = pending.get(key);
    if (!work) {
      if (pending.size >= 100) throw new ApiError(503, 'Images are busy. Please try again.');
      work = resize(url, width, path.join(dir, key + '.webp'));
      pending.set(key, work);
      void work.finally(() => pending.delete(key)).catch(() => {});
    }
    try {
      const bytes = await work;
      res.set('Cache-Control', 'public, max-age=86400').type('webp').send(bytes);
    } catch {
      throw new ApiError(502, 'Image is unavailable. Please try again.');
    }
  };
}
