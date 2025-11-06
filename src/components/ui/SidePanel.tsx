import React from 'react';
import { Button } from 'react-bootstrap';
import { useGameStore } from '../../stores/gameStore';
import { CIVILIZATIONS } from '../../game/gameData';
import MiniMap from './MiniMap';
import '../../styles/sidePanel.css';

// New side panel matching the provided mockup image
const SidePanel: React.FC<{ gameEngine?: any }> = ({ gameEngine }) => {
  const currentPlayer = useGameStore((s) => s.currentPlayer);
  const civilizations = useGameStore((s) => s.civilizations);
  const playerUnits = useGameStore((s) => s.playerUnits);
  const playerCities = useGameStore((s) => s.playerCities);
  const selectedUnit = useGameStore((s) => s.selectedUnit);
  const selectedCityId: string | null = useGameStore((s) => s.gameState.selectedCity);
  const cities = useGameStore((s) => s.cities);
  const playerResources = useGameStore((s) => s.playerResources);
  const uiState = useGameStore((s) => s.uiState);
  const actions = useGameStore((s) => s.actions);

  const selectedCity = cities.find(c => c.id === selectedCityId);

  // Compute a display player so the panel renders meaningful placeholders
  const displayPlayer = currentPlayer || (civilizations && civilizations.length > 0 ? civilizations[0] : {
    id: -1,
    name: 'Name Of Player',
    leader: 'Name of Civilisation',
    color: '#4b8b3b'
  });

  // Find the static civilization data to get the icon
  const staticCiv = CIVILIZATIONS.find(civ => civ.name === displayPlayer.name);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`mobile-menu-backdrop ${!uiState.sidebarCollapsed ? 'show' : ''} d-md-none`}
        onClick={() => actions.toggleUI('sidebarCollapsed')}
      />


        {uiState.showMinimap && (
          <div className="minimap-container">
            <MiniMap gameEngine={gameEngine} />
          </div>
        )}

      <aside className={`game-side-panel side-panel ${!uiState.sidebarCollapsed ? 'show' : ''}`}>
        <div className="side-panel-header">
          <div className="header-flex">
            <div
              className="avatar-div"
              style={{ background: displayPlayer.color || '#4b8b3b' }}
            >
              <span className="icon-span">{staticCiv?.icon ?? '🏛️'}</span>
            </div>

            <div className="name-div">
              <div className="player-name">{displayPlayer.name}</div>
              <div className="side-panel-small-muted player-leader">{(displayPlayer as any)?.civilizationName || displayPlayer.leader || 'Unknown Civilization'}</div>
              <div className="gold-div">
                <strong className="gold-strong">{(playerResources.gold ?? 0)} €</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Middle: selected unit/building summary */}
        <div className="side-panel-section middle-section">
          <div className="selected-title"> {selectedUnit || selectedCity ? 'Selected' : 'No Selection'}</div>

          {selectedUnit ? (
            <div>
              <div className="unit-name">{selectedUnit.name}</div>
              <div className="side-panel-small-muted">{selectedUnit.type}</div>
              <div className="side-panel-small-muted unit-stats">
                HP: {selectedUnit.health ?? 100} • Moves: {selectedUnit.movesRemaining ?? 0}
              </div>
              <div className="side-panel-small-muted unit-attack-defense">
                Attack: {(selectedUnit as any)?.attack ?? 0} • Defense: {(selectedUnit as any)?.defense ?? 0}
              </div>
            </div>
          ) : selectedCity ? (
            <div>
              <div className="city-name">{selectedCity.name}</div>
              <div className="side-panel-small-muted">Population: {selectedCity.population ?? 1}</div>
              <div className="side-panel-small-muted city-production">Production: {selectedCity.yields?.production ?? 0}</div>
            </div>
          ) : (
            <div className="side-panel-small-muted">
              <div>Units: {playerUnits?.length ?? 0}</div>
              <div>Cities: {playerCities?.length ?? 0}</div>
              <div className="no-selection-summary">
                Food: {playerResources?.food ?? 0} • Production: {playerResources?.production ?? 0}
              </div>
              <div>Trade: {playerResources?.trade ?? 0} • Science: {playerResources?.science ?? 0}</div>
            </div>
          )}
        </div>

        {/* Bottom: Large detail box (big, mostly empty in screenshot) */}
        <div className="side-panel-section bottom-section">
          <div className="details-title">Details</div>

          <div className="details-content">
            {/* Use selected unit/city for details when available, otherwise show player summary */}
            {selectedUnit ? (
              <>
                <div className="unit-name-details"><strong>{selectedUnit.name}</strong> — {selectedUnit.type}</div>
                <div className="side-panel-small-muted">Location: {selectedUnit.col}, {selectedUnit.row}</div>
                <div className="stats-div">
                  <div>Health: {selectedUnit.health ?? 100}/100</div>
                  <div>Moves: {selectedUnit.movesRemaining ?? 0}/{(selectedUnit as any)?.maxMoves ?? 1}</div>
                  <div>Attack: {(selectedUnit as any)?.attack ?? 0}</div>
                  <div>Defense: {(selectedUnit as any)?.defense ?? 0}</div>
                </div>
              </>
            ) : selectedCity ? (
              <>
                <div className="unit-name-details"><strong>{selectedCity.name}</strong></div>
                <div className="side-panel-small-muted">Location: {selectedCity.col}, {selectedCity.row}</div>
                <div className="stats-div">
                  <div>Population: {selectedCity.population ?? 1}</div>
                  <div>Food: {selectedCity.yields?.food ?? 0}</div>
                  <div>Production: {selectedCity.yields?.production ?? 0}</div>
                  <div>Trade: {selectedCity.yields?.trade ?? 0}</div>
                  <div>Science: {selectedCity.science ?? 0}</div>
                  <div>Gold: {selectedCity.gold ?? 0}</div>
                </div>
              </>
            ) : (
              <>
                <div className="player-summary-title">Player Summary</div>
                <div className="side-panel-small-muted">
                  <div>Units: {playerUnits?.length ?? 0}</div>
                  <div>Cities: {playerCities?.length ?? 0}</div>
                  <div className="summary-resources">Resources:</div>
                  <div>Gold: {playerResources?.gold ?? 0}</div>
                  <div>Food: {playerResources?.food ?? 0}</div>
                  <div>Production: {playerResources?.production ?? 0}</div>
                  <div>Trade: {playerResources?.trade ?? 0}</div>
                  <div>Science: {playerResources?.science ?? 0}</div>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default SidePanel;