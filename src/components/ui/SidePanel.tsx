import React, { useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { CIVILIZATIONS } from '@/data/GameData';
import { TILE_SIZE } from '@/data/TerrainData';
import { getResourceYields, TERRAIN_PROPERTIES } from '@/data/TerrainConstants';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import { governorOption, terrainLabel } from '@/utils/CityGovernorUtils';
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
    
    // Base terrain yields
    let food = props?.food ?? 0;
    let production = props?.production ?? 0;
    let trade = props?.trade ?? 0;

    // Add resource bonuses (e.g. Horses +2 production on Plains)
    const resourceYields = getResourceYields(tile.resource, tile.type);
    food += resourceYields.food;
    production += resourceYields.production;
    trade += resourceYields.trade;

    return {
      ...tile,
      movementCost: props?.movement ?? 1,
      terrainName: tile.type || 'Unknown',
      visible: isVisible,
      explored: isExplored,
      defenseBonus: props?.defense ?? 1,
      food,
      production,
      trade,
      baseFood: props?.food ?? 0,
      baseProduction: props?.production ?? 0,
      baseTrade: props?.trade ?? 0,
      resourceBonus: resourceYields,
    };
  }, [selectedHex, map]);

  const selectedCity = useMemo(() => cities.find((c) => c.id === selectedCityId), [cities, selectedCityId]);
  
  /**
   * Which city the panel is currently "about". The citizen block (specialists,
   * worked tiles, city readout) belongs to the SELECTED CITY and stays visible
   * for as long as it is selected — the selected hex must not hide it (picking
   * a citizen up puts the hex on a worked tile, and clicking a radius tile to
   * read its yield must not empty the panel). A selected unit, or a click on
   * empty ground (which clears the city selection), does hide it.
   */
  const panelCity = useMemo(() => {
    if (selectedUnit) return null;
    return selectedCity ?? null;
  }, [selectedUnit, selectedCity]);

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
    : panelCity 
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
            {selectedUnit?.isFortified ? ' • 🛡️ Fortified (+50% def)' : ''}
          </div>
        </div>
      );
    }
    
    if (panelCity) {
      // The citizen block leads the panel: with a city selected you always want
      // to see (and set) who works what, before any numbers.
      return (
        <div>
          {renderCitySpecialists(panelCity)}
          {renderWorkedTiles(panelCity)}
          <div className="side-panel-section-divider" />
          <div className="city-name"><strong>{panelCity.name}</strong></div>
          <div className="side-panel-small-muted">Location: {panelCity.col}, {panelCity.row}</div>
          <div className="stats-div">
            <div>Population: {panelCity.population ?? 1}</div>
            <div>Food: {panelCity.yields?.food ?? 0}</div>
            <div>Production: {panelCity.yields?.production ?? 0}</div>
            <div>Trade: {panelCity.yields?.trade ?? 0}</div>
            <div>Science: {panelCity.science ?? 0}</div>
            <div>Gold: {panelCity.gold ?? 0}</div>
          </div>
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
          ? gameEngine.researchManager.perTurnProgress(currentPlayer, currentPlayer.currentResearch, playerResources?.science ?? 0)
          : playerResources?.science ?? 0}</div>
      </div>
    );
  };

  /**
   * Specialist assignment lives HERE, not in the city screen: one toggle per
   * specialist. Clicking assigns a citizen (taken off the worst field), clicking
   * an active one puts that citizen back on the tiles. The Entertainer is the
   * default — it is listed first and drawn as the primary toggle.
   */
  const renderCitySpecialists = (city: City) => {
    const specs = city.specialists ?? [];
    const workedTiles = city.workingTiles ?? new Set<string>();
    const pop = city.population ?? 1;
    const isPlayerCity = currentPlayer && city.civilizationId === currentPlayer.id;
    if (!isPlayerCity) return null;

    // A specialist needs a free hand: the city centre is free, so a city needs
    // at least one more worked tile to give one up.
    const canAdd = workedTiles.size > 1 && specs.length < pop;
    const countOf = (type: SpecialistType) => specs.filter((s) => s === type).length;
    const describe = (type: SpecialistType) => {
      const def = SPECIALIST_YIELDS[type];
      const parts: string[] = [];
      if (def.luxury) parts.push(`+${def.luxury} Luxury`);
      if (def.gold) parts.push(`+${def.gold} Gold`);
      if (def.science) parts.push(`+${def.science} Science`);
      const gains = parts.length ? parts.join(', ') : 'no yield';
      const isDefault = type === 'entertainer';
      return isDefault
        ? `${def.name} (default) — ${gains}. Off a field, so the city loses that tile's food/shields/trade. Click to ${countOf(type) ? 'send back to the tiles' : 'assign a citizen'}.`
        : `${def.name} — ${gains}. Off a field, so the city loses that tile's food/shields/trade. Click to ${countOf(type) ? 'send back to the tiles' : 'assign a citizen'}.`;
    };

    const order: SpecialistType[] = ['entertainer', 'taxman', 'scientist'];

    return (
      <div className="mt-2">
        <div className="side-panel-small-muted fw-bold mb-1">
          Specialists <span className="fw-normal">({specs.length}/{pop})</span>
        </div>
        <div className="d-flex flex-wrap gap-1">
          {order.map((type) => {
            const def = SPECIALIST_YIELDS[type];
            const count = countOf(type);
            const active = count > 0;
            const isDefault = type === 'entertainer';
            return (
              <button
                key={type}
                type="button"
                className={`side-panel-specialist-toggle${active ? ' active' : ''}${isDefault ? ' primary' : ''}`}
                disabled={!active && !canAdd}
                aria-pressed={active}
                title={describe(type)}
                onClick={() => {
                  if (active) {
                    const last = specs.lastIndexOf(type);
                    if (last >= 0) handleDemote(city.id, last);
                  } else {
                    handlePromote(city.id, type);
                  }
                }}
              >
                <span className="side-panel-specialist-toggle-icon">{def.icon}</span>
                <span className="side-panel-specialist-toggle-name">{def.name}</span>
                {count > 0 && <span className="side-panel-specialist-toggle-count">{count}</span>}
                {isDefault && !active && <span className="side-panel-specialist-toggle-default">default</span>}
              </button>
            );
          })}
        </div>
        {!canAdd && specs.length === 0 && (
          <div className="side-panel-small-muted mt-1">Every citizen is already on a tile or a specialist.</div>
        )}
      </div>
    );
  };

  const renderWorkedTiles = (city: City) => {
    const workedTiles = city.workingTiles;
    if (!workedTiles || workedTiles.size === 0) return null;
    // Tiles the player placed by hand — drawn darker with a light-green edge so
    // a manual allocation reads differently from a governor decision.
    const manualTiles = city.userAssignedTiles instanceof Set ? city.userAssignedTiles : new Set<string>();

    const terrainProps = TERRAIN_PROPERTIES as Record<string, { food?: number; production?: number; trade?: number }>;
    const tiles: Array<{ key: string; col: number; row: number; terrain: string; resource?: string; food: number; production: number; trade: number; worked: boolean }> = [];

    for (const key of workedTiles) {
      const [colStr, rowStr] = key.split(',');
      const col = parseInt(colStr, 10);
      const row = parseInt(rowStr, 10);
      const tileIndex = row * map.width + col;
      const tile = map.tiles?.[tileIndex];
      if (!tile) continue;

      const terrain = tile.type ?? 'Unknown';
      const base = terrainProps[terrain] ?? {};
      let food = base.food ?? 0;
      let production = base.production ?? 0;
      let trade = base.trade ?? 0;

      const resourceYields = getResourceYields(tile.resource, terrain);
      food += resourceYields.food;
      production += resourceYields.production;
      trade += resourceYields.trade;

      tiles.push({ key, col, row, terrain, resource: tile.resource, food, production, trade, worked: true });
    }

    // Sort: city center first, then by food desc
    tiles.sort((a, b) => {
      const aCenter = a.col === city.col && a.row === city.row;
      const bCenter = b.col === city.col && b.row === city.row;
      if (aCenter && !bCenter) return -1;
      if (!aCenter && bCenter) return 1;
      return b.food - a.food;
    });

    const totals = tiles.reduce(
      (acc, t) => ({ food: acc.food + t.food, production: acc.production + t.production, trade: acc.trade + t.trade }),
      { food: 0, production: 0, trade: 0 }
    );

    const governor = governorOption(city.governor);
    const manualCount = tiles.filter(
      (t) => !(t.col === city.col && t.row === city.row) && manualTiles.has(t.key),
    ).length;

    return (
      <div className="mt-2">
        <div className="side-panel-small-muted fw-bold mb-1 d-flex justify-content-between align-items-center">
          <span>Worked Tiles ({tiles.length})</span>
          <span
            className="side-panel-governor-badge"
            title={`${governor.name} governor — change it in the city screen. ${governor.description}`}
          >
            {governor.icon} {governor.name}
          </span>
        </div>
        <div className="worked-tiles-list" style={{ maxHeight: '180px', overflowY: 'auto' }}>
          {tiles.map((t) => {
            const isCenter = t.col === city.col && t.row === city.row;
            const isManual = !isCenter && manualTiles.has(t.key);
            return (
              <div
                key={t.key}
                className={`worked-tile-row d-flex justify-content-between align-items-center py-1 px-1 rounded mb-1${isManual ? ' worked-tile-row--manual' : ''}`}
                style={{
                  background: isCenter
                    ? 'rgba(255,193,7,0.1)'
                    : isManual
                      ? 'rgba(46,82,56,0.45)'
                      : 'rgba(255,255,255,0.03)',
                  border: isManual ? '1px solid rgba(127,209,138,0.45)' : '1px solid transparent',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
                title={`${t.terrain}${t.resource ? ` (${t.resource})` : ''}${isManual ? ' — manual allocation' : ''} — click to center map`}
                onClick={() => {
                  if (gameEngine) {
                    const centerX = t.col * TILE_SIZE;
                    const centerY = t.row * TILE_SIZE;
                    actions.updateCamera({ x: centerX - window.innerWidth / 5, y: centerY - window.innerHeight / 4 });
                  }
                }}
              >
                <span className="text-white-50" style={{ minWidth: '20px' }}>
                  {isCenter ? '🏛️' : isManual ? '✋' : '•'}
                </span>
                <span className="flex-grow-1 text-white text-truncate mx-1">
                  {t.terrain}{t.resource ? ` (${t.resource})` : ''}
                </span>
                <span className="d-flex gap-2 flex-shrink-0" style={{ fontSize: '0.75rem' }}>
                  <span title="Food">{t.food}</span>
                  <span title="Production">{t.production}</span>
                  <span title="Trade">{t.trade}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="d-flex justify-content-between small text-muted mt-1 px-1" style={{ fontSize: '0.7rem' }}>
          <span>🍞 {totals.food}</span>
          <span>⛏️ {totals.production}</span>
          <span>💰 {totals.trade}</span>
        </div>
        {manualCount > 0 && (
          <div className="side-panel-small-muted px-1" style={{ fontSize: '0.68rem' }}>
            ✋ {manualCount} manual allocation{manualCount === 1 ? '' : 's'} — the governor leaves{' '}
            {manualCount === 1 ? 'it' : 'them'} alone.
          </div>
        )}
        <div className="side-panel-small-muted px-1 mt-1" style={{ fontSize: '0.68rem' }}>
          Click a worked tile on the map to pick up its citizen, then click an idle tile in the radius to place it.
          Esc or right-click cancels.
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
                {selectedTile.resource && (
                  <div>
                    Resource: <strong>{selectedTile.resource}</strong>
                    {selectedTile.resourceBonus?.description && (
                      <div className="small text-muted fst-italic mt-1">
                        {selectedTile.resourceBonus.description}
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-1">
                  <span>Food: {selectedTile.food ?? 0}</span>
                  {selectedTile.resourceBonus?.food ? (
                    <span className="small ms-1 text-muted">
                      (base {selectedTile.baseFood} + {selectedTile.resourceBonus.food} resource)
                    </span>
                  ) : null}
                </div>
                <div>
                  <span>Production: {selectedTile.production ?? 0}</span>
                  {selectedTile.resourceBonus?.production ? (
                    <span className="small ms-1 text-muted">
                      (base {selectedTile.baseProduction} + {selectedTile.resourceBonus.production} resource)
                    </span>
                  ) : null}
                </div>
                <div>
                  <span>Trade: {selectedTile.trade ?? 0}</span>
                  {selectedTile.resourceBonus?.trade ? (
                    <span className="small ms-1 text-muted">
                      (base {selectedTile.baseTrade} + {selectedTile.resourceBonus.trade} resource)
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <hr className="details-separator" />
          </>
        )}

        {/* A selected city shows its citizen block at the TOP of the panel
            (see renderSelectionContent), so nothing is repeated down here. */}
        {panelCity ? null : !selectedTile ? (
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

  /**
   * The citizen menu shown while a citizen is being carried. Placement is a map
   * action, so this lists the idle tiles of that city's workable radius with
   * their yields — click one (or click the tile on the map) to place the
   * citizen there. Replaces the old "1 citizen selected" banner.
   */
  const renderCitizenMenu = () => {
    const re = uiState?.citizenReassign;
    const city = re ? cities.find((c) => c.id === re.cityId) : undefined;
    if (!re || !city) return null;
    if (!currentPlayer || city.civilizationId !== currentPlayer.id) return null;

    const worked = city.workingTiles ?? new Set<string>();
    const isCenter = (col: number, row: number) => col === city.col && row === city.row;
    const options: Array<{ col: number; row: number; terrain: string; food: number; production: number; trade: number }> = [];

    for (let dCol = -2; dCol <= 2; dCol++) {
      for (let dRow = -2; dRow <= 2; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue; // radius corners
        const col = city.col + dCol;
        const row = city.row + dRow;
        if (isCenter(col, row)) continue;
        if (!gameEngine?.isTileInCityRadius?.(city, col, row)) continue;
        if (worked.has(`${col},${row}`)) continue; // already has a citizen
        const tile = map?.tiles?.[row * map.width + col];
        if (!tile) continue;
        const y = gameEngine.economicManager?.cityTileYields(tile);
        options.push({
          col,
          row,
          terrain: String(tile.type ?? tile.terrain ?? ''),
          food: y?.food ?? 0,
          production: y?.production ?? 0,
          trade: y?.trade ?? 0,
        });
      }
    }
    // Best food first, then production, then trade — the order a governor would
    // pick them in.
    options.sort((a, b) =>
      (b.food - a.food) || (b.production - a.production) || (b.trade - a.trade),
    );

    return (
      <div className="citizen-menu" role="region" aria-label="Place citizen">
        <div className="citizen-menu-head">
          <span className="citizen-menu-icon" aria-hidden="true">🧑‍🌾</span>
          <div>
            <div className="citizen-menu-title">Placing a citizen — from ({re.col},{re.row})</div>
            <div className="citizen-menu-sub">Pick a tile for {city.name} · Esc or right-click cancels</div>
          </div>
          <button
            type="button"
            className="citizen-menu-cancel"
            title="Put the citizen back (Esc)"
            onClick={() => actions.endCitizenReassign()}
          >
            ✕
          </button>
        </div>
        {options.length === 0 ? (
          <div className="citizen-menu-empty">No idle tile left in this city's radius.</div>
        ) : (
          <div className="citizen-menu-list">
            {options.map((o) => (
              <button
                key={`${o.col},${o.row}`}
                type="button"
                className="citizen-menu-tile"
                title={`Place the citizen on (${o.col},${o.row})`}
                onClick={() => {
                  if (!gameEngine) return;
                  const ok = gameEngine.reassignCitizen(city.id, re.col, re.row, o.col, o.row);
                  if (!ok) {
                    actions.addNotification?.({ type: 'warning', message: 'Cannot place the citizen there.' });
                  }
                  actions.endCitizenReassign();
                }}
              >
                <span className="citizen-menu-tile-terrain">{terrainLabel(o.terrain)}</span>
                <span className="citizen-menu-tile-coords">({o.col},{o.row})</span>
                <span className="citizen-menu-tile-yields">
                  {o.food > 0 && <span title="Food">🍞{o.food}</span>}
                  {o.production > 0 && <span title="Production">⛏️{o.production}</span>}
                  {o.trade > 0 && <span title="Trade">💰{o.trade}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
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
        {/* While a citizen is in hand the panel IS the citizen menu: the tiles
            it can be placed on, listed with their yields. No banner needed. */}
        {uiState?.citizenReassign && renderCitizenMenu()}

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