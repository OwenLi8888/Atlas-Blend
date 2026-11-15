import { useEffect, useState } from 'react';
import type { BlendResponse, BlendSummary, Profile } from '../rec/api';
import { api, ApiFailure } from './api';
import { Reveal } from './Reveal';

const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 12;

interface BlendsProps {
  profile: Profile;
  /** Called with a blend that has just been made, so it can be revealed. */
  onMade: (blend: BlendResponse) => void;
}

/** Your blends: start a new one by trading codes, or reopen one you have made. */
export function Blends({ profile, onMade }: BlendsProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<BlendSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.blends(profile.id).then(
      response => !cancelled && setSaved(response.blends),
      () => !cancelled && setSaved([]),
    );
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  const submit = async () => {
    if (code.length < MIN_CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      onMade(await api.blend(profile.id, code));
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(profile.blend_code);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the code is on screen to read out instead.
    }
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>Blends</h1>
        <p>Trade codes with a friend. A new piece is made from what you each love, and the blend is kept here.</p>
      </header>

      <div className="blend-columns">
        <section>
          <h2 className="eyebrow">Your code</h2>
          <p className="code" aria-label={profile.blend_code.split('').join(' ')}>
            {profile.blend_code}
          </p>
          <button type="button" className="text-link" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </section>

        <form
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            <span className="eyebrow">Their code</span>
            <input
              className="code code-input"
              type="text"
              value={code}
              maxLength={MAX_CODE_LENGTH}
              placeholder="······"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={event => {
                setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                setError(null);
              }}
            />
          </label>
          <div className="blend-submit">
            <button type="submit" className="button" disabled={code.length < MIN_CODE_LENGTH || busy}>
              {busy ? 'Finding where you meet…' : 'Blend'}
            </button>
            {error && (
              <p className="quiet" role="alert">
                {error}
              </p>
            )}
          </div>
        </form>
      </div>

      {saved && saved.length > 0 && (
        <section className="saved-blends" aria-label="Blends you have made">
          <h2 className="section-title">Your blends</h2>
          <div className="blend-cards">
            {saved.map(blend => (
              <a key={blend.id} className="blend-card" href={'#/blends/' + blend.id}>
                <img src={blend.image_url ?? blend.top_artwork.image_url} alt="" loading="lazy" draggable={false} />
                <span className="blend-card-with">With {blend.friend.name || 'a friend'}</span>
                <span className="blend-card-title">{blend.title ?? blend.top_artwork.title}</span>
                <span className="blend-card-meta">
                  {blend.score}% taste match · {new Date(blend.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

interface BlendPageProps {
  profile: Profile;
  blendId: string;
  /** The blend if it was made a moment ago in this visit: it is revealed with the painting animation. */
  fresh: BlendResponse | null;
}

/** One blend. A new one is revealed stroke by stroke; a saved one opens as it was left. */
export function BlendPage({ profile, blendId, fresh }: BlendPageProps) {
  const isFresh = fresh?.id === blendId;
  const [loaded, setLoaded] = useState<{ blendId: string; blend: BlendResponse | null; error: string | null } | null>(null);

  useEffect(() => {
    if (isFresh) return;
    let cancelled = false;
    api.savedBlend(blendId, profile.id).then(
      blend => !cancelled && setLoaded({ blendId, blend, error: null }),
      failure =>
        !cancelled && setLoaded({ blendId, blend: null, error: failure instanceof ApiFailure ? failure.message : 'Something went wrong.' }),
    );
    return () => {
      cancelled = true;
    };
  }, [isFresh, blendId, profile.id]);

  if (isFresh && fresh) return <Reveal key={blendId} me={profile} blend={fresh} revisit={false} />;

  const current = loaded && loaded.blendId === blendId ? loaded : null;
  if (current?.blend) return <Reveal key={blendId} me={profile} blend={current.blend} revisit />;
  return (
    <main className="page">
      <header className="page-head">
        <h1>{current?.error ? 'This blend could not be opened.' : 'Opening your blend…'}</h1>
        {current?.error && <p>{current.error}</p>}
      </header>
      {current?.error && (
        <a className="text-link" href="#/blends">
          Back to your blends
        </a>
      )}
    </main>
  );
}
