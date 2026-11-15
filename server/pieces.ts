/**
 * Where finished commissioned pieces are kept. A blend belongs to two people,
 * who may reach it through different servers, so with Supabase the pieces go
 * to its Storage, where every server finds them. Without Supabase they are
 * kept in a folder on this machine.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { CommissionLabel } from '../src/rec/api';

export interface PieceImage {
  bytes: Buffer;
  mimeType: string;
}

/** What is kept about a piece besides its image. */
export interface PieceRecord {
  title: string;
  label: CommissionLabel | null;
}

export interface PieceStore {
  /**
   * Keeps a finished piece, replacing an earlier copy of it. The record is
   * written last, so a piece that can be read always has its image. Rejects
   * when it could not be kept.
   */
  save(blendId: string, record: PieceRecord, image: PieceImage): Promise<void>;
  /** The record of a kept piece, or null when none was kept for this blend. Rejects when the store cannot be reached. */
  read(blendId: string): Promise<PieceRecord | null>;
  /** The image of a kept piece, or null when none was kept. Rejects when the store cannot be reached. */
  image(blendId: string): Promise<PieceImage | null>;
}

/** Blend IDs become file and object names, so only plain IDs are accepted. */
const SAFE_ID = /^[0-9a-f-]{1,64}$/i;

export function isSafePieceId(blendId: string): boolean {
  return SAFE_ID.test(blendId);
}

/** The record as it is written: the image's type is kept beside it. */
interface StoredRecord extends PieceRecord {
  mimeType: string;
}

const imageName = (blendId: string) => blendId + '.image';
const recordName = (blendId: string) => blendId + '.json';

function parseRecord(text: string): StoredRecord {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null) throw new Error('The kept piece is not a record');
  const { title, mimeType, label } = value as Record<string, unknown>;
  if (typeof title !== 'string' || typeof mimeType !== 'string') throw new Error('The kept piece has no title or image type');
  return { title, mimeType, label: parseLabel(label) };
}

function parseLabel(value: unknown): CommissionLabel | null {
  if (typeof value !== 'object' || value === null) return null;
  const { title, story } = value as Record<string, unknown>;
  return typeof title === 'string' && typeof story === 'string' ? { title, story } : null;
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';

/** Pieces as two files each in one folder on this machine. */
export function createFilePieceStore(dir: string): PieceStore {
  async function readIfThere(name: string): Promise<Buffer | null> {
    try {
      return await readFile(path.join(dir, name));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async function record(blendId: string): Promise<StoredRecord | null> {
    const bytes = await readIfThere(recordName(blendId));
    return bytes ? parseRecord(bytes.toString('utf8')) : null;
  }

  return {
    async save(blendId, { title, label }, image) {
      await mkdir(dir, { recursive: true });
      const stored: StoredRecord = { title, label, mimeType: image.mimeType };
      await writeFile(path.join(dir, imageName(blendId)), image.bytes);
      await writeFile(path.join(dir, recordName(blendId)), JSON.stringify(stored));
    },
    async read(blendId) {
      const stored = await record(blendId);
      return stored && { title: stored.title, label: stored.label };
    },
    async image(blendId) {
      const stored = await record(blendId);
      if (!stored) return null;
      const bytes = await readIfThere(imageName(blendId));
      return bytes && { bytes, mimeType: stored.mimeType };
    },
  };
}

export interface SupabasePieceStoreOptions {
  url: string;
  secretKey: string;
  /** A private bucket; it is made on first use if the project does not have it. */
  bucket: string;
}

const STORAGE_TIMEOUT_MS = 20_000;

interface StorageFailure {
  message: string;
  status?: number;
  statusCode?: string;
}

/**
 * Storage answers a missing object with 404, or with 400 and "not found" in
 * the body on older projects.
 */
function isMissingObject(error: StorageFailure): boolean {
  return error.status === 404 || error.statusCode === '404' || /not found/i.test(error.message);
}

/** Pieces as two objects each in a private Supabase Storage bucket, read and written with the server's secret key. */
export function createSupabasePieceStore({ url, secretKey, bucket }: SupabasePieceStoreOptions): PieceStore {
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) }),
    },
  });
  const objects = client.storage.from(bucket);

  /** Makes the bucket if it is not there. Asked once; a failure is asked again on the next save. */
  let bucketReady: Promise<void> | null = null;
  function ensureBucket(): Promise<void> {
    bucketReady ??= (async () => {
      const found = await client.storage.getBucket(bucket);
      if (!found.error) return;
      const made = await client.storage.createBucket(bucket, { public: false });
      // Another server can make it between the two requests.
      if (made.error && !/already exists/i.test(made.error.message)) {
        throw new Error('Could not make the storage bucket "' + bucket + '": ' + made.error.message);
      }
    })().catch(error => {
      bucketReady = null;
      throw error;
    });
    return bucketReady;
  }

  async function put(name: string, bytes: Buffer, contentType: string): Promise<void> {
    const { error } = await objects.upload(name, bytes, { contentType, upsert: true });
    if (error) throw new Error('Could not store ' + name + ': ' + error.message);
  }

  async function get(name: string): Promise<Buffer | null> {
    const { data, error } = await objects.download(name);
    if (error) {
      if (isMissingObject(error)) return null;
      throw new Error('Could not read ' + name + ': ' + error.message);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async function record(blendId: string): Promise<StoredRecord | null> {
    const bytes = await get(recordName(blendId));
    return bytes ? parseRecord(bytes.toString('utf8')) : null;
  }

  return {
    async save(blendId, { title, label }, image) {
      await ensureBucket();
      const stored: StoredRecord = { title, label, mimeType: image.mimeType };
      await put(imageName(blendId), image.bytes, image.mimeType);
      await put(recordName(blendId), Buffer.from(JSON.stringify(stored)), 'application/json');
    },
    async read(blendId) {
      const stored = await record(blendId);
      return stored && { title: stored.title, label: stored.label };
    },
    async image(blendId) {
      const stored = await record(blendId);
      if (!stored) return null;
      const bytes = await get(imageName(blendId));
      return bytes && { bytes, mimeType: stored.mimeType };
    },
  };
}
