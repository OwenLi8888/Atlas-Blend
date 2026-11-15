import { useCallback, useEffect, useRef, useState } from 'react';
import type { CuratorResponse } from '../rec/api';
import { api } from './api';

/** How often to look again while the curator is rehanging. */
const POLL_MS = 2500;
/** How long to wait after a heart changes before asking the curator, so a burst of hearts is one rehang. */
const SETTLE_MS = 1500;

export interface CuratorHandle {
  /** What the curator has for this person; null until the first answer arrives. */
  curator: CuratorResponse | null;
  /** Tells the curator something (optionally in answer to its question) and returns its short reply. */
  leaveNote: (text: string, question?: string) => Promise<string>;
}

/**
 * Follows a person's curator: asks again whenever what they have saved changes
 * (`savedKey`), and keeps asking while a rehang is under way.
 */
export function useCurator(userId: string, savedKey: string): CuratorHandle {
  const [curator, setCurator] = useState<CuratorResponse | null>(null);
  const [asked, setAsked] = useState(0);
  const askedBefore = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const ask = async () => {
      try {
        const latest = await api.curator(userId);
        if (cancelled) return;
        setCurator(latest);
        if (latest.status === 'working') timer = window.setTimeout(ask, POLL_MS);
      } catch {
        // A curator that cannot be reached is simply absent; the gallery works without it.
      }
    };
    // The first look is immediate; later ones wait for a burst of hearts to finish.
    timer = window.setTimeout(ask, askedBefore.current ? SETTLE_MS : 0);
    askedBefore.current = true;
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, savedKey, asked]);

  const leaveNote = useCallback(
    async (text: string, question?: string) => {
      const { reply } = await api.curatorNote(userId, text, question);
      // What was said changes what the curator hangs: ask again.
      setAsked(count => count + 1);
      return reply;
    },
    [userId],
  );

  return { curator, leaveNote };
}
