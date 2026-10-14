import React, { useMemo, useState } from 'react';
import { Tab, Table, Tabs } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import {
  computeDemographics,
  ordinal,
  realPopulation,
  numberValue,
  type DemographicRow,
} from '@/game/engine/DemographicsManager';
import { GameUtils } from '@/utils/GameUtils';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import GameModal from './ModalShell';
import type GameEngine from '@/game/engine/GameEngine';
import '../../../styles/statisticsModal.css';

interface StatisticsModalProps {
  show: boolean;
  onHide: () => void;
  /**
   * The live engine, for the per-civ unit ledger (units lost vs disbanded).
   * Those counters are engine state — they survive a save/load — so the screen
   * reads them from there rather than counting from `engine.units`, which by
   * now only holds the survivors.
   */
  gameEngine?: GameEngine | null;
}

const formatVal = (r: DemographicRow): string =>
  r.fmt === 'pct' ? `${r.value}%` : r.fmt === 'float' ? r.value.toFixed(1) : Number.isInteger(r.value) ? r.value.toLocaleString() : r.value.toFixed(1);

const StatisticsModal: React.FC<StatisticsModalProps> = ({ show, onHide, gameEngine }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('demographics');
  const civilizations = useGameStore(s => s.civilizations);
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
  const map = useGameStore(s => s.map);
  const gameState = useGameStore(s => s.gameState);
  const devMode = useGameStore(s => s.settings?.devMode);

  const currentPlayer =
    civilizations[gameState.activePlayer] ??
    civilizations.find(c => c.isHuman) ??
    civilizations[0] ??
    null;

  // ── Demographics via manager ──────────────────────────────────────────
  const { all, ranks, topValues } = useMemo(
    () => computeDemographics(civilizations, cities, map?.revealed ?? []),
    [civilizations, cities, map],
  );

  const playerRows = all.find(d => d.civId === currentPlayer?.id)?.rows;

  // ── Players tab data (devMode only) ─────────────────────────────────
  const playerStats = useMemo(
    () =>
      civilizations.map(c => {
        const pop = realPopulation(c.id, cities);
        const civCities = cities.filter(ci => ci.civilizationId === c.id);
        // Units the store still knows about: everything alive on the board.
        const alive = units.filter(u => u.civilizationId === c.id);
        const field = alive.filter(u => (u.attack ?? 0) > 0);
        const ledger = gameEngine?.getUnitLedger?.(c.id);
        return {
          civ: c,
          cityCount: civCities.length,
          pop,
          score: numberValue(c.score) || civCities.length * 10 + pop * 2,
          units: alive.length,
          // Military only — a settler count would say nothing about strength.
          military: field.length,
          // What the ledger knows and the board no longer does: the units that
          // are gone. `lost` is combat, `disbanded` is a treasury that could
          // not feed them, and the two tell very different stories.
          lost: ledger?.lost ?? 0,
          disbanded: ledger?.disbanded ?? 0,
          techs: Array.isArray(c.technologies) ? c.technologies.length : 0,
          gold: Math.round(numberValue(c.resources?.gold)),
          strength: Math.round(gameEngine?.diplomacyManager?.estimateMilitaryStrength?.(c.id) ?? 0),
        };
      }).sort((a, b) => b.score - a.score),
    [civilizations, cities, units, gameEngine],
  );

  const turnLabel = t('stats.eyebrow' as TranslationKey, {
    turn: gameState.currentTurn ?? 1,
    year: GameUtils.formatYear(gameState.currentYear ?? -4000),
  });

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="info"
      size="xl"
      dialogClassName="statistics-modal"
      icon="📜"
      artLabel={t('stats.artLabel' as TranslationKey)}
      eyebrow={turnLabel}
      title={t('stats.title' as TranslationKey)}
      lede={t('stats.lede' as TranslationKey)}
      actions={
        <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
          {t('stats.close' as TranslationKey)}
        </button>
      }
    >
      <div className="stats-tabs">
        <Tabs activeKey={activeTab} onSelect={k => k && setActiveTab(k)} className="mb-0" variant="tabs">
          {/* ── World Demographics ──────────────────────────────────────── */}
          <Tab eventKey="demographics" title={t('stats.tabDemographics' as TranslationKey)}>
            {currentPlayer && playerRows ? (
              <>
                <div className="gm-section gm-section--flush">
                  <div className="stats-table-head">
                    <span className="gm-chip gm-chip--accent">{currentPlayer.name}</span>
                    <span className="stats-table-head__hint">
                      {t('stats.rankedHint' as TranslationKey)}
                    </span>
                  </div>
                  <div className="table-responsive">
                    <Table variant="dark" size="sm" className="mb-0 align-middle stats-table">
                      <thead>
                        <tr>
                          <th style={{ width: '30%' }} />
                          <th className="text-end" style={{ width: '25%' }}>{t('stats.colValue' as TranslationKey)}</th>
                          <th className="text-end" style={{ width: '15%' }}>{t('stats.colRank' as TranslationKey)}</th>
                          <th className="text-end" style={{ width: '30%' }}>{t('stats.colLeader' as TranslationKey)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {playerRows.map((row, i) => {
                          const rank = ranks[row.metric]?.get(currentPlayer.id) ?? 0;
                          const top = topValues[row.metric];
                          const isTop = top?.civName === currentPlayer.name;
                          return (
                            <tr key={row.metric} className={i % 2 === 0 ? 'table-active' : ''}>
                              <td className="fw-semibold text-white">{row.label}</td>
                              <td className="text-end text-white">
                                {formatVal(row)}
                                {row.unit && !formatVal(row).endsWith(row.unit) && (
                                  <span className="text-white-50 ms-1" style={{ fontSize: '0.8em' }}>{row.unit}</span>
                                )}
                              </td>
                              <td className="text-end">
                                <span className={`fw-bold ${rank === 1 ? 'text-warning' : rank === 2 ? 'text-info' : 'text-white-50'}`}>
                                  {ordinal(rank)}
                                </span>
                              </td>
                              <td className="text-end" style={{ fontSize: '0.85em' }}>
                                {top?.allEqual ? (
                                  <span className="text-white-50">—</span>
                                ) : isTop ? (
                                  <span className="text-warning fw-bold">{t('stats.leading' as TranslationKey)}</span>
                                ) : top ? (
                                  <span className="text-white-50">
                                    <span style={{ color: 'var(--bs-warning)' }}>{ordinal(1)}</span>{' '}
                                    {top.value.toLocaleString()}
                                    {row.unit ? ` ${row.unit}` : ''}
                                  </span>
                                ) : (
                                  <span className="text-white-50">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </div>
                </div>
                <div className="gm-section">
                  <div className="gm-section-title">{t('stats.howCounted' as TranslationKey)}</div>
                  <div className="gm-note">
                    {t('stats.noteIntro' as TranslationKey)}
                    <br />
                    <strong>{t('stats.embassyLabel' as TranslationKey)}</strong>
                    {t('stats.embassyBody' as TranslationKey)}
                  </div>
                </div>
              </>
            ) : (
              <div className="gm-section">
                <div className="gm-prose">{t('stats.empty' as TranslationKey)}</div>
              </div>
            )}
          </Tab>

          {/* NOTE: the Wonders tab used to live here. It now has its own screen
              in the World menu (World → Wonders), so Statistics is only about
              demographics again. */}

          {/* ── Players (devMode only) ─────────────────────────────────── */}
          {devMode && (
            <Tab eventKey="world" title={t('stats.tabWorld' as TranslationKey)}>
              <div className="gm-section gm-section--flush">
                <div className="table-responsive">
                  <Table striped bordered hover variant="dark" size="sm" className="mb-0 align-middle stats-table">
                    <thead>
                      <tr>
                        <th>{t('stats.colPlayer' as TranslationKey)}</th>
                        <th>{t('stats.colStatus' as TranslationKey)}</th>
                        <th>{t('stats.colScore' as TranslationKey)}</th>
                        <th>{t('stats.colCities' as TranslationKey)}</th>
                        <th>{t('stats.colPopulation' as TranslationKey)}</th>
                        <th>{t('stats.colUnits' as TranslationKey)}</th>
                        <th>{t('stats.colMilitary' as TranslationKey)}</th>
                        <th>{t('stats.colLost' as TranslationKey)}</th>
                        <th>{t('stats.colDisbanded' as TranslationKey)}</th>
                        <th>{t('stats.colTechs' as TranslationKey)}</th>
                        <th>{t('stats.colGold' as TranslationKey)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerStats.map((row) => (
                        <tr key={row.civ.id}>
                          <td>
                            <span className="me-2" style={{ color: row.civ.color }}>●</span>
                            {row.civ.name}
                            {row.civ.id === currentPlayer?.id && <span className="badge bg-primary ms-2">{t('stats.badgeYou' as TranslationKey)}</span>}
                          </td>
                          <td>
                            {row.civ.isAlive === false
                              ? <span className="badge bg-danger">{t('stats.badgeOut' as TranslationKey)}</span>
                              : <span className="badge bg-success">{t('stats.badgeAlive' as TranslationKey)}</span>}
                          </td>
                          <td>{Number.isInteger(row.score) ? row.score.toLocaleString() : row.score.toFixed(1)}</td>
                          <td>{row.cityCount.toLocaleString()}</td>
                          <td>{row.pop.toLocaleString()}</td>
                          <td>{row.units.toLocaleString()}</td>
                          <td>{row.military.toLocaleString()}</td>
                          {/* Combat losses — red when they outnumber the army
                              still standing, which is a civ about to fall. */}
                          <td className={row.lost > row.military ? 'stats-cell--warning' : undefined}>
                            {row.lost.toLocaleString()}
                          </td>
                          {/* Disbanded is not a battle: amber, because it
                              means the treasury failed the army. */}
                          <td className={row.disbanded > 0 ? 'stats-cell--cost' : undefined}>
                            {row.disbanded.toLocaleString()}
                          </td>
                          <td>{row.techs}</td>
                          <td>{row.gold.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                {playerStats.length === 0 && (
                  <div className="gm-prose stats-empty">{t('stats.emptyWorld' as TranslationKey)}</div>
                )}
                <div className="gm-note">{t('stats.playersHint' as TranslationKey)}</div>
              </div>
            </Tab>
          )}
        </Tabs>
      </div>
    </GameModal>
  );
};

export default StatisticsModal;
