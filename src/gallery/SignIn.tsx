import { useState } from 'react';
import type { ProfileResponse } from '../rec/api';
import { api, ApiFailure } from './api';

interface Props {
  /** Called with the gallery that was opened. */
  onDone: (entered: ProfileResponse) => void;
}

const USERNAME_LENGTH = { min: 3, max: 20 };
const MIN_PASSCODE_LENGTH = 4;

/** For someone who already has a gallery: their username and passcode open it on this browser. */
export function SignIn({ onDone }: Props) {
  const [code, setCode] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = code.length >= USERNAME_LENGTH.min && passcode.length >= MIN_PASSCODE_LENGTH;

  const open = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api.signIn(code, passcode));
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <form
      className="sign-in"
      onSubmit={event => {
        event.preventDefault();
        void open();
      }}
    >
      <label>
        <span>{error ?? 'Have a gallery?'}</span>
        <input
          type="text"
          value={code}
          maxLength={USERNAME_LENGTH.max}
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error !== null}
          onChange={event => {
            setError(null);
            setCode(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
          }}
        />
      </label>
      <label>
        <span className="visually-hidden">Passcode</span>
        <input
          type="password"
          value={passcode}
          maxLength={64}
          placeholder="Passcode"
          autoComplete="current-password"
          onChange={event => {
            setError(null);
            setPasscode(event.target.value);
          }}
        />
      </label>
      <button type="submit" className="text-link" disabled={!complete || busy}>
        {busy ? 'Opening…' : 'Open it'}
      </button>
    </form>
  );
}
