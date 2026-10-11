import React, { useEffect, useMemo, useState } from 'react';
import GameModal from '@/components/ui/gamemodals/ModalShell';
import { useGameStore } from '@/stores/GameStore';
import { GameUtils } from '@/utils/GameUtils';
import { WONDER_PROPERTIES } from '@/data/BuildingConstants';
import type { GameResult } from '../../../types/game';
import '@/styles/gameResultOverlay.css';

type GameResultOverlayProps = {
  result: GameResult | null;
  onClose: () => void;
  onRestart: () => void;
  onQuit: () => void;
};

/**
 * The end of a game plays in two acts.
 *
 * Act I — *cinematic*: a full-bleed takeover (not a modal) that stages the
 * outcome like the last page of a chronicle: sky, outcome word, the ruler's
 * name, and a few verses of reign summary. Fireworks (VictoryFireworks, owned
 * by App) are already running behind it. No numbers grid yet — this act is
 * for the feeling.
 *
 * Act II — *chronicle*: the shared GameModal shell with the final ledger
 * (score, population, techs, wonders …) and the Restart / Quit actions.
 *
 * The wrapper div generates no box — it only carries the outcome class for
 * the confetti stacking rules in gameResultOverlay.css — because both acts
 * are portaled to <body> and must never be blocked by their own host.
 */
const GameResultOverlay: React.FC<GameResultOverlayProps> = ({
  result,
  onClose,
  onRestart,
  onQuit
}) => {
  const civId = result?.civilizationId ?? -1;
  const resultStamp = result?.timestamp ?? null;

  // Act tracking. Read unconditionally (before the early return below) so
  // the hooks keep the rules of hooks.
  const [act, setAct] = useState<'cinematic' | 'chronicle'>('cinematic');

  // A fresh result always restarts at the cinematic.
  useEffect(() => {
    setAct('cinematic');
  }, [resultStamp]);

  const currentTurn = useGameStore((state) => state.gameState.currentTurn);
  const currentYear = useGameStore((state) => state.gameState.currentYear);
  const actions = useGameStore((state) => state.actions);
  const skipResultScreen = useGameStore((state) => state.settings.skipGameResultScreen);
  // The checkbox starts from the persisted setting, so ticking it here and
  // ticking the Settings switch are the same fact, not two of them.
  const [dontShowAgain, setDontShowAgain] = useState(skipResultScreen);

  // A fresh outcome resets the box to whatever is saved.
  useEffect(() => {
    setDontShowAgain(skipResultScreen);
  }, [resultStamp, skipResultScreen]);
  // Select the raw arrays (stable store references) — filtering inside the
  // selector would return a new array every snapshot and loop forever.
  const allCities = useGameStore((state) => state.cities);
  const fieldUnits = useGameStore(
    (state) => state.units.filter((unit) => unit.civilizationId === civId).length
  );
  const civilizations = useGameStore((state) => state.civilizations);

  const ledger = useMemo(() => {
    const myCities = allCities.filter((city) => city.civilizationId === civId);
    const me = civilizations.find((civ) => civ.id === civId);
    const population = myCities.reduce((sum, city) => sum + (city.population || 0), 0);
    const wonders = myCities.reduce((sum, city) => {
      if (Array.isArray(city.wonders)) return sum + city.wonders.length;
      if (Array.isArray(city.buildings)) {
        return sum + city.buildings.filter((b) => WONDER_PROPERTIES[b]).length;
      }
      return sum;
    }, 0);
    const capital = myCities.find((city) => city.isCapital)?.name ?? myCities[0]?.name;
    const rivalsStanding = civilizations.filter(
      (civ) => civ.isAlive !== false && civ.id !== civId
    ).length;
    const lastRival =
      civilizations.find((civ) => civ.isAlive !== false && civ.id !== civId)?.name ?? null;

    return {
      score: me?.score ?? 0,
      techs: me?.technologies?.length ?? 0,
      population,
      cities: myCities.length,
      wonders,
      capital,
      rivalsStanding,
      lastRival
    };
  }, [allCities, civilizations, civId]);

  if (!result) {
    return null;
  }

  const isVictory = result.outcome === 'victory';
  const human = result.isHuman;
  const yearLabel =
    currentYear !== undefined && currentYear !== null ? GameUtils.formatYear(currentYear) : '—';

  const eyebrow = `${isVictory ? 'Victory' : 'Defeat'} · ${result.civName}`;

  const title = !isVictory
    ? 'Your Empire Has Fallen'
    : human
      ? 'The World Is Yours'
      : `${result.civName} Claims the World`;

  const lede = !isVictory
    ? 'Your empire has crumbled. Only stories of your once-great cities remain — and the board keeps the shape of your last stand.'
    : !human
      ? `The age belongs to ${result.civName}. Every rival lies beneath its banner, and the record of this game is complete.`
      : result.reason === 'moonshot'
        ? 'Your scientists have turned the sky into a road. With the Moonshot complete, your people step into a golden age no rival can follow.'
        : result.reason === 'domination'
          ? 'Every city on the map flies your banner. There is no rival left to contest your rule.'
          : 'The last rival civilization has broken beneath your banner. The world answers to you alone.';

  // ---- Act I: cinematic verses -------------------------------------------
  // A few narrative lines, not a stat sheet — the ledger waits in Act II.
  const verses: string[] = !isVictory
    ? [
        `The chronicle ends in ${yearLabel}, on turn ${currentTurn}.`,
        ledger.capital
          ? `Your last capital, ${ledger.capital}, falls silent — and with it, a dream that began in the first camp of the age.`
          : 'Your last cities are gone, and with them a dream that began in the first camp of the age.',
        ledger.lastRival
          ? `The world now answers to ${ledger.lastRival}.`
          : 'No single heir remains to claim what was yours.'
      ]
    : [
        `For ${currentTurn} ${currentTurn === 1 ? 'turn' : 'turns'} your people endured — through famine, war and wonder — until ${yearLabel}.`,
        ledger.capital
          ? `From ${ledger.capital} outward, ${ledger.cities} ${ledger.cities === 1 ? 'city stands' : 'cities stand'} under one banner, and ${ledger.population} ${ledger.population === 1 ? 'citizen' : 'citizens'} carry your name forward.`
          : `${ledger.cities} ${ledger.cities === 1 ? 'city stands' : 'cities stand'} under one banner at the close of the age.`,
        result.reason === 'moonshot'
          ? 'Among the stars, the Moonshot burns like a second dawn — proof that your age does not end, it lifts.'
          : ledger.rivalsStanding === 0
            ? 'No rival remains. The world is a single story now, and it is yours.'
            : `Only ${ledger.rivalsStanding} ${ledger.rivalsStanding === 1 ? 'rival stands' : 'rivals stand'} outside your borders — and the chronicle is already being written in your favour.`
      ];

  // ---- Act II: the chronicle / final ledger --------------------------------
  if (act === 'chronicle') {
    return (
      <div className={`game-result-overlay ${isVictory ? 'victory' : 'defeat'}`}>
        <GameModal
          show
          onClose={onClose}
          tone={isVictory ? 'gold' : 'solemn'}
          artSize="lg"
          icon={isVictory ? '👑' : '🕯️'}
          artLabel={isVictory ? 'crowned laurel' : 'fallen standard'}
          eyebrow={eyebrow}
          title={isVictory ? 'The Chronicle' : 'The Last Account'}
          lede={
            isVictory
              ? `The reign of ${result.civName}, set down in full — every number the bards will argue over.`
              : `What remains of ${result.civName}, set down before the board is cleared.`
          }
          actions={
            <>
              <button type="button" className="touch-btn touch-btn--danger" onClick={onQuit}>
                Quit
              </button>
              {isVictory && (
                <button type="button" className="touch-btn touch-btn--ghost" onClick={onClose}>
                  Close
                </button>
              )}
              <button type="button" className="touch-btn touch-btn--primary" onClick={onRestart}>
                Restart
              </button>
            </>
          }
        >
          <section className="gm-section">
            <h3 className="gm-section-title">The final score</h3>
            <div className="gm-stat-grid">
              <div className="gm-stat gm-stat--accent">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    {isVictory ? '👑' : '🕯️'}
                  </span>
                  {ledger.score.toLocaleString()}
                </span>
                <span className="gm-stat-label">Score</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🗓
                  </span>
                  {currentTurn}
                </span>
                <span className="gm-stat-label">Turn reached</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    📜
                  </span>
                  {yearLabel}
                </span>
                <span className="gm-stat-label">The year</span>
              </div>
            </div>
          </section>

          <section className="gm-section">
            <h3 className="gm-section-title">The empire at the close</h3>
            <div className="gm-stat-grid">
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🏙
                  </span>
                  {ledger.cities}
                </span>
                <span className="gm-stat-label">Cities held</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    👥
                  </span>
                  {ledger.population.toLocaleString()}
                </span>
                <span className="gm-stat-label">Citizens</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    ⚔️
                  </span>
                  {fieldUnits}
                </span>
                <span className="gm-stat-label">Units in field</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    📖
                  </span>
                  {ledger.techs} / 54
                </span>
                <span className="gm-stat-label">Arts mastered</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🏛
                  </span>
                  {ledger.wonders}
                </span>
                <span className="gm-stat-label">Wonders raised</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🌍
                  </span>
                  {ledger.rivalsStanding}
                </span>
                <span className="gm-stat-label">Rivals standing</span>
              </div>
            </div>
          </section>

          {isVictory && result.reason === 'moonshot' && human && (
            <div className="gm-callout">
              <span className="gm-callout-title">Across your lands</span>
              The Moonshot project has ignited celebrations in every city you own.
            </div>
          )}

          <p className="gm-note">
            {isVictory ? (
              human ? (
                <>
                  <strong>The chronicle is yours.</strong> Study the board, or begin a new age — no
                  two worlds are ever drawn the same way.
                </>
              ) : (
                <>
                  <strong>The record is closed.</strong> Begin a new age and see whether your people
                  can claim the next one.
                </>
              )
            ) : (
              <>
                <strong>Even the greatest empires end.</strong> Begin again: a new map, new rivals
                and new chances await your people.
              </>
            )}
          </p>
        </GameModal>
      </div>
    );
  }

  // ---- Act I: cinematic takeover ------------------------------------------
  return (
    <div className={`game-result-overlay ${isVictory ? 'victory' : 'defeat'}`}>
      <div
        className="gr-cine"
        data-outcome={isVictory ? 'victory' : 'defeat'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="gr-cine__sky" aria-hidden="true" />
        <div className="gr-cine__rays" aria-hidden="true" />
        <div className="gr-cine__embers" aria-hidden="true" />
        <div className="gr-cine__veil" aria-hidden="true" />

        <div className="gr-cine__stage">
          <p className="gr-cine__kicker">
            {isVictory ? 'The chronicle of' : 'Here fell'}
          </p>
          <h1 className="gr-cine__word" data-tone={isVictory ? 'gold' : 'solemn'}>
            {isVictory ? 'VICTORY' : 'DEFEAT'}
          </h1>
          <p className="gr-cine__civ">{result.civName}</p>
          <span className="gr-cine__rule" aria-hidden="true" />
          <p className="gr-cine__lede">{lede}</p>

          <ul className="gr-cine__verses">
            {verses.map((line, index) => (
              <li
                key={index}
                className="gr-cine__verse"
                style={{ animationDelay: `${0.9 + index * 0.45}s` }}
              >
                {line}
              </li>
            ))}
          </ul>

          <div className="gr-cine__cta-row" style={{ animationDelay: `${0.9 + verses.length * 0.45 + 0.35}s` }}>
            <button
              type="button"
              className="gr-cine__cta"
              onClick={() => setAct('chronicle')}
              autoFocus
            >
              {isVictory ? 'Unfold the Chronicle' : 'Read the Last Account'}
              <span className="gr-cine__cta-arrow" aria-hidden="true">
                →
              </span>
            </button>
          </div>

          <div className="gr-cine__minor" style={{ animationDelay: `${0.9 + verses.length * 0.45 + 0.55}s` }}>
            <button type="button" className="gr-cine__minor-btn" onClick={onRestart}>
              Restart
            </button>
            <span className="gr-cine__minor-sep" aria-hidden="true">
              ·
            </span>
            <button type="button" className="gr-cine__minor-btn" onClick={onQuit}>
              Quit
            </button>
          </div>

          {/* "Don't show this again" — the same fact as the Settings switch,
              written from the screen it applies to so the player never has to
              remember where the option lives. */}
          <label
            className="gr-cine__skip"
            style={{ animationDelay: `${0.9 + verses.length * 0.45 + 0.75}s` }}
          >
            <input
              type="checkbox"
              className="gr-cine__skip-box"
              checked={dontShowAgain}
              onChange={(e) => {
                const next = e.target.checked;
                setDontShowAgain(next);
                actions.updateSettings({ skipGameResultScreen: next });
              }}
            />
            <span>Don't show this screen again — next time, straight to a new game</span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default GameResultOverlay;
