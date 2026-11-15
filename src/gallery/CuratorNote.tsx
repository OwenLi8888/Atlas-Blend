import { useState } from 'react';
import type { CuratorResponse } from '../rec/api';
import { ApiFailure } from './api';

interface Props {
  curator: CuratorResponse;
  /** Sends what the person said; `question` is the curator's question it answers, if any. */
  leaveNote: (text: string, question?: string) => Promise<string>;
}

const MAX_LENGTH = 600;

/**
 * The curator's side of the gallery: one easy question at a time, answered by
 * picking a few words or writing your own. It is not a conversation on screen:
 * a question, then a short acknowledgement, then (after the rehang) the next question.
 */
export function CuratorNote({ curator, leaveNote }: Props) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  /** The question that was just answered, hidden until the curator asks a new one. */
  const [answered, setAnswered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const question = curator.question && curator.question.text !== answered ? curator.question : null;

  const send = async (said: string) => {
    const note = said.trim();
    if (!note || busy) return;
    setBusy(true);
    setError(null);
    try {
      setReply(await leaveNote(note, question?.text));
      setAnswered(curator.question?.text ?? null);
      setText('');
      setWriting(false);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The curator could not answer just now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="curator" aria-live="polite">
      {question ? (
        <>
          <p className="curator-ask">{question.text}</p>
          <div className="curator-answers">
            {question.answers.map(answer => (
              <button key={answer} type="button" disabled={busy} onClick={() => void send(answer)}>
                {answer}
              </button>
            ))}
            {!writing && (
              <button type="button" className="curator-other" disabled={busy} onClick={() => setWriting(true)}>
                Something else
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="curator-said">
          {reply ?? 'Tell the curator what you like, and the rooms will follow.'}
          {!writing && (
            <button type="button" className="curator-other" disabled={busy} onClick={() => setWriting(true)}>
              {reply ? 'Add something' : 'Say something'}
            </button>
          )}
        </p>
      )}

      {writing && (
        <form
          className="curator-write"
          onSubmit={event => {
            event.preventDefault();
            void send(text);
          }}
        >
          <label>
            <span className="visually-hidden">In your own words</span>
            <input
              type="text"
              value={text}
              maxLength={MAX_LENGTH}
              disabled={busy}
              autoFocus
              placeholder="In your own words"
              onChange={event => setText(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || text.trim() === ''}>
            {busy ? 'Sending' : 'Send'}
          </button>
        </form>
      )}

      {error && (
        <p className="quiet" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
