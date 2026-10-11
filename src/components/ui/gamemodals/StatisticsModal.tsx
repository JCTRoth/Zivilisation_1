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
import GameModal from './ModalShell';
import '../../../styles/statisticsModal.css';

interface StatisticsModalProps {
  show: boolean;
  onHide: () => void;
}

const formatVal = (r: DemographicRow): string =>
  r.fmt === 'pct' ? `${r.value}%` : r.fmt === 'float' ? r.value.toFixed(1) : Number.isInteger(r.value) ? r.value.toLocaleString() : r.value.toFixed(1);

const StatisticsModal: React.FC<StatisticsModalProps> = ({ show, onHide }) => {
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

  const turnLabel = `Turn ${gameState.currentTurn ?? 1} · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`;

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="info"
      size="xl"
      dialogClassName="statistics-modal"
      icon="📜"
      artLabel="world census"
      eyebrow={turnLabel}
      title="Statistics & Reports"
      lede="Your scribes have counted every field, forge and school in your name. Here is how your empire stands against every rival still on the map."
      actions={
        <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
          Close
        </button>
      }
    >
      <div className="stats-tabs">
        <Tabs activeKey={activeTab} onSelect={k => k && setActiveTab(k)} className="mb-0" variant="tabs">
          {/* ── World Demographics ──────────────────────────────────────── */}
          <Tab eventKey="demographics" title="World Demographics">
            {currentPlayer && playerRows ? (
              <>
                <div className="gm-section gm-section--flush">
                  <div className="stats-table-head">
                    <span className="gm-chip gm-chip--accent">{currentPlayer.name}</span>
                    <span className="stats-table-head__hint">
                      Ranked against every living civilization
                    </span>
                  </div>
                  <div className="table-responsive">
                    <Table variant="dark" size="sm" className="mb-0 align-middle stats-table">
                      <thead>
                        <tr>
                          <th style={{ width: '30%' }} />
                          <th className="text-end" style={{ width: '25%' }}>Value</th>
                          <th className="text-end" style={{ width: '15%' }}>Rank</th>
                          <th className="text-end" style={{ width: '30%' }}>Leader</th>
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
                                  <span className="text-warning fw-bold">Leading!</span>
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
                  <div className="gm-section-title">How the scribes count</div>
                  <div className="gm-note">
                    Rankings compare all living civilizations. GNP is taxes plus
                    luxuries before upkeep.
                    <br />
                    <strong>Embassy bonus:</strong> once your envoys are received, a
                    rival's exact figure will appear beside your rank.
                  </div>
                </div>
              </>
            ) : (
              <div className="gm-section">
                <div className="gm-prose">No census available yet — the scribes have nothing to report.</div>
              </div>
            )}
          </Tab>

          {/* NOTE: the Wonders tab used to live here. It now has its own screen
              in the World menu (World → Wonders), so Statistics is only about
              demographics again. */}

          {/* ── World (devMode only) ──────────────────────────────────── */}
          {devMode && (
            <Tab eventKey="world" title="World">
              <div className="gm-section gm-section--flush">
                <div className="table-responsive">
                  <Table striped bordered hover variant="dark" size="sm" className="mb-0 align-middle stats-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Status</th>
                        <th>Score</th>
                        <th>Cities</th>
                        <th>Population</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worldStats.map(({ civ, cityCount, pop, score }) => (
                        <tr key={civ.id}>
                          <td>
                            <span className="me-2" style={{ color: civ.color }}>●</span>
                            {civ.name}
                            {civ.id === currentPlayer?.id && <span className="badge bg-primary ms-2">You</span>}
                          </td>
                          <td>
                            {civ.isAlive === false
                              ? <span className="badge bg-danger">Out</span>
                              : <span className="badge bg-success">Alive</span>}
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
                  <div className="gm-prose stats-empty">No world statistics available.</div>
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
