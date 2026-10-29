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
 * The backdrop both acts share: sky, slow rays, drifting embers, vignette.
 *
 * It lives as its own component because Act II used to render no backdrop at
 * all — the ledger opened on a flat modal over a dimmed map, and the finale
 * that had just played on this sky dropped to a settings dialog. Both acts now
 * stand on the same sky, so the chronicle reads as the next beat of the
 * cinematic rather than as something that interrupts it.
 *
 * `outcome` only tints it: gold light for a victory, cold ash for a defeat.
 */
const ResultBackdrop: React.FC<{ outcome: 'victory' | 'defeat' }> = ({ outcome }) => (
  <div className="gr-backdrop" data-outcome={outcome} aria-hidden="true">
    <div className="gr-cine__sky" />
    <div className="gr-cine__stars" />
    <div className="gr-cine__rays" />
    <div className="gr-cine__embers" />
    <div className="gr-cine__veil" />
  </div>
);

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
 * (score, population, techs, wonders …) and the Restart / Quit actions, on the
 * same backdrop as Act I.
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

  // Select the raw arrays (stable store references) — filtering inside the
  // selector would return a new array every snapshot and loop forever.
  const allCities = useGameStore((state) => state.cities);
  const allUnits = useGameStore((state) => state.units);
  const civilizations = useGameStore((state) => state.civilizations);

  // A fixed-alliance result carries a team id and names every member of the
  // team. A hotseat joint victory also names several civs but is NOT a team
  // result — it keeps the ordinary free-for-all ledger (the first civ's) so
  // non-team games render exactly as they always have.
  const isTeamResult = !!result && result.teamId !== undefined;
  // For a team result the ledger is the team's: cities, population, wonders,
  // technologies and score are summed (technologies de-duplicated) so a team
  // victory reads as one empire. Everything else stays one civilization.
  const resultCivIds = useMemo(
    () => (isTeamResult && result?.civilizationIds?.length ? result.civilizationIds : [civId]),
    [isTeamResult, result?.civilizationIds, civId]
  );

  const ledger = useMemo(() => {
    const idSet = new Set(resultCivIds);
    const myCities = allCities.filter((city) => idSet.has(city.civilizationId));
    const members = civilizations.filter((civ) => idSet.has(civ.id));
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
      (civ) => civ.isAlive !== false && !idSet.has(civ.id)
    ).length;
    const lastRival =
      civilizations.find((civ) => civ.isAlive !== false && !idSet.has(civ.id))?.name ?? null;
    const techs = new Set(
      members.flatMap((civ) => (Array.isArray(civ.technologies) ? civ.technologies : []))
    ).size;
    const memberRows = members.map((civ) => {
      const civCities = myCities.filter((city) => city.civilizationId === civ.id);
      return {
        id: civ.id,
        name: civ.name,
        color: civ.color,
        score: civ.score ?? 0,
        cities: civCities.length,
        population: civCities.reduce((sum, city) => sum + (city.population || 0), 0),
        isAlive: civ.isAlive !== false
      };
    });

    return {
      score: members.reduce((sum, civ) => sum + (civ.score ?? 0), 0),
      techs,
      population,
      cities: myCities.length,
      wonders,
      capital,
      rivalsStanding,
      lastRival,
      unitsInField: allUnits.filter((unit) => idSet.has(unit.civilizationId)).length,
      memberRows
    };
  }, [allCities, allUnits, civilizations, resultCivIds]);

  if (!result) {
    return null;
  }

  const isVictory = result.outcome === 'victory';
  const human = result.isHuman;
  const yearLabel =
    currentYear !== undefined && currentYear !== null
      ? GameUtils.formatYear(currentYear)
      : t('result.yearPlaceholder' as TranslationKey);

  const teamLabel = result.teamName
    ?? (result.teamId !== undefined ? `Team ${result.teamId + 1}` : result.civName);
  const memberNames = result.civNames?.length
    ? result.civNames
    : ledger.memberRows.map((member) => member.name);
  const memberLine = memberNames.join(' · ');

  const eyebrow = `${isVictory ? t('result.eyebrow.victory' as TranslationKey) : t('result.eyebrow.defeat' as TranslationKey)} · ${isTeamResult ? teamLabel : result.civName}`;

  const title = !isVictory
    ? isTeamResult
      ? t('result.title.teamDefeat' as TranslationKey, { team: teamLabel })
      : t('result.title.defeat' as TranslationKey)
    : isTeamResult
      ? human
        ? t('result.title.teamVictory' as TranslationKey, { team: teamLabel })
        : t('result.title.aiTeamVictory' as TranslationKey, { team: teamLabel })
      : human
        ? t('result.title.humanVictory' as TranslationKey)
        : t('result.title.aiVictory' as TranslationKey, { civ: result.civName });

  const lede = !isVictory
    ? isTeamResult
      ? t('result.lede.teamDefeat' as TranslationKey, { team: teamLabel })
      : t('result.lede.defeat' as TranslationKey)
    : isTeamResult
      ? result.reason === 'moonshot'
        ? t('result.lede.teamMoonshot' as TranslationKey, { team: teamLabel })
        : t('result.lede.teamVictory' as TranslationKey, { team: teamLabel })
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
          : t('result.verse.defeat3' as TranslationKey),
        ...(isTeamResult
          ? [t('result.verse.teamMembers' as TranslationKey, { team: teamLabel, members: memberLine })]
          : [])
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
              }),
        ...(isTeamResult
          ? [t('result.verse.teamMembers' as TranslationKey, { team: teamLabel, members: memberLine })]
          : [])
      ];

  // ---- Act II: the chronicle / final ledger --------------------------------
  if (act === 'chronicle') {
    return (
      <div className={`game-result-overlay ${isVictory ? 'victory' : 'defeat'}`}>
        {/* The same sky Act I played on — the ledger is the next beat of the
            finale, not a dialog that interrupts it. */}
        <ResultBackdrop outcome={isVictory ? 'victory' : 'defeat'} />
        <GameModal
          show
          onClose={onClose}
          tone={isVictory ? 'gold' : 'solemn'}
          size="lg"
          /* `className`, not `dialogClassName`: react-bootstrap puts
             dialogClassName on `.modal-dialog`, which is INSIDE `.modal` and
             therefore stuck at the parent's 1055 — raising it would raise
             nothing. The class has to sit on the portalled element itself.
             The outcome rides along here too: the wrapper that carries
             `.defeat` lives outside the portal, so it cannot style this. */
          className={isVictory ? 'gm-chronicle' : 'gm-chronicle gm-chronicle--defeat'}
          artSize="lg"
          icon={isVictory ? '👑' : '🕯️'}
          artLabel={isVictory ? t('result.art.victory' as TranslationKey) : t('result.art.defeat' as TranslationKey)}
          eyebrow={eyebrow}
          title={isVictory ? t('result.chronicle.title.victory' as TranslationKey) : t('result.chronicle.title.defeat' as TranslationKey)}
          lede={
            isTeamResult
              ? t('result.chronicle.lede.team' as TranslationKey, { team: teamLabel })
              : isVictory
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
          {isTeamResult && (
            <section className="gm-section">
              <h3 className="gm-section-title">{t('result.team.title' as TranslationKey)}</h3>
              <p className="gm-note result-team__lede">
                {t('result.team.lede' as TranslationKey, {
                  team: teamLabel,
                  members: memberLine
                })}
              </p>
              <div className="result-team__roster">
                {ledger.memberRows.map((member) => (
                  <div key={member.id} className="result-team__member">
                    <span className="result-team__dot" style={{ background: member.color }} />
                    <span className="result-team__name">{member.name}</span>
                    <span className="result-team__stat">
                      {t('result.team.cities' as TranslationKey, { count: member.cities })}
                    </span>
                    <span className="result-team__stat">
                      {t('result.team.population' as TranslationKey, { count: member.population })}
                    </span>
                    <span className="result-team__stat result-team__stat--score">
                      {t('result.team.score' as TranslationKey, { score: Math.round(member.score).toLocaleString() })}
                    </span>
                    {!member.isAlive && (
                      <span className="result-team__out">
                        {t('result.team.fallen' as TranslationKey)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

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
                  {ledger.unitsInField}
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
      {/* The backdrop lives OUTSIDE .gr-cine, not inside it. Keeping it inside
          would force the whole takeover above the confetti — and since the sky
          is opaque, the fireworks would then be painted over by it. Split here,
          the sky can sit under the confetti while the words sit over it, which
          is the only order in which the celebration is both visible and
          legible. */}
      <ResultBackdrop outcome={isVictory ? 'victory' : 'defeat'} />

      <div
        className="gr-cine"
        data-outcome={isVictory ? 'victory' : 'defeat'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="gr-cine__stage">
          <p className="gr-cine__kicker">
            {isVictory ? t('result.cine.kicker.victory' as TranslationKey) : t('result.cine.kicker.defeat' as TranslationKey)}
          </p>
          <h1 className="gr-cine__word" data-tone={isVictory ? 'gold' : 'solemn'}>
            {isVictory ? t('result.cine.word.victory' as TranslationKey) : t('result.cine.word.defeat' as TranslationKey)}
          </h1>
          <p className="gr-cine__civ">{isTeamResult ? teamLabel : result.civName}</p>
          {isTeamResult && memberLine && (
            <p className="gr-cine__team">{memberLine}</p>
          )}
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
              {/* Left, because the chronicle it opens unrolls from the right. */}
              <span className="gr-cine__cta-arrow" aria-hidden="true">
                ←
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

        </div>
      </div>
    </div>
  );
};

export default GameResultOverlay;
