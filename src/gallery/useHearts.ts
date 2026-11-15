import { useCallback, useState } from 'react';
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

  const of = (work: Artwork) => hearts.find(heart => heart.work.id === work.id);

  const toggle = async (work: Artwork) => {
    setError(null);
    try {
      if (of(work)) {
        await api.unheart(profile.id, work.id);
        onHearts(hearts.filter(heart => heart.work.id !== work.id));
      } else {
        const { heart } = await api.heart(profile.id, work.id);
        onHearts([{ work, why: heart.why, hearted_at: heart.created_at }, ...hearts]);
      }
      setChanges(count => count + 1);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.');
    }
  };

  const saveWhy = async (work: Artwork, why: string) => {
    const { heart } = await api.heart(profile.id, work.id, why);
    onHearts(hearts.map(existing => (existing.work.id === work.id ? { ...existing, why: heart.why } : existing)));
  };

  const settle = useCallback(() => setChanges(0), []);
  return { of, toggle, saveWhy, error, changes, settle };
}
