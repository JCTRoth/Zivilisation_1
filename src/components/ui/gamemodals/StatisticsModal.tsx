import React, { useMemo, useState } from 'react';
import { Badge, Button, Modal, Tab, Table, Tabs } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import type { Civilization, Unit } from '../../../../types/game';

interface StatisticsModalProps {
  show: boolean;
  onHide: () => void;
}

const NON_COMBAT_UNIT_TYPES = new Set([
  'settler',
  'worker',
  'scout',
  'diplomat',
  'spy',
  'caravan',
  'freight',
]);

const numberValue = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
);

const technologyCount = (civilization: Civilization): number => (
  Array.isArray(civilization.technologies) ? civilization.technologies.length : 0
);

const populationFor = (civilizationId: number, cities: Array<{ civilizationId: number; population: number }>): number => (
  cities
    .filter(city => city.civilizationId === civilizationId)
    .reduce((total, city) => total + numberValue(city.population), 0)
);

const unitsFor = (civilizationId: number, units: Unit[]): Unit[] => (
  units.filter(unit => unit.civilizationId === civilizationId)
);

const militaryStrengthFor = (units: Unit[]): number => (
  units
    .filter(unit => !NON_COMBAT_UNIT_TYPES.has(unit.type.toLowerCase()))
    .reduce((total, unit) => {
      const attack = numberValue(unit.attack);
      const defense = numberValue(unit.defense);
      // Keep this deliberately compact: it is a comparison indicator, not a
      // replacement for the combat system's battle calculation.
      return total + Math.max(1, attack + defense * 0.5);
    }, 0)
);

const formatNumber = (value: number): string => (
  Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
);

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="col-12 col-sm-6 col-lg-4 mb-3">
    <div className="rounded p-3 h-100">
      <div className="small text-white">{label}</div>
      <div className="h4 mb-0 text-white">{value}</div>
    </div>
  </div>
);

const StatisticsModal: React.FC<StatisticsModalProps> = ({ show, onHide }) => {
  const [activeTab, setActiveTab] = useState('player');
  const civilizations = useGameStore(state => state.civilizations);
  const cities = useGameStore(state => state.cities);
  const units = useGameStore(state => state.units);
  const gameState = useGameStore(state => state.gameState);
  const gameStats = useGameStore(state => state.gameStats);
  const technologies = useGameStore(state => state.technologies);

  const currentPlayer = civilizations[gameState.activePlayer] ?? civilizations.find(civ => civ.isHuman) ?? civilizations[0] ?? null;

  const worldStats = useMemo(() => civilizations.map(civilization => {
    const civCities = cities.filter(city => city.civilizationId === civilization.id);
    const civUnits = unitsFor(civilization.id, units);
    const population = populationFor(civilization.id, cities);
    const militaryStrength = militaryStrengthFor(civUnits);
    const derivedScore = civCities.length * 10 + population * 2 + technologyCount(civilization) * 4 + militaryStrength;

    return {
      civilization,
      cityCount: civCities.length,
      population,
      unitCount: civUnits.length,
      militaryStrength,
      technologyCount: technologyCount(civilization),
      score: numberValue(civilization.score) || derivedScore,
    };
  }).sort((a, b) => b.score - a.score), [civilizations, cities, units]);

  const currentPlayerUnits = currentPlayer ? unitsFor(currentPlayer.id, units) : [];
  const currentPlayerCities = currentPlayer
    ? cities.filter(city => city.civilizationId === currentPlayer.id)
    : [];
  const currentPlayerPopulation = currentPlayerCities.reduce((total, city) => total + numberValue(city.population), 0);
  const currentPlayerWorldStats = worldStats.find(stats => stats.civilization.id === currentPlayer?.id);

  return (
    <Modal show={show} onHide={onHide} centered size="xl" contentClassName="bg-dark text-white">
      <Modal.Header closeButton closeVariant="white">
        <Modal.Title>Statistics</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div className="text-light-emphasis">
            Turn {gameStats.turn} · {gameState.currentYear != null ? `${gameState.currentYear < 0 ? `${Math.abs(gameState.currentYear)} BC` : `${gameState.currentYear} AD`}` : '—'}
          </div>
          <Button variant="outline-light" size="sm" onClick={onHide}>Close</Button>
        </div>

        <Tabs
          activeKey={activeTab}
          onSelect={key => key && setActiveTab(key)}
          className="mb-3"
          variant="tabs"
        >
          <Tab eventKey="player" title="Player Statistics">
            {currentPlayer ? (
              <>
                <div className="d-flex align-items-center gap-2 mb-3">
                  <span className="h5 mb-0">{currentPlayer.name}</span>
                  {currentPlayer.isAlive === false && <Badge bg="danger">Eliminated</Badge>}
                </div>
                <div className="row">
                  <Stat label="Score" value={formatNumber(currentPlayerWorldStats?.score ?? numberValue(currentPlayer.score))} />
                  <Stat label="Cities" value={formatNumber(currentPlayerCities.length)} />
                  <Stat label="Population" value={formatNumber(currentPlayerPopulation)} />
                  <Stat label="Units" value={formatNumber(currentPlayerUnits.length)} />
                  <Stat label="Military strength" value={formatNumber(militaryStrengthFor(currentPlayerUnits))} />
                  <Stat label="Technologies" value={`${technologyCount(currentPlayer)} / ${technologies.length}`} />
                  <Stat label="Treasury" value={formatNumber(numberValue(currentPlayer.resources?.gold))} />
                  <Stat label="Science / turn" value={formatNumber(numberValue(currentPlayer.resources?.science))} />
                  <Stat label="Trade / turn" value={formatNumber(numberValue(currentPlayer.resources?.trade))} />
                </div>
              </>
            ) : (
              <div className="text-light-emphasis py-4">No player statistics are available yet.</div>
            )}
          </Tab>

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
                    <th>Units</th>
                    <th>Military</th>
                    <th>Techs</th>
                  </tr>
                </thead>
                <tbody>
                  {worldStats.map(({ civilization, cityCount, population, unitCount, militaryStrength, technologyCount: researched, score }) => (
                    <tr key={civilization.id}>
                      <td>
                        <span className="me-2" style={{ color: civilization.color }}>●</span>
                        {civilization.name}
                        {civilization.id === currentPlayer?.id && <Badge bg="primary" className="ms-2">You</Badge>}
                      </td>
                      <td>{civilization.isAlive === false ? <Badge bg="danger">Out</Badge> : <Badge bg="success">Alive</Badge>}</td>
                      <td>{formatNumber(score)}</td>
                      <td>{formatNumber(cityCount)}</td>
                      <td>{formatNumber(population)}</td>
                      <td>{formatNumber(unitCount)}</td>
                      <td>{formatNumber(militaryStrength)}</td>
                      <td>{formatNumber(researched)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            {worldStats.length === 0 && <div className="text-light-emphasis py-4">No world statistics are available yet.</div>}
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  );
};

export default StatisticsModal;
