import React from 'react';
import GameModal from './ModalShell';
import type { CityEventNotice } from '../../../../types/game';

interface CityEventModalProps {
  show: boolean;
  notice: CityEventNotice | null;
  /** "Your Empire · Turn 12 · 3960 BC" — shared eyebrow stamp from the caller. */
  stampLabel: string;
  /** Name of the civilisation that took / razed / joined (resolved by the caller). */
  byCivName?: string;
  /** Terrain name of the city tile, resolved by the caller. */
  terrainName?: string;
  /** Id of the human civilisation — used to tell "taken from you" from "taken for you". */
  playerCivId: number;
  onContinue: () => void;
  onGoToCity: () => void;
}

/**
 * City events the human player is part of: a city founded or joined, one
 * captured (by or from the player), or razed to the ground. One component,
 * four voices — the tone, title and lede all follow `notice.kind`.
 */
const CityEventModal: React.FC<CityEventModalProps> = ({
  show,
  notice,
  stampLabel,
  byCivName,
  terrainName,
  playerCivId,
  onContinue,
  onGoToCity,
}) => {
  if (!notice) return null;

  const ours = notice.byCivId === playerCivId || notice.kind === 'founded' || notice.kind === 'joined';
  // Civ names are plural ("the English", "the Aztecs") — read naturally.
  const byCiv = byCivName ? `the ${byCivName}` : 'a rival';
  const isRazed = notice.kind === 'razed';
  const isFounded = notice.kind === 'founded';
  const isJoined = notice.kind === 'joined';

  const eyebrow = `${isFounded ? 'A New City' : isJoined ? 'A City Joins You' : isRazed ? 'A City Burns' : 'City Lost'} · ${stampLabel}`;
  const title = isFounded
    ? `${notice.cityName} is founded`
    : isJoined
      ? `${notice.cityName} joins your empire`
      : isRazed
        ? `${notice.cityName} was burned to the ground`
        : ours
          ? `${notice.cityName} is yours`
          : `${notice.cityName} has fallen`;

  const lede = isFounded ? (
    <>
      Your settlers have marked out a site and raised the first walls. <strong>{notice.cityName}</strong> is
      a city of your people now — small, hungry, and full of promise.
    </>
  ) : isJoined ? (
    <>
      The elders of <strong>{notice.cityName}</strong> opened their gates before a shot was fired.
      Their people are your people from this turn on.
    </>
  ) : isRazed ? (
    <>
      Nothing is left of <strong>{notice.cityName}</strong> but smoke. Whoever took it wanted the
      ground, not the citizens.
    </>
  ) : ours ? (
    <>
      Your banners are over the walls of <strong>{notice.cityName}</strong>. The city that resisted
      you now answers to your name.
    </>
  ) : (
    <>
      <strong>{notice.cityName}</strong> is gone from your maps — taken by{' '}
      <strong>{byCiv}</strong> while your armies were elsewhere.
    </>
  );

  return (
    <GameModal
      show={show}
      onClose={onContinue}
      size="lg"
      tone={ours ? 'success' : 'danger'}
      icon={isFounded ? '🏗️' : isJoined ? '🤝' : isRazed ? '🔥' : '🏚️'}
      artLabel={ours ? 'new walls at dawn' : 'a city in ruins'}
      dialogClassName="city-event-modal"
      eyebrow={eyebrow}
      title={title}
      lede={lede}
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onContinue}>
            {ours ? 'Continue' : 'Steady the Realm'}
          </button>
          {(isFounded || isJoined || ours) && (
            <button
              type="button"
              className="touch-btn touch-btn--primary"
              onClick={onGoToCity}
              autoFocus
            >
              Open City
            </button>
          )}
        </>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🏘️</span>
            {notice.cityName}
          </span>
          <span className="gm-stat-label">{isRazed ? 'Destroyed' : 'City'}</span>
        </div>
        {!isRazed && (
          <>
            <div className="gm-stat">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">👥</span>
                {notice.population}
              </span>
              <span className="gm-stat-label">Population</span>
            </div>
            <div className="gm-stat">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">🧭</span>
                ({notice.col}, {notice.row})
              </span>
              <span className="gm-stat-label">{terrainName ?? 'Its tile'}</span>
            </div>
          </>
        )}
      </div>

      <div className="gm-section">
        <div className="gm-section-title">
          {ours ? 'What happens next' : 'What this means'}
        </div>
        {isFounded || isJoined || ours ? (
          <ul className="gm-list">
            <li>Open the city and give it a first order — a granary, a warrior, a settler.</li>
            <li>Its radius is worked by your governor until you say otherwise.</li>
            <li>A city with nothing in production earns nothing and defends nothing.</li>
          </ul>
        ) : (
          <ul className="gm-list">
            <li>Its people, its buildings and its tile now serve <strong>{byCiv}</strong>.</li>
            <li>You can take it back — an assault on a city works like any other attack.</li>
            <li>Keep a garrison next time: a city with no defenders falls to the first raider.</li>
          </ul>
        )}
      </div>

      {!ours && !isRazed && (
        <div className="gm-note">
          Cities fall when their last defender falls. Leave at least one unit inside the walls.
        </div>
      )}
      {isRazed && (
        <div className="gm-note">
          A razed city leaves nothing behind — no population, no buildings, no salvage.
        </div>
      )}
    </GameModal>
  );
};

export default CityEventModal;
