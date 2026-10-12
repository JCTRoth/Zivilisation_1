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
import '../../../styles/statisticsModal.css';

interface StatisticsModalProps {
  show: boolean;
  onHide: () => void;
}

const formatVal = (r: DemographicRow): string =>
  r.fmt === 'pct' ? `${r.value}%` : r.fmt === 'float' ? r.value.toFixed(1) : Number.isInteger(r.value) ? r.value.toLocaleString() : r.value.toFixed(1);

const StatisticsModal: React.FC<StatisticsModalProps> = ({ show, onHide }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('demographics');
  const civilizations = useGameStore(s => s.civilizations);
  const cities = useGameStore(s => s.cities);
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

  // ── World tab data (devMode only) ─────────────────────────────────────
  const worldStats = useMemo(
    () =>
      civilizations.map(c => {
        const pop = realPopulation(c.id, cities);
        const civCities = cities.filter(ci => ci.civilizationId === c.id);
        return {
          civ: c,
          cityCount: civCities.length,
          pop,
          score: numberValue(c.score) || civCities.length * 10 + pop * 2,
        };
      }).sort((a, b) => b.score - a.score),
    [civilizations, cities],
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

          {/* ── World (devMode only) ──────────────────────────────────── */}
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
                      </tr>
                    </thead>
                    <tbody>
                      {worldStats.map(({ civ, cityCount, pop, score }) => (
                        <tr key={civ.id}>
                          <td>
                            <span className="me-2" style={{ color: civ.color }}>●</span>
                            {civ.name}
                            {civ.id === currentPlayer?.id && <span className="badge bg-primary ms-2">{t('stats.badgeYou' as TranslationKey)}</span>}
                          </td>
                          <td>
                            {civ.isAlive === false
                              ? <span className="badge bg-danger">{t('stats.badgeOut' as TranslationKey)}</span>
                              : <span className="badge bg-success">{t('stats.badgeAlive' as TranslationKey)}</span>}
                          </td>
                          <td>{Number.isInteger(score) ? score.toLocaleString() : score.toFixed(1)}</td>
                          <td>{cityCount.toLocaleString()}</td>
                          <td>{pop.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                {worldStats.length === 0 && (
                  <div className="gm-prose stats-empty">{t('stats.emptyWorld' as TranslationKey)}</div>
                )}
              </div>
            </Tab>
          )}
        </Tabs>
      </div>
    </GameModal>
  );
};

export default StatisticsModal;
