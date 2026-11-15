import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilePieceStore, isSafePieceId, type PieceStore } from './pieces';

const ID = 'cccccccc-0000-4000-8000-000000000001';
const png = { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/png' };

describe('createFilePieceStore', () => {
  let dir: string;
  let store: PieceStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pieces-'));
    // A folder that does not exist yet: the store makes it on the first save.
    store = createFilePieceStore(path.join(dir, 'kept'));
  });
  afterEach(() => rm(dir, { recursive: true }));

  it('has nothing for a blend it never kept, even before its folder exists', async () => {
    expect(await store.read(ID)).toBeNull();
    expect(await store.image(ID)).toBeNull();
  });

  it('gives back the record and the image with its type', async () => {
    const label = { title: 'Harbour on gold', story: 'A harbour, in gold.' };
    await store.save(ID, { title: 'For Ada and Bo', label }, png);
    expect(await store.read(ID)).toEqual({ title: 'For Ada and Bo', label });
    expect(await store.image(ID)).toEqual(png);
  });

  it('replaces an earlier copy, as when the label arrives after the image', async () => {
    await store.save(ID, { title: 'For Ada and Bo', label: null }, png);
    await store.save(ID, { title: 'For Ada and Bo', label: { title: 'Late', story: 'It came later.' } }, png);
    expect((await store.read(ID))?.label?.title).toBe('Late');
  });

  it('rejects a record that is not one, instead of showing a broken piece', async () => {
    await store.save(ID, { title: 'For Ada and Bo', label: null }, png);
    await writeFile(path.join(dir, 'kept', ID + '.json'), '{"title":5}');
    await expect(store.read(ID)).rejects.toThrow();
  });
});

describe('isSafePieceId', () => {
  it('accepts blend IDs and nothing that could name another file', () => {
    expect(isSafePieceId(ID)).toBe(true);
    expect(isSafePieceId('../../etc/passwd')).toBe(false);
    expect(isSafePieceId('')).toBe(false);
  });
});
