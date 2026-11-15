import { useCallback, useEffect, useState } from 'react';
import type { HeartedWork, Profile } from '../rec/api';
import { api, ApiFailure } from './api';
import { Blend } from './Blend';
import { Onboarding } from './Onboarding';
import { forgetUserId, rememberedUserId, rememberUserId } from './session';
import { Wall } from './Wall';

type Route = 'wall' | 'blend';

function routeFromHash(): Route {
  return window.location.hash === '#/blend' ? 'blend' : 'wall';
}

type Session =
  | { state: 'loading' }
  | { state: 'unreachable'; message: string }
  | { state: 'ready'; profile: Profile | null; hearts: HeartedWork[] };

export function GalleryApp() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const [route, setRoute] = useState<Route>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const load = useCallback(async (userId: string | null) => {
    if (!userId) {
      setSession({ state: 'ready', profile: null, hearts: [] });
      return;
    }
    try {
      const { profile, hearts } = await api.profile(userId);
      setSession({ state: 'ready', profile, hearts });
    } catch (failure) {
      if (failure instanceof ApiFailure && (failure.status === 404 || failure.status === 400)) {
        // The remembered profile is gone (for example the server's data was reset): start again.
        forgetUserId();
        setSession({ state: 'ready', profile: null, hearts: [] });
      } else {
        setSession({ state: 'unreachable', message: failure instanceof Error ? failure.message : 'Something went wrong.' });
      }
    }
  }, []);

  useEffect(() => {
    void load(rememberedUserId());
  }, [load]);

  const enter = useCallback(
    (profile: Profile) => {
      rememberUserId(profile.id);
      window.location.hash = '#/';
      window.scrollTo({ top: 0 });
      void load(profile.id);
    },
    [load],
  );

  const profile = session.state === 'ready' ? session.profile : null;
  const hasGallery = session.state === 'ready' && profile !== null && session.hearts.length > 0;

  return (
    <>
      <header className="bar">
        <a className="wordmark" href="#/">
          Gallery Blend
        </a>
        {hasGallery && (
          <nav aria-label="Sections">
            <a href="#/" aria-current={route === 'wall' ? 'page' : undefined}>
              Gallery
            </a>
            <a href="#/blend" aria-current={route === 'blend' ? 'page' : undefined}>
              Blend
            </a>
          </nav>
        )}
      </header>

      {session.state === 'loading' && <p className="page quiet">Opening the gallery…</p>}

      {session.state === 'unreachable' && (
        <main className="page">
          <header className="page-head">
            <h1>The gallery is closed for a moment.</h1>
            <p>{session.message}</p>
          </header>
          <button type="button" className="button" onClick={() => void load(rememberedUserId())}>
            Try again
          </button>
        </main>
      )}

      {session.state === 'ready' && !hasGallery && <Onboarding profile={profile} onDone={enter} />}

      {session.state === 'ready' && hasGallery && profile && route === 'wall' && (
        <Wall
          profile={profile}
          hearts={session.hearts}
          onHearts={hearts => setSession({ state: 'ready', profile, hearts })}
        />
      )}

      {session.state === 'ready' && hasGallery && profile && route === 'blend' && <Blend profile={profile} />}
    </>
  );
}
