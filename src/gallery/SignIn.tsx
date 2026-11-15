import { useState } from 'react';
import type { ProfileResponse } from '../rec/api';
import { api, ApiFailure } from './api';

interface Props {
  /** Called with the gallery the code opened. */
  onDone: (entered: ProfileResponse) => void;
}

const CODE_LENGTH = { min: 3, max: 20 };

/** For someone who already has a gallery: their own code opens it on this browser. */
export function SignIn({ onDone }: Props) {
  const [code, setCode] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (code.length < CODE_LENGTH.min || busy) return;
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
          maxLength={CODE_LENGTH.max}
          placeholder="Username or code"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error !== null}
          onChange={event => {
            setError(null);
            setCode(event.target.value.replace(/[^A-Za-z0-9_]/g, ''));
          }}
        />
      </label>
      <label>
        <span className="visually-hidden">Passcode, if you set one</span>
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
      <button type="submit" className="text-link" disabled={code.length < CODE_LENGTH.min || busy}>
        {busy ? 'Opening…' : 'Open it'}
      </button>
    </form>
  );
}
