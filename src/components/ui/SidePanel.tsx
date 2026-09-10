import React, { useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { CIVILIZATIONS } from '@/data/GameData';
import { TILE_SIZE } from '@/data/TerrainData';
import { TERRAIN_PROPERTIES } from '@/data/TerrainConstants';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import MiniMap from './MiniMap';
import '../../styles/sidePanel.css';
import type { City, Civilization, SpecialistType } from '../../../types/game';
import GameEngine from '@/game/engine/GameEngine';

// Capitalize the first letter of a string (e.g. 'warrior' -> 'Warrior')
const capitalize = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const SidePanel: React.FC<{ gameEngine?: GameEngine | null }> = ({ gameEngine }) => {
  // ─── Store State ─────────────────────────────────────────────
  const currentPlayer = useGameStore((s) => s.civilizations[s.gameState.activePlayer] || null);
  const civilizations = useGameStore((s) => s.civilizations);
  const units = useGameStore((s) => s.units);
  const cities = useGameStore((s) => s.cities);
  const selectedUnit = useGameStore((s) => s.units.find((u) => u.id === s.gameState.selectedUnit) || null);
  const selectedCityId = useGameStore((s) => s.gameState.selectedCity);
  const uiState = useGameStore((s) => s.uiState);
  const actions = useGameStore((s) => s.actions);
  const selectedHex = useGameStore((s) => s.gameState.selectedHex);
  const map = useGameStore((s) => s.map);
  const settings = useGameStore((s) => s.settings);

  // ─── Derived Data ────────────────────────────────────────────
  const playerUnits = useMemo(
    () => (currentPlayer ? units.filter((u) => u.civilizationId === currentPlayer.id) : []),
    [currentPlayer, units]
  );

  const playerCities = useMemo(
    () => (currentPlayer ? cities.filter((c) => c.civilizationId === currentPlayer.id) : []),
    [currentPlayer, cities]
  );

  const playerResources = useMemo(() => {
    const res = currentPlayer?.resources;
    return {
      food: res?.food ?? 0,
      production: res?.production ?? 0,
      trade: res?.trade ?? 0,
      science: res?.science ?? 0,
      gold: res?.gold ?? 0,
    };
  }, [currentPlayer]);

  const selectedTile = useMemo(() => {
    if (!selectedHex || !map.tiles) return null;
    
    const tileIndex = selectedHex.row * map.width + selectedHex.col;
    const tile = map.tiles[tileIndex];
    if (!tile) return null;
    
    const isVisible = map.visibility?.[tileIndex] ?? false;
    const isExplored = map.revealed?.[tileIndex] ?? false;
    
    const terrainProps = TERRAIN_PROPERTIES as Record<
      string,
      { movement?: number; defense?: number; food?: number; production?: number; trade?: number }
    >;
    const props = terrainProps[tile.type];
    
    return {
      ...tile,
      movementCost: props?.movement ?? 1,
      terrainName: tile.type || 'Unknown',
      visible: isVisible,
      explored: isExplored,
      defenseBonus: props?.defense ?? 1,
      food: props?.food ?? 0,
      production: props?.production ?? 0,
      trade: props?.trade ?? 0
    };
  }, [selectedHex, map]);

  const selectedCity = useMemo(() => cities.find((c) => c.id === selectedCityId), [cities, selectedCityId]);
  
  const effectiveSelectedCity = useMemo(() => {
    if (selectedTile && selectedCity) {
      return selectedTile.col === selectedCity.col && selectedTile.row === selectedCity.row 
        ? selectedCity 
        : null;
    }
    return selectedCity;
  }, [selectedTile, selectedCity]);

  const unitAtSelectedTile = useMemo(() => {
    if (!selectedHex || !units) return null;
    const unit = units.find((u) => u.col === selectedHex.col && u.row === selectedHex.row);
    if (unit && selectedUnit && unit.id === selectedUnit.id) return null;
    return unit || null;
  }, [selectedHex, units, selectedUnit]);

  const displayPlayer = useMemo(() => {
    return currentPlayer || (civilizations && civilizations.length > 0 ? civilizations[0] : {
      id: -1,
      name: 'Name Of Player',
      leader: 'Name of Civilisation',
      color: '#4b8b3b'
    });
  }, [currentPlayer, civilizations]);

  const staticCiv = useMemo(() => CIVILIZATIONS.find((civ) => civ.name === displayPlayer.name), [displayPlayer]);
  const civIcon = staticCiv?.icon ?? '🏛️';
  const isTwoIcon = civIcon ? Array.from(civIcon).length > 1 : false;

  // ─── Handlers ────────────────────────────────────────────────
  const handleAvatarClick = useCallback(() => {
    let capitalCity = (displayPlayer as Civilization | { capital?: City })?.capital;
    
    if (!capitalCity && displayPlayer && 'id' in displayPlayer) {
      capitalCity = cities.find((c) => c.civilizationId === displayPlayer.id);
    }
    
    if (capitalCity) {
      const centerX = capitalCity.col * TILE_SIZE;
      const centerY = capitalCity.row * TILE_SIZE;
      actions.updateCamera({
        x: centerX - (window.innerWidth / 5),
        y: centerY - (window.innerHeight / 4)
      });
    }
  }, [displayPlayer, cities, actions]);

  const handlePromote = useCallback((cityId: string, type: SpecialistType) => {
    if (gameEngine && typeof gameEngine.promoteCitizenToSpecialist === 'function') {
      gameEngine.promoteCitizenToSpecialist(cityId, type);
    }
  }, [gameEngine]);

  const handleDemote = useCallback((cityId: string, index: number) => {
    if (gameEngine && typeof gameEngine.demoteSpecialistToWorker === 'function') {
      gameEngine.demoteSpecialistToWorker(cityId, index);
    }
  }, [gameEngine]);

  // ─── Render Helpers ──────────────────────────────────────────
  const selectionTitle = selectedUnit 
    ? 'Selected Unit' 
    : effectiveSelectedCity 
      ? 'Selected City' 
      : unitAtSelectedTile 
        ? '' 
        : selectedTile 
          ? 'Selected Tile' 
          : 'No Selection';

  const renderSelectionContent = () => {
    if (selectedUnit) {
      return (
        <div>
          <div className="side-panel-small-muted">{capitalize(selectedUnit.type)}</div>
          <div className="side-panel-small-muted unit-stats">
            HP: {selectedUnit.health ?? 100} • Moves: {selectedUnit.movesRemaining ?? 0}
          </div>
          <div className="side-panel-small-muted unit-attack-defense">
            Attack: {selectedUnit?.attack ?? 0} • Defense: {selectedUnit?.defense ?? 0}
          </div>
        </div>
      );
    }
    
    if (effectiveSelectedCity) {
      return (
        <div>
          <div className="city-name">{selectedCity?.name}</div>
          <div className="side-panel-small-muted">Population: {selectedCity?.population ?? 1}</div>
          <div className="side-panel-small-muted city-production">Production: {selectedCity?.yields?.production ?? 0}</div>
        </div>
      );
    }
    
    if (unitAtSelectedTile) {
      return (
        <div>
          <div className="unit-name">{capitalize(unitAtSelectedTile.name || unitAtSelectedTile.type)}</div>
          <div className="side-panel-small-muted">{capitalize(unitAtSelectedTile.type)}</div>
          {unitAtSelectedTile.civilizationId === currentPlayer?.id ? (
            <div className="side-panel-small-muted unit-stats">
              HP: {unitAtSelectedTile.health ?? 100} • Moves: {unitAtSelectedTile.movesRemaining ?? 0}
            </div>
          ) : (
            <div className="side-panel-small-muted unit-attack-defense">
              Attack: {unitAtSelectedTile?.attack ?? 0} • Defense: {unitAtSelectedTile?.defense ?? 0}
            </div>
          )}
        </div>
      );
    }
    
    if (selectedTile) {
      return (
        <div>
          <div className="tile-type">{capitalize(String(selectedTile.terrainName))}</div>
          <div className="side-panel-small-muted">Coordinates: ({selectedTile.col}, {selectedTile.row})</div>
          <div className="side-panel-small-muted">Movement Cost: {selectedTile.movementCost}</div>
          {selectedTile.resource && <div className="side-panel-small-muted">Resource: {selectedTile.resource}</div>}
          {selectedTile.improvement && <div className="side-panel-small-muted">Improvement: {selectedTile.improvement}</div>}
        </div>
      );
    }
    
    return (
      <div className="side-panel-small-muted">
        <div>Units: {playerUnits?.length ?? 0}</div>
        <div>Cities: {playerCities?.length ?? 0}</div>
        <div className="no-selection-summary">
          Food: {playerResources?.food ?? 0} • Production: {playerResources?.production ?? 0}
        </div>
        <div>Trade: {playerResources?.trade ?? 0} • Science: {(gameEngine?.researchManager && currentPlayer?.currentResearch)
          ? gameEngine.researchManager.beakersApplied(currentPlayer, currentPlayer.currentResearch, playerResources?.science ?? 0)
          : playerResources?.science ?? 0}</div>
      </div>
    );
  };

  const renderCitySpecialists = (city: City) => {
    const specs = city.specialists ?? [];
    const workedTiles = city.workingTiles ?? new Set<string>();
    const tileWorkers = workedTiles.size;
    const isPlayerCity = currentPlayer && city.civilizationId === currentPlayer.id;

    if (!isPlayerCity) return null;

    return (
      <div className="mt-2">
        {specs.length > 0 && (
          <div className="mb-2">
            <div className="side-panel-small-muted fw-bold mb-1">Specialists:</div>
            <div className="d-flex flex-wrap gap-1">
              {specs.map((type, i) => {
                const def = SPECIALIST_YIELDS[type];
                return (
                  <span key={i} className="side-panel-specialist-chip" title={`Demote ${def.name} to tile worker`}>
                    {def.icon}
                    <button
                      type="button"
                      className="side-panel-specialist-remove"
                      onClick={() => handleDemote(city.id, i)}
                      title="Convert back to tile worker"
                    >×</button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        
        {tileWorkers > 1 && (
          <div className="side-panel-small-muted fw-bold mb-1">Add specialist:</div>
        )}
        
        <div className="d-flex flex-wrap gap-1">
          {(Object.keys(SPECIALIST_YIELDS) as SpecialistType[]).map((type) => {
            const def = SPECIALIST_YIELDS[type];
            return (
              <button
                key={type}
                type="button"
                className="side-panel-specialist-btn"
                disabled={tileWorkers <= 1}
                title={tileWorkers <= 1 ? 'Need at least one tile worker' : `Convert tile citizen → ${def.name}`}
                onClick={() => handlePromote(city.id, type)}
              >
                {def.icon}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDetailsContent = () => {
    return (
      <>
        {/* Always show terrain information if a tile is selected */}
        {selectedTile && (
          <>
            <div className="terrain-info-section">
              <div className="terrain-title">Terrain Information</div>
              <div className="stats-div">
                <div>Type: {capitalize(String(selectedTile.terrainName))}</div>
                <div>Coordinates: ({selectedTile.col}, {selectedTile.row})</div>
                <div>Movement Cost: {selectedTile.movementCost}</div>
                <div>Defense: {Math.round((selectedTile.defenseBonus - 1) * 100)}%</div>
                {selectedTile.improvement && <div>Improvement: {selectedTile.improvement}</div>}
                {selectedTile.resource && <div>Resource: {selectedTile.resource}</div>}
                <div>Food: {selectedTile.food ?? 0}</div>
                <div>Production: {selectedTile.production ?? 0}</div>
                <div>Trade: {selectedTile.trade ?? 0}</div>
              </div>
            </div>
            <hr className="details-separator" />
          </>
        )}

        {effectiveSelectedCity ? (
          <>
            <div className="unit-name-details"><strong>{effectiveSelectedCity.name}</strong></div>
            <div className="side-panel-small-muted">Location: {effectiveSelectedCity.col}, {effectiveSelectedCity.row}</div>
            <div className="stats-div">
              <div>Population: {effectiveSelectedCity.population ?? 1}</div>
              <div>Food: {effectiveSelectedCity.yields?.food ?? 0}</div>
              <div>Production: {effectiveSelectedCity.yields?.production ?? 0}</div>
              <div>Trade: {effectiveSelectedCity.yields?.trade ?? 0}</div>
              <div>Science: {effectiveSelectedCity.science ?? 0}</div>
              <div>Gold: {effectiveSelectedCity.gold ?? 0}</div>
            </div>
            {renderCitySpecialists(effectiveSelectedCity)}
          </>
        ) : !selectedTile ? (
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
        ) : null}
      </>
    );
  };

  // ─── Main Render ─────────────────────────────────────────────
  return (
    <>
      {/* Minimap */}
      {uiState.showMinimap && (
        <div className="minimap-section">
          <div className="minimap-container">
            <MiniMap gameEngine={gameEngine} />
          </div>
        </div>
      )}

      <div className="side-panel-scroll">
        {/* Citizen reassignment banner */}
        {uiState?.citizenReassign && (
          <div className="citizen-reassign-banner" role="status">
            <span className="citizen-reassign-icon" aria-hidden="true">🧑‍🌾</span>
            <div className="citizen-reassign-text">
              <div className="citizen-reassign-title">1 citizen selected for reassignment</div>
              <div className="citizen-reassign-hint">Left-click a tile to place · Right-click / ESC to cancel</div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="side-panel-header">
          <div className="header-flex">
            <div
              className={`avatar-div ${isTwoIcon ? 'avatar-two-icons' : ''}`}
              style={{ background: displayPlayer.color || '#4b8b3b', cursor: 'pointer' }}
              onClick={handleAvatarClick}
              title="Click to center on capital city"
            >
              <span className="icon-span">{civIcon}</span>
            </div>

            <div className="name-div">
              <div className="player-name">{displayPlayer.name}</div>
              <div className="side-panel-small-muted player-leader">
                {(displayPlayer as { civilizationName?: string })?.civilizationName || displayPlayer.leader || 'Unknown Civilization'}
              </div>
              <div className="gold-div">
                <strong className="gold-strong">{playerResources.gold} 🪙</strong>
                <button
                  type="button"
                  className="rates-shortcut"
                  onClick={() => actions.showDialog('rates')}
                  title="Tax / Science / Luxury rates (T)"
                  aria-label="Open rates"
                >
                  📊
                </button>
              </div>
              <label className="settings-checkbox-label" style={{ marginTop: '8px', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={settings.autoEndTurn}
                  onChange={(e) => actions.updateSettings({ autoEndTurn: e.target.checked })}
                />
                <span className="checkbox-text">Auto. turn ending</span>
              </label>
            </div>
          </div>
        </div>

        {/* Selection */}
        <div className="selection-section">
          <div className="selected-title">{selectionTitle}</div>
          {renderSelectionContent()}
        </div>

        {/* Details */}
        <div className="details-section">
          <div className="details-title">Details</div>
          <div className="details-content">
            {renderDetailsContent()}
          </div>
        </div>
      </div>
    </>
  );
};

export default SidePanel;