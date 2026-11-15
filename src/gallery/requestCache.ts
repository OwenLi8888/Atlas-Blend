/** Shares in-flight GETs and discards stale reads on either side of a mutation. */
const reads = new Map<string, { promise: Promise<unknown>; expires: number }>();
export function invalidateReads(): void { reads.clear(); }
export function cachedGet<T>(key: string, load: () => Promise<T>, ttl: number): Promise<T> {
  const existing = reads.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise as Promise<T>;
  const entry = { promise: load(), expires: Infinity };
  reads.set(key, entry);
  void entry.promise.then(() => {
    entry.expires = Date.now() + ttl;
    if (ttl === 0 && reads.get(key) === entry) reads.delete(key);
  }, () => { if (reads.get(key) === entry) reads.delete(key); });
  // Bound memory even if many profiles are opened in one tab.
  if (reads.size > 100) reads.delete(reads.keys().next().value!);
  return entry.promise;
}
