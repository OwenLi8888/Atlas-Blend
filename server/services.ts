import { createClient } from '@supabase/supabase-js';
import type { Work } from '../src/rec/scoring';
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Missing environment variable ' + name);
  return value;
}
export function createServices() {
  const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  async function search(queries: Record<string, unknown>[]): Promise<Work[][]> {
    const response = await fetch(required('TYPESENSE_HOST').replace(/\/$/, '') + '/multi_search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TYPESENSE-API-KEY': required('TYPESENSE_KEY') },
      body: JSON.stringify({ searches: queries.map(q => ({ collection: 'art_v1', q: '*', ...q })) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new ApiError(502, 'Art search unavailable');
    const payload = await response.json() as { results: { error?: string; hits?: { document: Work }[]; grouped_hits?: { hits: { document: Work }[] }[] }[] };
    return payload.results.map(r => {
      if (r.error) throw new ApiError(502, 'Art search failed: ' + r.error);
      return (r.hits ?? r.grouped_hits?.flatMap(g => g.hits) ?? []).map(h => h.document);
    });
  }
  async function documents(ids: string[]): Promise<Work[]> {
    if (!ids.length) return [];
    // IDs are values, never executable filter expressions.
    if (ids.some(id => !/^[\w:./-]{1,200}$/.test(id))) throw new ApiError(400, 'Invalid art ID');
    const results = await search(ids.map(id => ({ filter_by: 'id:=' + '`' + id + '`', per_page: 1 })));
    return results.flat();
  }
  async function knn(vectors: number[][]): Promise<Work[][]> {
    if (!vectors.length) return [];
    return search(vectors.map(v => ({
      vector_query: 'image_vec:([' + v.join(',') + '], k:100)', per_page: 100,
    })));
  }
  async function onboarding(): Promise<Work[]> {
    // The live collection has no aesthetic field, so select one representative per image cluster.
    return (await search([{ group_by: 'cluster_id', group_limit: 1, per_page: 30, exclude_fields: 'image_vec' }]))[0].slice(0, 20);
  }
  return { db, search, documents, knn, onboarding };
}
export type Services = ReturnType<typeof createServices>;
export function check<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) {
    if (result.error.code === 'PGRST205' || result.error.code === '42P01')
      throw new ApiError(503, 'Database tables missing. Run supabase/schema.sql first.');
    if (result.error.code === '23503') throw new ApiError(404, 'Profile not found');
    throw new ApiError(502, 'Profile storage unavailable');
  }
  return result.data;
}
