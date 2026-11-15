import { useState } from 'react';
import type { BlendResponse, Profile } from '../rec/api';
import { api, ApiFailure } from './api';
import { Reveal } from './Reveal';

interface Props {
  profile: Profile;
}

const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 12;

/** Trade codes with a friend, then see where your two galleries meet. */
export function Blend({ profile }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [blend, setBlend] = useState<BlendResponse | null>(null);

  if (blend) return <Reveal me={profile} blend={blend} onAgain={() => setBlend(null)} />;

  const submit = async () => {
    if (code.length < MIN_CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      setBlend(await api.blend(profile.id, code));
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.');
    } finally {
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
    <main className="page blend">
      <header className="page-head">
        <h1>Blend with a friend</h1>
        <p>Trade codes. We find the one work that sits between your two galleries, and paint it for you both.</p>
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
              autoFocus
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
    </main>
  );
}
