import React, { useEffect, useMemo, useState } from 'react';
import GameModal from '@/components/ui/gamemodals/ModalShell';
import { useGameStore } from '@/stores/GameStore';
import { GameUtils } from '@/utils/GameUtils';
import { WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { useTranslation } from '@/i18n/useTranslation';
// The `result.*` keys ship as fragments (.i18n-frags/result.*.txt) and are
// merged into the dictionaries separately — the key casts below are type-only
// (no runtime effect) until that merge lands.
import type { TranslationKey } from '@/i18n';
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
  const { t } = useTranslation();

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
    currentYear !== undefined && currentYear !== null
      ? GameUtils.formatYear(currentYear)
      : t('result.yearPlaceholder' as TranslationKey);

  const eyebrow = `${isVictory ? t('result.eyebrow.victory' as TranslationKey) : t('result.eyebrow.defeat' as TranslationKey)} · ${result.civName}`;

  const title = !isVictory
    ? t('result.title.defeat' as TranslationKey)
    : human
      ? t('result.title.humanVictory' as TranslationKey)
      : t('result.title.aiVictory' as TranslationKey, { civ: result.civName });

  const lede = !isVictory
    ? t('result.lede.defeat' as TranslationKey)
    : !human
      ? t('result.lede.aiVictory' as TranslationKey, { civ: result.civName })
      : result.reason === 'moonshot'
        ? t('result.lede.moonshot' as TranslationKey)
        : result.reason === 'domination'
          ? t('result.lede.domination' as TranslationKey)
          : t('result.lede.victory' as TranslationKey);

  // ---- Act I: cinematic verses -------------------------------------------
  // A few narrative lines, not a stat sheet — the ledger waits in Act II.
  const verses: string[] = !isVictory
    ? [
        t('result.verse.defeat1' as TranslationKey, { year: yearLabel, turn: currentTurn }),
        ledger.capital
          ? t('result.verse.defeat2Capital' as TranslationKey, { capital: ledger.capital })
          : t('result.verse.defeat2' as TranslationKey),
        ledger.lastRival
          ? t('result.verse.defeat3Rival' as TranslationKey, { rival: ledger.lastRival })
          : t('result.verse.defeat3' as TranslationKey)
      ]
    : [
        t('result.verse.victory1' as TranslationKey, {
          turn: currentTurn,
          turnUnit:
            currentTurn === 1
              ? t('result.unit.turn.singular' as TranslationKey)
              : t('result.unit.turn.plural' as TranslationKey),
          year: yearLabel
        }),
        ledger.capital
          ? t('result.verse.victory2Capital' as TranslationKey, {
              capital: ledger.capital,
              cities: ledger.cities,
              cityUnit:
                ledger.cities === 1
                  ? t('result.unit.city.singular' as TranslationKey)
                  : t('result.unit.city.plural' as TranslationKey),
              population: ledger.population,
              citizenUnit:
                ledger.population === 1
                  ? t('result.unit.citizen.singular' as TranslationKey)
                  : t('result.unit.citizen.plural' as TranslationKey)
            })
          : t('result.verse.victory2' as TranslationKey, {
              cities: ledger.cities,
              cityUnit:
                ledger.cities === 1
                  ? t('result.unit.city.singular' as TranslationKey)
                  : t('result.unit.city.plural' as TranslationKey)
            }),
        result.reason === 'moonshot'
          ? t('result.verse.victory3Moonshot' as TranslationKey)
          : ledger.rivalsStanding === 0
            ? t('result.verse.victory3NoRivals' as TranslationKey)
            : t('result.verse.victory3' as TranslationKey, {
                count: ledger.rivalsStanding,
                rivalUnit:
                  ledger.rivalsStanding === 1
                    ? t('result.unit.rival.singular' as TranslationKey)
                    : t('result.unit.rival.plural' as TranslationKey)
              })
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
          artLabel={isVictory ? t('result.art.victory' as TranslationKey) : t('result.art.defeat' as TranslationKey)}
          eyebrow={eyebrow}
          title={isVictory ? t('result.chronicle.title.victory' as TranslationKey) : t('result.chronicle.title.defeat' as TranslationKey)}
          lede={
            isVictory
              ? t('result.chronicle.lede.victory' as TranslationKey, { civ: result.civName })
              : t('result.chronicle.lede.defeat' as TranslationKey, { civ: result.civName })
          }
          actions={
            <>
              <button type="button" className="touch-btn touch-btn--danger" onClick={onQuit}>
                {t('result.actions.quit' as TranslationKey)}
              </button>
              {isVictory && (
                <button type="button" className="touch-btn touch-btn--ghost" onClick={onClose}>
                  {t('result.actions.close' as TranslationKey)}
                </button>
              )}
              <button type="button" className="touch-btn touch-btn--primary" onClick={onRestart}>
                {t('result.actions.restart' as TranslationKey)}
              </button>
            </>
          }
        >
          <section className="gm-section">
            <h3 className="gm-section-title">{t('result.score.title' as TranslationKey)}</h3>
            <div className="gm-stat-grid">
              <div className="gm-stat gm-stat--accent">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    {isVictory ? '👑' : '🕯️'}
                  </span>
                  {ledger.score.toLocaleString()}
                </span>
                <span className="gm-stat-label">{t('result.stat.score' as TranslationKey)}</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🗓
                  </span>
                  {currentTurn}
                </span>
                <span className="gm-stat-label">{t('result.stat.turnReached' as TranslationKey)}</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    📜
                  </span>
                  {yearLabel}
                </span>
                <span className="gm-stat-label">{t('result.stat.year' as TranslationKey)}</span>
              </div>
            </div>
          </section>

          <section className="gm-section">
            <h3 className="gm-section-title">{t('result.empire.title' as TranslationKey)}</h3>
            <div className="gm-stat-grid">
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🏙
                  </span>
                  {ledger.cities}
                </span>
                <span className="gm-stat-label">{t('result.stat.cities' as TranslationKey)}</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    👥
                  </span>
                  {ledger.population.toLocaleString()}
                </span>
                <span className="gm-stat-label">{t('result.stat.citizens' as TranslationKey)}</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    ⚔️
                  </span>
                  {fieldUnits}
                </span>
                <span className="gm-stat-label">{t('result.stat.unitsInField' as TranslationKey)}</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    📖
                  </span>
                  {ledger.techs} / 54
                </span>
                <span className="gm-stat-label">{t('result.stat.artsMastered' as TranslationKey)}</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🏛
                  </span>
                  {ledger.wonders}
                </span>
                <span className="gm-stat-label">{t('result.stat.wondersRaised' as TranslationKey)}</span>
              </div>
              <div className="gm-stat">
                <span className="gm-stat-value">
                  <span className="gm-stat-icon" aria-hidden="true">
                    🌍
                  </span>
                  {ledger.rivalsStanding}
                </span>
                <span className="gm-stat-label">{t('result.stat.rivalsStanding' as TranslationKey)}</span>
              </div>
            </div>
          </section>

          {isVictory && result.reason === 'moonshot' && human && (
            <div className="gm-callout">
              <span className="gm-callout-title">{t('result.callout.title' as TranslationKey)}</span>
              {t('result.callout.moonshot' as TranslationKey)}
            </div>
          )}

          <p className="gm-note">
            {isVictory ? (
              human ? (
                <>
                  <strong>{t('result.note.victoryLead' as TranslationKey)}</strong>{' '}
                  {t('result.note.victoryBody' as TranslationKey)}
                </>
              ) : (
                <>
                  <strong>{t('result.note.aiVictoryLead' as TranslationKey)}</strong>{' '}
                  {t('result.note.aiVictoryBody' as TranslationKey)}
                </>
              )
            ) : (
              <>
                <strong>{t('result.note.defeatLead' as TranslationKey)}</strong>{' '}
                {t('result.note.defeatBody' as TranslationKey)}
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
            {isVictory ? t('result.cine.kicker.victory' as TranslationKey) : t('result.cine.kicker.defeat' as TranslationKey)}
          </p>
          <h1 className="gr-cine__word" data-tone={isVictory ? 'gold' : 'solemn'}>
            {isVictory ? t('result.cine.word.victory' as TranslationKey) : t('result.cine.word.defeat' as TranslationKey)}
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
              {isVictory ? t('result.cine.cta.victory' as TranslationKey) : t('result.cine.cta.defeat' as TranslationKey)}
              <span className="gr-cine__cta-arrow" aria-hidden="true">
                →
              </span>
            </button>
          </div>

          <div className="gr-cine__minor" style={{ animationDelay: `${0.9 + verses.length * 0.45 + 0.55}s` }}>
            <button type="button" className="gr-cine__minor-btn" onClick={onRestart}>
              {t('result.actions.restart' as TranslationKey)}
            </button>
            <span className="gr-cine__minor-sep" aria-hidden="true">
              ·
            </span>
            <button type="button" className="gr-cine__minor-btn" onClick={onQuit}>
              {t('result.actions.quit' as TranslationKey)}
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
            <span>{t('result.skipAgain' as TranslationKey)}</span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default GameResultOverlay;
