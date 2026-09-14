import React, { useMemo, useState } from 'react';
import { Modal, Tab, Table, Tabs } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import {
  computeDemographics,
  ordinal,
  realPopulation,
  numberValue,
  type DemographicRow,
} from '@/game/engine/DemographicsManager';

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

  return (
    <Modal show={show} onHide={onHide} centered size="xl" contentClassName="bg-dark text-white">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title>Statistics and Reports</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-3 text-white">
          Turn {gameState.currentTurn ?? 1} ·{' '}
          {gameState.currentYear != null
            ? gameState.currentYear < 0
              ? `${Math.abs(gameState.currentYear)} BC`
              : `${gameState.currentYear} AD`
            : '—'}
        </div>

        <Tabs activeKey={activeTab} onSelect={k => k && setActiveTab(k)} className="mb-3" variant="tabs">
          {/* ── World Demographics ──────────────────────────────────────── */}
          <Tab eventKey="demographics" title="World Demographics">
            {currentPlayer && playerRows ? (
              <>
                <div className="table-responsive">
                  <Table variant="dark" size="sm" className="mb-0 align-middle">
                    <thead>
                      <tr>
                        <th style={{ width: '30%' }} />
                        <th className="text-end" style={{ width: '25%' }}>Value</th>
                        <th className="text-end" style={{ width: '15%' }}>Rank</th>
                        <th className="text-end" style={{ width: '30%' }}>
                          Ranking
                          <span className="ms-1 text-white-50" style={{ fontSize: '0.75em' }}>
                          </span>
                        </th>
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
                              {row.unit && <span className="text-white-50 ms-1" style={{ fontSize: '0.8em' }}>{row.unit}</span>}
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
                <div className="mt-3 text-white-50" style={{ fontSize: '0.75em' }}>
                  Rankings compare all active civilizations. Population uses the Civ1 triangular formula
                  (Size × (Size+1)/2 × 10,000). GNP = taxes + luxuries before upkeep.
                  <br />
                  <em>Embassy Bonus</em>: Establishing an embassy with a rival reveals their exact stat
                  next to your rank. (Embassy system not yet implemented.)
                </div>
              </>
            ) : (
              <div className="text-light-emphasis py-4">No demographics available.</div>
            )}
          </Tab>

          {/* ── World (devMode only) ──────────────────────────────────── */}
          {devMode && (
            <Tab eventKey="world" title="World">
              <div className="table-responsive">
                <Table striped bordered hover variant="dark" size="sm" className="mb-0 align-middle">
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
              {worldStats.length === 0 && <div className="text-light-emphasis py-4">No world statistics available.</div>}
            </Tab>
          )}
        </Tabs>
      </Modal.Body>
    </Modal>
  );
};

export default StatisticsModal;
