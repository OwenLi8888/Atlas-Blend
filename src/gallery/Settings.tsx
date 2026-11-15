import { useState } from 'react';
import type { Profile } from '../rec/api';
import { PainterSprite } from './PainterSprite';
import { MAX_PAINTER_NAME_LENGTH, PAINTERS, defaultPainter, painterImage, savePainterChoice, savedPainterChoice, type PainterChoice } from './painter';

interface Props {
  profile: Profile;
}

/** Things a person sets once: for now, which painter is theirs and what it is called. */
export function Settings({ profile }: Props) {
  const [choice, setChoice] = useState<PainterChoice | null>(savedPainterChoice);
  const painter = PAINTERS.find(candidate => candidate.id === choice?.painterId) ?? defaultPainter(profile.id);

  const choose = (next: PainterChoice) => {
    setChoice(next);
    savePainterChoice(next);
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <p>Your painter stands in the room whenever you blend with a friend.</p>
      </header>

      <section className="settings-painter">
        <div className="settings-preview" aria-hidden="true">
          <PainterSprite painter={painter} />
        </div>
        <div className="settings-fields">
          <h2 className="eyebrow">Your painter</h2>
          <div className="settings-options" role="radiogroup" aria-label="Your painter">
            {PAINTERS.map(option => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={option.id === painter.id}
                aria-label={option.name}
                className="settings-option"
                onClick={() => choose({ painterId: option.id, name: choice?.name ?? '' })}
              >
                <img src={painterImage(option)} alt="" draggable={false} />
              </button>
            ))}
          </div>
          <label className="settings-name">
            <span className="eyebrow">Its name</span>
            <input
              type="text"
              value={choice?.name ?? ''}
              maxLength={MAX_PAINTER_NAME_LENGTH}
              placeholder={painter.name}
              onChange={event => choose({ painterId: painter.id, name: event.target.value })}
            />
          </label>
          <p className="quiet">Saved on this device as you change it.</p>
        </div>
      </section>
    </main>
  );
}
