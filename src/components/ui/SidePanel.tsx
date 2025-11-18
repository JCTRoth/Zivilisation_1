import React from 'react';
import { useGameStore } from '@/stores/GameStore';
import { CIVILIZATIONS } from '@/data/GameData';
import { TERRAIN_TYPES, TILE_SIZE } from '@/data/TerrainData';
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
  const units = useGameStore((s) => s.units);
  const playerResources = useGameStore((s) => s.playerResources);
  const uiState = useGameStore((s) => s.uiState);
  const actions = useGameStore((s) => s.actions);
  const selectedHex = useGameStore((s) => s.gameState.selectedHex);
  const map = useGameStore((s) => s.map);
  const gameState = useGameStore((s) => s.gameState);

  const selectedCity = cities.find(c => c.id === selectedCityId);

  // Get unit at selected tile (if any)
  const getUnitAtSelectedTile = () => {
    if (!selectedHex || !units) return null;
    const unit = units.find(u => u.col === selectedHex.col && u.row === selectedHex.row);
    // Don't show if it's the selected unit (already shown above)
    if (unit && selectedUnit && unit.id === selectedUnit.id) return null;
    return unit || null;
  };

  const unitAtSelectedTile = getUnitAtSelectedTile();

  // Get tile information for selected hex
  const getSelectedTileInfo = () => {
    if (!selectedHex || !map.tiles) return null;
    
    const tileIndex = selectedHex.row * map.width + selectedHex.col;
    const tile = map.tiles[tileIndex];
    
    if (!tile) return null;
    
    const terrainProps = TERRAIN_TYPES[tile.type] || {} as any;
    
    // Check visibility and exploration from the map arrays
    const isVisible = map.visibility?.[tileIndex] ?? false;
    const isExplored = map.revealed?.[tileIndex] ?? false;
    
    return {
      ...tile,
      movementCost: terrainProps.movement ?? 1,
      terrainName: tile.type || 'Unknown',
      visible: isVisible,
      explored: isExplored
    };
  };

  const selectedTile = getSelectedTileInfo();
  
  // Compute a display player so the panel renders meaningful placeholders
  const displayPlayer = currentPlayer || (civilizations && civilizations.length > 0 ? civilizations[0] : {
    id: -1,
    name: 'Name Of Player',
    leader: 'Name of Civilisation',
    color: '#4b8b3b'
  });

  // Find the static civilization data to get the icon
  const staticCiv = CIVILIZATIONS.find(civ => civ.name === displayPlayer.name);
  // Detect multi-codepoint icons (e.g. two emoji characters) and adjust avatar sizing
  const civIcon = staticCiv?.icon ?? '🏛️';
  const isTwoIcon = civIcon ? Array.from(civIcon).length > 1 : false;

  // Handle clicking on the avatar to center camera on capital city
  const handleAvatarClick = () => {
    console.log('[SidePanel] Avatar clicked');
    console.log('[SidePanel] displayPlayer:', displayPlayer);
    console.log('[SidePanel] displayPlayer.capital:', (displayPlayer as any)?.capital);
    
    let capitalCity = (displayPlayer as any)?.capital;
    
    // Fallback: if no capital is set, find the first city of this civilization
    if (!capitalCity && displayPlayer && 'id' in displayPlayer) {
      capitalCity = cities.find(c => c.civilizationId === displayPlayer.id);
      console.log('[SidePanel] Using fallback capital city:', capitalCity);
    }
    
    if (capitalCity) {
      console.log('[SidePanel] Capital city found:', capitalCity);
      
      const centerX = capitalCity.col * TILE_SIZE;
      const centerY = capitalCity.row * TILE_SIZE;
      console.log('[SidePanel] Calculated center position:', { centerX, centerY });
      
      // Center the camera on the capital city
      const cameraUpdate = {
        x: centerX - (window.innerWidth/5), // Center horizontally
        y: centerY - (window.innerHeight/4) // Center vertically
      };
      console.log('[SidePanel] Camera update:', cameraUpdate);
      
      actions.updateCamera(cameraUpdate);
      console.log('[SidePanel] Camera update called');
    } else {
      console.log('[SidePanel] No capital city found for civilization', displayPlayer?.id);
    }
  };

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
              className={`avatar-div ${isTwoIcon ? 'avatar-two-icons' : ''}`}
              style={{ background: displayPlayer.color || '#4b8b3b', cursor: 'pointer' }}
              onClick={handleAvatarClick} // Add click handler here
              title="Click to center on capital city"
            >
              <span className="icon-span">{civIcon}</span>
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
          <div className="selected-title"> 
            {selectedUnit ? 'Selected Unit' : selectedCity ? 'Selected City' : unitAtSelectedTile ? 'Unit on Tile' : selectedTile ? 'Selected Tile' : 'No Selection'}
          </div>

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
          ) : unitAtSelectedTile ? (
            <div>
              <div className="unit-name">{unitAtSelectedTile.name}</div>
              <div className="side-panel-small-muted">{unitAtSelectedTile.type}</div>
              {unitAtSelectedTile.civilizationId === currentPlayer?.id ? (
                <div className="side-panel-small-muted unit-stats">
                  HP: {unitAtSelectedTile.health ?? 100} • Moves: {unitAtSelectedTile.movesRemaining ?? 0}
                </div>
              ) : (
                <div className="side-panel-small-muted unit-attack-defense">
                  Attack: {(unitAtSelectedTile as any)?.attack ?? 0} • Defense: {(unitAtSelectedTile as any)?.defense ?? 0}
                </div>
              )}
            </div>
          ) : selectedTile ? (
            <div>
              <div className="tile-type">{selectedTile.terrainName}</div>
              <div className="side-panel-small-muted">Coordinates: ({selectedTile.col}, {selectedTile.row})</div>
              <div className="side-panel-small-muted">Movement Cost: {selectedTile.movementCost}</div>
              {selectedTile.resource && (
                <div className="side-panel-small-muted">Resource: {selectedTile.resource}</div>
              )}
              {selectedTile.improvement && (
                <div className="side-panel-small-muted">Improvement: {selectedTile.improvement}</div>
              )}
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
            {/* Always show terrain information if a tile is selected */}
            {selectedTile && (
              <>
                <div className="terrain-info-section">
                  <div className="terrain-title">Terrain Information</div>
                  <div className="stats-div">
                    <div>Type: {selectedTile.terrainName}</div>
                    <div>Coordinates: ({selectedTile.col}, {selectedTile.row})</div>
                    <div>Movement Cost: {selectedTile.movementCost}</div>
                    {selectedTile.resource && <div>Resource: {selectedTile.resource}</div>}
                    {selectedTile.improvement && <div>Improvement: {selectedTile.improvement}</div>}
                    <div>Visible: {selectedTile.visible ? 'Yes' : 'No'}</div>
                    <div>Explored: {selectedTile.explored ? 'Yes' : 'No'}</div>
                  </div>
                </div>
                <hr className="details-separator" />
              </>
            )}

            {/* Show selected item details */}
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
            ) : unitAtSelectedTile ? (
              <>
                <div className="unit-name-details"><strong>{unitAtSelectedTile.name}</strong> — {unitAtSelectedTile.type}</div>
                <div className="side-panel-small-muted">Location: {unitAtSelectedTile.col}, {unitAtSelectedTile.row}</div>
                <div className="stats-div">
                  {unitAtSelectedTile.civilizationId === currentPlayer?.id ? (
                    <>
                      <div>Health: {unitAtSelectedTile.health ?? 100}/100</div>
                      <div>Moves: {unitAtSelectedTile.movesRemaining ?? 0}/{(unitAtSelectedTile as any)?.maxMoves ?? 1}</div>
                    </>
                  ) : null}
                  <div>Attack: {(unitAtSelectedTile as any)?.attack ?? 0}</div>
                  <div>Defense: {(unitAtSelectedTile as any)?.defense ?? 0}</div>
                </div>
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
          </div>
        </div>
      </aside>
    </>
  );
};

export default SidePanel;