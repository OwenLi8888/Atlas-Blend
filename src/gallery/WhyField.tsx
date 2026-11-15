import { useState } from 'react';

interface Props {
  /** The reason already saved, if any. */
  saved: string | null;
  onSave: (why: string) => Promise<void>;
}

const MAX_LENGTH = 500;

/** An optional line for why a work was hearted. Saves on Enter or when focus leaves. */
export function WhyField({ saved, onSave }: Props) {
  const [value, setValue] = useState(saved ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  // Takes the text from the field itself, so a save right after typing never reads a stale value.
  const save = async (text: string) => {
    const why = text.trim();
    if (!why || why === (saved ?? '')) return;
    setState('saving');
    try {
      await onSave(why);
      setState('saved');
    } catch {
      setState('failed');
    }
  };

  return (
    <label className="why">
      <span className="visually-hidden">What drew you to it?</span>
      <input
        type="text"
        value={value}
        maxLength={MAX_LENGTH}
        placeholder="What drew you to it? (optional)"
        onChange={event => {
          setValue(event.target.value);
          setState('idle');
        }}
        onBlur={event => void save(event.currentTarget.value)}
        onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()}
      />
      <span className="why-state" role="status">
        {state === 'saved' ? 'Noted' : state === 'failed' ? 'Could not save' : ''}
      </span>
    </label>
  );
}
