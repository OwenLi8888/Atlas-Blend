import { useCallback, useEffect, useState } from 'react';
import type { BlendResponse, ChosenPainter, HeartedWork, Profile, ProfileResponse } from '../rec/api';
import { api, ApiFailure, SESSION_LOST } from './api';
import { BlendPage, Blends } from './Blends';
import { Explore } from './Explore';
import { Gallery } from './Gallery';
import { Onboarding } from './Onboarding';
import { painterOf } from './painter';
import { ProfileMenu } from './ProfileMenu';
import { Settings } from './Settings';
import { SignIn } from './SignIn';
import { forgetUserId, newUserId, rememberedUserId, rememberUserId } from './session';
import { canOpenStudio } from './PaintStudio';
import { StudioEntrance, type StudioChoice } from './StudioEntrance';

type Route =
  | { page: 'for-you' }
  | { page: 'saved' }
  | { page: 'rooms' }
  | { page: 'explore' }
  | { page: 'blends' }
  | { page: 'settings' }
  | { page: 'blend'; blendId: string };

const BLEND_ROUTE = /^#\/blends\/([0-9a-f-]{36})$/i;

function routeFromHash(): Route {
  const hash = window.location.hash;
  const blend = BLEND_ROUTE.exec(hash);
  if (blend) return { page: 'blend', blendId: blend[1] };
  if (hash === '#/saved') return { page: 'saved' };
  if (hash === '#/rooms') return { page: 'rooms' };
  if (hash === '#/explore') return { page: 'explore' };
  if (hash === '#/blends') return { page: 'blends' };
  if (hash === '#/settings') return { page: 'settings' };
  return { page: 'for-you' };
}

type Session =
  | { state: 'loading' }
  | { state: 'unreachable'; message: string }
  | { state: 'ready'; profile: Profile | null; hearts: HeartedWork[] };

export function GalleryApp() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const [route, setRoute] = useState<Route>(routeFromHash);
  /** The blend made a moment ago, kept so it can be revealed without asking the server again. */
  const [freshBlend, setFreshBlend] = useState<BlendResponse | null>(null);
  /**
   * A first visit, when the browser can draw the studio: the works first, then the painted studio,
   * where the painter and name are chosen and the visitor is signed up. Null: no studio (WebGL2
   * missing), so the works screen asks for everything itself, as before.
   */
  const [firstVisit, setFirstVisit] = useState<{ step: 'works' | 'studio'; picks: string[]; choice: StudioChoice | null } | null>(() =>
    canOpenStudio() ? { step: 'works', picks: [], choice: null } : null,
  );
  /** The ID a first visit signs up with, kept across attempts so trying again never makes a second profile. */
  const [signUpId] = useState(newUserId);
  const [signingUp, setSigningUp] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);
  /** Shows a new choice of painter at once, in the bar and everywhere else; Settings saves it to the profile. */
  const showPainter = useCallback((painter: ChosenPainter) => {
    setSession(current =>
      current.state === 'ready' && current.profile ? { ...current, profile: { ...current.profile, painter } } : current,
    );
  }, []);

  /** Shows the username just set, in the menu and in Settings. */
  const showUsername = useCallback((username: string) => {
    setSession(current => (current.state === 'ready' && current.profile ? { ...current, profile: { ...current.profile, username } } : current));
  }, []);

  /**
   * Shows a change of hearts. It only ever changes the hearts of a profile that is still here: an
   * answer that arrives after the profile was lost (see SESSION_LOST) must not bring its gallery back.
   */
  const showHearts = useCallback((hearts: HeartedWork[]) => {
    setSession(current => (current.state === 'ready' && current.profile ? { ...current, hearts } : current));
  }, []);

  useEffect(() => {
    const onHash = () => {
      const next = routeFromHash();
      setRoute(next);
      // A blend is only "fresh" while its reveal is on screen; leaving it makes it a saved blend like any other.
      setFreshBlend(fresh => (fresh && next.page === 'blend' && next.blendId === fresh.id ? fresh : null));
      window.scrollTo({ top: 0 });
    };
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

  // Any request can find the profile gone; whichever screen is open, go back to the start.
  useEffect(() => {
    const onLost = () => {
      forgetUserId();
      window.location.hash = '#/';
      void load(null);
    };
    window.addEventListener(SESSION_LOST, onLost);
    return () => window.removeEventListener(SESSION_LOST, onLost);
  }, [load]);

  // Signing up answers with the profile and its hearts, so the gallery opens without asking again.
  const enter = useCallback(({ profile, hearts }: ProfileResponse) => {
    rememberUserId(profile.id);
    window.location.hash = '#/';
    window.scrollTo({ top: 0 });
    setSession({ state: 'ready', profile, hearts });
  }, []);

  // Logging out only forgets which gallery this browser opens; the gallery is kept, and its code opens it again.
  const logOut = useCallback(() => {
    forgetUserId();
    setFirstVisit(canOpenStudio() ? { step: 'works', picks: [], choice: null } : null);
    setFreshBlend(null);
    window.location.hash = '#/';
    window.scrollTo({ top: 0 });
    setSession({ state: 'ready', profile: null, hearts: [] });
  }, []);

  const profile = session.state === 'ready' ? session.profile : null;
  const hasGallery = session.state === 'ready' && profile !== null && session.hearts.length > 0;
  const inGallery = route.page === 'for-you' || route.page === 'saved' || route.page === 'rooms';
  const inBlends = route.page === 'blends' || route.page === 'blend';

  return (
    <>
      <header className="bar">
        <a className="wordmark" href="#/">
          Atlas Blend
        </a>
        {hasGallery && (
          <nav aria-label="Sections">
            <a href="#/" aria-current={inGallery ? 'page' : undefined}>
              Gallery
            </a>
            <a href="#/explore" aria-current={route.page === 'explore' ? 'page' : undefined}>
              Explore
            </a>
            <a href="#/blends" aria-current={inBlends ? 'page' : undefined}>
              Blends
            </a>
          </nav>
        )}
        {hasGallery && profile && (
          <ProfileMenu
            name={profile.name}
            painter={painterOf(profile).painter}
            onSettings={route.page === 'settings'}
            code={profile.blend_code}
            username={profile.username}
            onLogOut={logOut}
          />
        )}
        {session.state === 'ready' && !profile && <SignIn onDone={enter} />}
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

      {/* A first visit: the works, then the painted studio, where the painter and name are chosen and the profile is made. */}
      {session.state === 'ready' && !hasGallery && !profile && firstVisit?.step === 'studio' && (
        <StudioEntrance
          initial={firstVisit.choice}
          busy={signingUp}
          error={signUpError}
          onBack={sofar => {
            setSignUpError(null);
            setFirstVisit(visit => visit && { ...visit, step: 'works', choice: sofar ?? visit.choice });
          }}
          onEnter={async choice => {
            // A username and a passcode go together; a visitor may also leave both for later.
            if ((choice.username === '') !== (choice.passcode === '')) {
              setFirstVisit(visit => visit && { ...visit, choice });
              setSignUpError('Choose both a username and a passcode, or leave both empty.');
              return;
            }
            const picks = firstVisit.picks;
            setFirstVisit(visit => visit && { ...visit, choice });
            setSigningUp(true);
            setSignUpError(null);
            try {
              const entered = await api.createProfile(signUpId, choice.name || 'Guest', picks, choice.painter.id);
              // A username and passcode are optional; given both, they are set before the gallery opens,
              // so a taken username is said here, where it can be changed. Signing up again is safe.
              const signIn = choice.username && choice.passcode ? await api.setPasscode(entered.profile.id, choice.passcode, choice.username) : null;
              enter(signIn ? { ...entered, profile: { ...entered.profile, username: signIn.username } } : entered);
            } catch (failure) {
              setSignUpError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.');
            } finally {
              setSigningUp(false);
            }
          }}
        />
      )}
      {session.state === 'ready' && !hasGallery && (profile || firstVisit?.step !== 'studio') && (
        <Onboarding
          profile={profile}
          onDone={enter}
          initialPicks={profile ? undefined : firstVisit?.picks}
          onChosen={
            !profile && firstVisit
              ? picks => {
                  setFirstVisit(visit => visit && { ...visit, step: 'studio', picks });
                  window.scrollTo({ top: 0 });
                }
              : undefined
          }
        />
      )}

      {session.state === 'ready' && hasGallery && profile && (
        <>
          {inGallery && (
            <Gallery
              profile={profile}
              hearts={session.hearts}
              onHearts={showHearts}
              tab={route.page === 'saved' || route.page === 'rooms' ? route.page : 'for-you'}
            />
          )}
          {route.page === 'explore' && (
            <Explore profile={profile} hearts={session.hearts} onHearts={showHearts} />
          )}
          {route.page === 'blends' && (
            <Blends
              profile={profile}
              onMade={blend => {
                setFreshBlend(blend);
                window.location.hash = '#/blends/' + blend.id;
              }}
            />
          )}
          {route.page === 'settings' && <Settings profile={profile} onPainter={showPainter} onUsername={showUsername} />}
          {route.page === 'blend' && <BlendPage profile={profile} blendId={route.blendId} fresh={freshBlend} />}
        </>
      )}
    </>
  );
}
