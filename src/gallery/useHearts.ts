import { useCallback, useRef, useState } from 'react';
import type { Artwork, HeartedWork, Profile } from '../rec/api';
import { api, ApiFailure } from './api';

export interface Hearts {
  /** The heart on a work, or undefined when it has none. */
  of: (work: Artwork) => HeartedWork | undefined;
  toggle: (work: Artwork) => Promise<void>;
  saveWhy: (work: Artwork, why: string) => Promise<void>;
  /** What went wrong with the last change, if anything. */
  error: string | null;
  /** Hearts added or removed since `settle` was last called. */
  changes: number;
  settle: () => void;
}

/** Hearting, unhearting and giving reasons, shared by every screen that shows works. */
export function useHearts(profile: Profile, hearts: readonly HeartedWork[], onHearts: (hearts: HeartedWork[]) => void): Hearts {
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);
  const current = useRef(hearts);
  current.current = hearts;
  const pending = useRef(new Set<string>());
  const publish = (next: readonly HeartedWork[]) => { current.current = next; onHearts([...next]); };

  const of = (work: Artwork) => hearts.find(heart => heart.work.id === work.id);

  const toggle = async (work: Artwork) => {
    if (pending.current.has(work.id)) return;
    pending.current.add(work.id);
    setError(null);
    const previous = current.current.find(heart => heart.work.id === work.id);
    // Publish before the network request. Use the latest list so concurrent hearts cannot overwrite one another.
    publish(previous
      ? current.current.filter(heart => heart.work.id !== work.id)
      : [{ work, why: null, hearted_at: new Date().toISOString() }, ...current.current]);
    try {
      if (previous) await api.unheart(profile.id, work.id);
      else {
        const { heart } = await api.heart(profile.id, work.id);
        publish(current.current.map(item => item.work.id === work.id ? { work, why: heart.why, hearted_at: heart.created_at } : item));
      }
      setChanges(count => count + 1);
    } catch (failure) {
      const others = current.current.filter(heart => heart.work.id !== work.id);
      publish(previous ? [previous, ...others] : others);
      setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.');
    } finally {
      pending.current.delete(work.id);
    }
  };

  const saveWhy = async (work: Artwork, why: string) => {
    const { heart } = await api.heart(profile.id, work.id, why);
    publish(current.current.map(existing => (existing.work.id === work.id ? { ...existing, why: heart.why } : existing)));
  };

  const settle = useCallback(() => setChanges(0), []);
  return { of, toggle, saveWhy, error, changes, settle };
}
