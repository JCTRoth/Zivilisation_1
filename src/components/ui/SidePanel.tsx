import React, { useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { CIVILIZATIONS } from '@/data/GameData';
import { TILE_SIZE } from '@/data/TerrainData';
import { getResourceYields, TERRAIN_PROPERTIES } from '@/data/TerrainConstants';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import { governorOption } from '@/utils/CityGovernorUtils';
import MiniMap from './MiniMap';
import '../../styles/sidePanel.css';
import type { City, Civilization, SpecialistType } from '../../../types/game';
import GameEngine from '@/game/engine/GameEngine';

// Capitalize the first letter of a string (e.g. 'warrior' -> 'Warrior')
const capitalize = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/**
 * Count the *visible* symbols in an icon string — not code points.
 * '🏛️' is two code points (base + variation selector) and '🇫🇷🥖' is four,
 * so a naive length would treat single-flag civs as multi-icon ones and
 * '🐎🏹' as four. Grapheme segmentation groups flags and VS16 correctly.
 */
const countSymbols = (value: string): number => {
  if (!value) return 0;
  // Intl.Segmenter is not in every TS lib yet — type it locally.
  type SegmenterCtor = new (
    locales?: string | string[],
    options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
  ) => { segment(input: string): Iterable<{ segment: string }> };
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  try {
    if (Segmenter) {
      return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
    }
  } catch {
    /* older engines fall through to the heuristic below */
  }
  // Heuristic: drop variation selectors, then fold regional-indicator pairs.
  const chars = Array.from(value.replace(/\uFE0F/gu, ''));
  const isRegional = (c: string) => c >= '\u{1F1E6}' && c <= '\u{1F1FF}';
  let count = 0;
  for (let i = 0; i < chars.length; i++) {
    if (isRegional(chars[i]) && i + 1 < chars.length && isRegional(chars[i + 1])) i++;
    count++;
  }
  return count;
};

const SidePanel: React.FC<{ gameEngine?: GameEngine | null }> = ({ gameEngine }) => {
  // ─── Store State ─────────────────────────────────────────────
  const currentPlayer = useGameStore((s) => s.civilizations[s.gameState.activePlayer] || null);
  const civilizations = useGameStore((s) => s.civilizations);
  const units = useGameStore((s) => s.units);
  const cities = useGameStore((s) => s.cities);
  const selectedUnit = useGameStore((s) => s.units.find((u) => u.id === s.gameState.selectedUnit) || null);
  const selectedCityId = useGameStore((s) => s.gameState.selectedCity);
  const focusedCityId = useGameStore((s) => s.gameState.focusedCity ?? null);
  const selectionOrigin = useGameStore((s) => s.gameState.selectionOrigin ?? null);
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

  /**
   * Which city the panel is currently "about".
   *
   * The citizen block (specialists, worked tiles, city readout) belongs to the
   * SELECTED CITY and is shown for as long as that city is selected — the
   * selected hex must never hide it (picking a citizen up puts the hex on a
   * worked tile; clicking a radius tile to read a yield does the same), and
   * neither may the turn manager's automatic unit focus, because the city is
   * still the marked/selected city on the map. Only a selection the PLAYER
   * made (a unit or a tile) hands the panel over; clicking empty ground clears
   * the city selection, which hides it again.
   */
  const panelCity = useMemo(() => {
    if (selectedUnit && selectionOrigin === 'user') return null;
    const id = selectedCityId ?? (selectionOrigin === 'user' ? null : focusedCityId);
    return id ? cities.find((c) => c.id === id) ?? null : null;
  }, [selectedUnit, selectionOrigin, selectedCityId, focusedCityId, cities]);

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
  // 1 / 2 / 3+ symbols in the badge — each step gets a smaller glyph so the
  // icon can never wrap or grow past the avatar (wrapped emoji was what
  // pushed the Huns' two-icon badge outside its box).
  const civIconCount = countSymbols(civIcon);
  const civIconClass = `avatar-icons-${Math.min(civIconCount, 3)}`;

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



  // ─── Render Helpers ──────────────────────────────────────────
  const selectionTitle = selectedUnit
    ? 'Selected Unit'
    : panelCity
      ? 'Selected City'
      : unitAtSelectedTile
        ? 'Unit'
        : selectedTile
          ? 'Selected Tile'
          : 'No Selection';

  // With nothing selected the empire summary lives in the selection section,
  // so the Details section stays hidden instead of repeating the same numbers.
  const nothingSelected = !selectedUnit && !panelCity && !unitAtSelectedTile && !selectedTile;
  const showPlayerSummary = !panelCity && !selectedTile && !nothingSelected;
  const showDetails = Boolean(selectedTile) || showPlayerSummary;

  const sciencePerTurn = (gameEngine?.researchManager && currentPlayer?.currentResearch)
    ? gameEngine.researchManager.perTurnProgress(currentPlayer, currentPlayer.currentResearch, playerResources?.science ?? 0)
    : playerResources?.science ?? 0;

  const renderSelectionContent = () => {
    if (selectedUnit) {
      return (
        <div className="unit-card">
          <div className="unit-card-title">{capitalize(selectedUnit.type)}</div>
          <div className="unit-card-line">
            HP: {selectedUnit.health ?? 100} • Moves: {selectedUnit.movesRemaining ?? 0}
          </div>
          <div className="unit-card-line">
            Attack: {selectedUnit?.attack ?? 0} • Defense: {selectedUnit?.defense ?? 0}
            {selectedUnit?.isFortified ? ' • 🛡️ Fortified (+50% def)' : ''}
          </div>
        </div>
      );
    }

    if (panelCity) {
      // Identity first (name / size / place), then the numbers, then the
      // citizen block: who works what stays directly above the tile list it
      // belongs to.
      const cityStats = [
        { icon: '👥', label: 'Population', value: panelCity.population ?? 1 },
        { icon: '🍞', label: 'Food', value: panelCity.yields?.food ?? 0 },
        { icon: '⛏️', label: 'Production', value: panelCity.yields?.production ?? 0 },
        { icon: '💰', label: 'Trade', value: panelCity.yields?.trade ?? 0 },
        { icon: '🔬', label: 'Science', value: panelCity.science ?? 0 },
        { icon: '🪙', label: 'Gold', value: panelCity.gold ?? 0 },
      ];
      return (
        <div className="city-block">
          <div className="city-head">
            <div className="city-head-row">
              <span className="city-name">{panelCity.name}</span>
              <span className="city-head-coords side-panel-small-muted">
                <i className="bi bi-geo-alt" aria-hidden="true"></i>
                {panelCity.col}, {panelCity.row}
              </span>
            </div>
          </div>

          {uiState?.citizenReassign && renderCitizenMenu()}

          <div className="city-stats-grid">
            {cityStats.map((s) => (
              <div key={s.label} className="city-stat">
                <span className="city-stat-value">
                  <span className="city-stat-icon" aria-hidden="true">{s.icon}</span>
                  {s.value}
                </span>
                <span className="city-stat-label">{s.label}</span>
              </div>
            ))}
          </div>

          {renderCitySpecialists(panelCity)}
          {renderWorkedTiles(panelCity)}
        </div>
      );
    }

    if (unitAtSelectedTile) {
      const own = unitAtSelectedTile.civilizationId === currentPlayer?.id;
      return (
        <div className="unit-card">
          <div className="unit-card-title">
            {capitalize(unitAtSelectedTile.name || unitAtSelectedTile.type)}
          </div>
          <div className="unit-card-sub">{capitalize(unitAtSelectedTile.type)}</div>
          {own ? (
            <div className="unit-card-line">
              HP: {unitAtSelectedTile.health ?? 100} • Moves: {unitAtSelectedTile.movesRemaining ?? 0}
            </div>
          ) : (
            <div className="unit-card-line">
              Attack: {unitAtSelectedTile?.attack ?? 0} • Defense: {unitAtSelectedTile?.defense ?? 0}
            </div>
          )}
        </div>
      );
    }

    if (selectedTile) {
      return (
        <div className="tile-card">
          <div className="tile-card-title">{capitalize(String(selectedTile.terrainName))}</div>
          <div className="sp-kv">Coordinates: <b>({selectedTile.col}, {selectedTile.row})</b></div>
          <div className="sp-kv">Movement Cost: <b>{selectedTile.movementCost}</b></div>
          {selectedTile.resource && <div className="sp-kv">Resource: <b>{selectedTile.resource}</b></div>}
          {selectedTile.improvement && <div className="sp-kv">Improvement: <b>{selectedTile.improvement}</b></div>}
        </div>
      );
    }

    return (
      <div className="sp-kv-grid">
        <div className="sp-kv">Units: <b>{playerUnits?.length ?? 0}</b></div>
        <div className="sp-kv">Cities: <b>{playerCities?.length ?? 0}</b></div>
        <div className="sp-kv">Food: <b>{playerResources?.food ?? 0}</b></div>
        <div className="sp-kv">Production: <b>{playerResources?.production ?? 0}</b></div>
        <div className="sp-kv">Trade: <b>{playerResources?.trade ?? 0}</b></div>
        <div className="sp-kv">Science: <b>{sciencePerTurn}</b></div>
        <div className="sp-kv">Gold: <b>{playerResources?.gold ?? 0}</b></div>
      </div>
    );
  };

  const renderCitySpecialists = (city: City) => {
    const specs = city.specialists ?? [];
    const pop = city.population ?? 1;
    if (!(currentPlayer && city.civilizationId === currentPlayer.id)) return null;

    const workedTiles = city.workingTiles ?? new Set<string>();
    const freeCitizens = Math.max(0, pop - (workedTiles.size - 1) - specs.length);
    const canAdd = freeCitizens > 0 || workedTiles.size > 0;
    const locked = city.lockSpecialists ?? false;

    return (
      <div className="sp-block">
        <div className="sp-block-head">
          <span className="sp-block-label">
            Specialists <span className="sp-block-count">({specs.length}/{pop})</span>
            {locked && (
              <i className="bi bi-lock-fill sp-lock" title="Specialists locked" aria-label="Specialists locked"></i>
            )}
          </span>
          {specs.length > 0 && (
            <button
              type="button"
              className="side-panel-specialist-demote-all-btn"
              onClick={() => {
                let demoted = 0;
                for (let i = specs.length - 1; i >= 0; i--) {
                  if (gameEngine?.demoteSpecialistToWorker(city.id, i)) {
                    demoted++;
                  }
                }
                if (demoted > 0) {
                  actions?.addNotification?.({ type: 'info', message: `${city.name}: ${demoted} specialist${demoted > 1 ? 's' : ''} back to tiles.` });
                }
              }}
            >
              Demote All
            </button>
          )}
        </div>
        <div className="side-panel-specialist-tally">
          {(Object.keys(SPECIALIST_YIELDS) as SpecialistType[]).map((type) => {
            const def = SPECIALIST_YIELDS[type];
            const count = specs.filter((s) => s === type).length;
            const gains = [
              def.luxury ? `+${def.luxury} Luxury` : null,
              def.gold ? `+${def.gold} Gold` : null,
              def.science ? `+${def.science} Science` : null,
            ].filter(Boolean).join(', ');
            return (
              <div key={type} className="side-panel-specialist-tally-item" title={`${def.name} — ${gains}`}>
                <span className="side-panel-specialist-tally-icon">{def.icon}</span>
                <span className="side-panel-specialist-tally-name">{def.name}</span>
                <span className="side-panel-specialist-tally-count">{count}</span>
                <span className="side-panel-specialist-btns">
                  <button
                    type="button"
                    className="side-panel-specialist-btn"
                    disabled={count === 0}
                    title={count > 0 ? `Demote ${def.name}` : 'None assigned'}
                    aria-label={`Remove ${def.name}`}
                    onClick={() => {
                      const idx = specs.lastIndexOf(type);
                      if (idx >= 0 && gameEngine?.demoteSpecialistToWorker(city.id, idx)) {
                        actions?.addNotification?.({ type: 'info', message: `${city.name}: ${def.name} back to tiles.` });
                      }
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="side-panel-specialist-btn"
                    disabled={!canAdd}
                    title={canAdd ? `Promote to ${def.name}` : 'No citizens available'}
                    aria-label={`Add ${def.name}`}
                    onClick={() => {
                      if (gameEngine?.promoteCitizenToSpecialist(city.id, type)) {
                        actions?.addNotification?.({ type: 'info', message: `${city.name}: promoted to ${def.name}.` });
                      }
                    }}
                  >
                    +
                  </button>
                </span>
              </div>
            );
          })}
        </div>
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
      <div className="sp-block">
        <div className="sp-block-head">
          <span className="sp-block-label">
            Worked Tiles <span className="sp-block-count">{tiles.length}</span>
          </span>
          <span
            className="side-panel-governor-badge"
            title={`${governor.name} governor — change it in the city screen. ${governor.description}`}
          >
            {governor.icon} {governor.name}
          </span>
        </div>

        <div className="wt-cols" aria-hidden="true">
          <span className="wt-marker" />
          <span className="wt-name" />
          <span className="wt-num">🍞</span>
          <span className="wt-num">⛏️</span>
          <span className="wt-num">💰</span>
        </div>

        <div className="worked-tiles-list">
          {tiles.map((t) => {
            const isCenter = t.col === city.col && t.row === city.row;
            const isManual = !isCenter && manualTiles.has(t.key);
            return (
              <div
                key={t.key}
                className={`worked-tile-row${isCenter ? ' worked-tile-row--center' : ''}${isManual ? ' worked-tile-row--manual' : ''}`}
                title={`${t.terrain}${t.resource ? ` (${t.resource})` : ''}${isManual ? ' — manual allocation' : ''} — click to center map`}
                onClick={() => {
                  if (gameEngine) {
                    const centerX = t.col * TILE_SIZE;
                    const centerY = t.row * TILE_SIZE;
                    actions.updateCamera({ x: centerX - window.innerWidth / 5, y: centerY - window.innerHeight / 4 });
                  }
                }}
              >
                <span className="wt-marker">{isCenter ? '🏛️' : isManual ? '✋' : '•'}</span>
                <span className="wt-name">
                  {t.terrain}{t.resource ? ` (${t.resource})` : ''}
                </span>
                <span className="wt-num">{t.food}</span>
                <span className="wt-num">{t.production}</span>
                <span className="wt-num">{t.trade}</span>
              </div>
            );
          })}
        </div>

        <div className="wt-totals">
          <span className="wt-marker" />
          <span className="wt-name">Total</span>
          <span className="wt-num">{totals.food}</span>
          <span className="wt-num">{totals.production}</span>
          <span className="wt-num">{totals.trade}</span>
        </div>

        {manualCount > 0 && (
          <div className="sp-note">
            ✋ {manualCount} manual allocation{manualCount === 1 ? '' : 's'} — the governor leaves{' '}
            {manualCount === 1 ? 'it' : 'them'} alone.
          </div>
        )}
        <div className="sp-hint">
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
          <div className="terrain-info-section">
            <div className="terrain-title">Terrain Information</div>
            <div className="sp-kv-grid">
              <div className="sp-kv">Type: <b>{capitalize(String(selectedTile.terrainName))}</b></div>
              <div className="sp-kv">Coordinates: <b>({selectedTile.col}, {selectedTile.row})</b></div>
              <div className="sp-kv">Movement Cost: <b>{selectedTile.movementCost}</b></div>
              <div className="sp-kv">Defense: <b>{Math.round((selectedTile.defenseBonus - 1) * 100)}%</b></div>
              {selectedTile.improvement && (
                <div className="sp-kv">Improvement: <b>{selectedTile.improvement}</b></div>
              )}
              {selectedTile.resource && (
                <div className="sp-kv">Resource: <b>{selectedTile.resource}</b></div>
              )}
              <div className="sp-kv">
                Food: <b>{selectedTile.food ?? 0}
                {selectedTile.resourceBonus?.food ? (
                  <span className="sp-kv-sub"> (base {selectedTile.baseFood} + {selectedTile.resourceBonus.food})</span>
                ) : null}</b>
              </div>
              <div className="sp-kv">
                Production: <b>{selectedTile.production ?? 0}
                {selectedTile.resourceBonus?.production ? (
                  <span className="sp-kv-sub"> (base {selectedTile.baseProduction} + {selectedTile.resourceBonus.production})</span>
                ) : null}</b>
              </div>
              <div className="sp-kv">
                Trade: <b>{selectedTile.trade ?? 0}
                {selectedTile.resourceBonus?.trade ? (
                  <span className="sp-kv-sub"> (base {selectedTile.baseTrade} + {selectedTile.resourceBonus.trade})</span>
                ) : null}</b>
              </div>
            </div>
            {selectedTile.resourceBonus?.description && (
              <div className="sp-note">{selectedTile.resourceBonus.description}</div>
            )}
          </div>
        )}

        {/* A selected city shows its citizen block at the TOP of the panel
            (see renderSelectionContent), and with nothing selected the same
            summary sits in the selection section — so this only fills the
            Details block while a unit is selected. */}
        {showPlayerSummary ? (
          <div className="player-summary">
            <div className="player-summary-title">Player Summary</div>
            <div className="sp-kv-grid">
              <div className="sp-kv">Units: <b>{playerUnits?.length ?? 0}</b></div>
              <div className="sp-kv">Cities: <b>{playerCities?.length ?? 0}</b></div>
              <div className="sp-kv">Gold: <b>{playerResources?.gold ?? 0}</b></div>
              <div className="sp-kv">Food: <b>{playerResources?.food ?? 0}</b></div>
              <div className="sp-kv">Production: <b>{playerResources?.production ?? 0}</b></div>
              <div className="sp-kv">Trade: <b>{playerResources?.trade ?? 0}</b></div>
              <div className="sp-kv">Science: <b>{sciencePerTurn}</b></div>
            </div>
          </div>
        ) : null}
      </>
    );
  };

  /**
   * One plain line inside the city block while a citizen is being carried: what
   * is happening and how to abort. Placement itself is a map action (the idle
   * tiles light up there), so nothing is listed in the panel.
   */
  const renderCitizenMenu = () => {
    const re = uiState?.citizenReassign;
    const city = re ? cities.find((c) => c.id === re.cityId) : undefined;
    if (!re || !city) return null;
    if (!currentPlayer || city.civilizationId !== currentPlayer.id) return null;

    const worked = city.workingTiles ?? new Set<string>();
    let idleTiles = 0;
    for (let dCol = -2; dCol <= 2; dCol++) {
      for (let dRow = -2; dRow <= 2; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        if (Math.abs(dCol) === 2 && Math.abs(dRow) === 2) continue;
        const col = city.col + dCol;
        const row = city.row + dRow;
        if (col === city.col && row === city.row) continue;
        if (!gameEngine?.isTileInCityRadius?.(city, col, row)) continue;
        if (worked.has(`${col},${row}`)) continue;
        if (!map?.tiles?.[row * map.width + col]) continue;
        idleTiles++;
      }
    }

    return (
      <div className="citizen-menu">
        <div className="citizen-menu-title">
          Placing a citizen — from ({re.col},{re.row})
        </div>
        <div className="citizen-menu-sub">
          {idleTiles > 0
            ? `Click one of the ${idleTiles} idle tiles in ${city.name}'s radius · Esc or right-click cancels`
            : 'No idle tile left in this city\'s radius · Esc or right-click cancels'}
        </div>
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
        {/* Header */}
        <div className="side-panel-header">
          <div className="header-flex">
            <div
              className={`avatar-div ${civIconClass}`}
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
            </div>
          </div>

          <div className="header-chips">
            <span className="gold-div">
              <strong className="gold-strong">{playerResources.gold} 🪙</strong>
            </span>
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

          <label
            className="settings-checkbox-label"
            title="End the turn automatically once every unit has moved"
          >
            <input
              type="checkbox"
              checked={settings.autoEndTurn}
              onChange={(e) => actions.updateSettings({ autoEndTurn: e.target.checked })}
            />
            <span className="checkbox-text">Auto. turn ending</span>
          </label>
        </div>

        {/* Selection */}
        <div className="selection-section">
          {selectionTitle && <div className="selected-title">{selectionTitle}</div>}
          <div className="selection-body">{renderSelectionContent()}</div>
        </div>

        {/* Details */}
        {showDetails && (
          <div className="details-section">
            <div className="details-title">Details</div>
            <div className="details-content">
              {renderDetailsContent()}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default SidePanel;