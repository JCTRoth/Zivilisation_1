import React, { useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { CIVILIZATIONS } from '@/data/GameData';
import { TILE_SIZE } from '@/data/TerrainData';
import { getResourceYields, TERRAIN_PROPERTIES } from '@/data/TerrainConstants';
import { SPECIALIST_YIELDS } from '@/data/GameConstants';
import { governorOption } from '@/utils/CityGovernorUtils';
import { unitRankBadge } from '@/utils/UnitStatus';
import {
  UNIT_RANK_INFO,
  UNIT_RANK_MAX,
  getUnitRank,
  type UnitRank,
} from '@/game/engine/UnitRankSystem';
import MiniMap from './MiniMap';
import '../../styles/sidePanel.css';
import '../../styles/unitRank.css';
import type { City, Civilization, SpecialistType, Unit } from '../../../types/game';
import GameEngine from '@/game/engine/GameEngine';
import { teamColor, teamName } from '@/data/TeamConstants';
import { useTranslation } from '@/i18n/useTranslation';
import { tSpecialistName, tUnitName } from '@/i18n/dataNames';
import type { TranslationParams } from '@/i18n';

const SPECIALIST_TYPES = Object.keys(SPECIALIST_YIELDS) as SpecialistType[];

/**
 * Translation function with an open key type. `useTranslation()` types `t()`
 * against `TranslationKey`; this panel's own `side.*` keys travel through the
 * i18n fragments and only become part of that union once they are merged into
 * the dictionaries, so the key is widened here — the runtime lookup is
 * identical.
 */
type SideTranslate = (key: string, params?: TranslationParams) => string;

// Capitalize the first letter of a string (e.g. 'warrior' -> 'Warrior')
const capitalize = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/**
 * Rank line for a unit card: rank name, strength multiplier and the XP
 * still needed for the next grade. Every unit shows its rank here — Rookies
 * in a muted style — so the veterancy system is always readable in the
 * panel, while the map keeps the default rank invisible.
 */
const unitRankLine = (unit: Unit, t: SideTranslate): React.ReactNode => {
  const rank = getUnitRank(unit);
  const info = UNIT_RANK_INFO[rank];
  const badge = unitRankBadge(unit);
  const nextInfo = rank < UNIT_RANK_MAX ? UNIT_RANK_INFO[(rank + 1) as UnitRank] : null;
  return (
    <div
      className={badge ? 'unit-card-rank' : 'unit-card-rank unit-card-rank--rookie'}
      title={badge?.title ?? t('side.rankTooltip', { name: info.name, multiplier: info.strengthMultiplier })}
    >
      {badge ? badge.label : info.name} {t('side.rankStrength', { multiplier: info.strengthMultiplier })}
      {nextInfo && (
        <span className="unit-card-rank-sub">
          {t('side.rankXp', {
            xp: Math.round(unit.experience ?? 0),
            threshold: nextInfo.xpThreshold,
            name: nextInfo.name,
          })}
        </span>
      )}
    </div>
  );
};

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
  const { t: translate } = useTranslation();
  // The `side.*` keys resolve through the same runtime lookup as every other
  // key — only the TypeScript key type is widened (see `SideTranslate`).
  const t = translate as SideTranslate;
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
      name: t('side.fallbackPlayerName'),
      leader: t('side.fallbackLeader'),
      color: '#4b8b3b'
    });
  }, [currentPlayer, civilizations, t]);

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
    ? t('side.selectionSelectedUnit')
    : panelCity
      ? t('side.selectionSelectedCity')
      : unitAtSelectedTile
        ? t('side.selectionUnit')
        : selectedTile
          ? t('side.selectionSelectedTile')
          : t('side.selectionNone');

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
          <div className="unit-card-title">{tUnitName(selectedUnit.type, capitalize(selectedUnit.type))}</div>
          <div className="unit-card-line">
            {t('side.unitHpMoves', {
              hp: selectedUnit.health ?? 100,
              moves: selectedUnit.movesRemaining ?? 0,
            })}
          </div>
          <div className="unit-card-line">
            {t('side.unitAttackDefense', {
              attack: selectedUnit?.attack ?? 0,
              defense: selectedUnit?.defense ?? 0,
            })}
            {selectedUnit?.isFortified ? t('side.unitFortified') : ''}
          </div>
          {unitRankLine(selectedUnit, t)}
        </div>
      );
    }

    if (panelCity) {
      // Identity first (name / size / place), then the numbers, then the
      // citizen block: who works what stays directly above the tile list it
      // belongs to.
      const cityStats = [
        { icon: '👥', label: t('side.statPopulation'), value: panelCity.population ?? 1 },
        { icon: '🍞', label: t('side.statFood'), value: panelCity.yields?.food ?? 0 },
        { icon: '⛏️', label: t('side.statProduction'), value: panelCity.yields?.production ?? 0 },
        { icon: '💰', label: t('side.statTrade'), value: panelCity.yields?.trade ?? 0 },
        { icon: '🔬', label: t('side.statScience'), value: panelCity.science ?? 0 },
        { icon: '🪙', label: t('side.statGold'), value: panelCity.gold ?? 0 },
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

          {renderWorkedTiles(panelCity)}
        </div>
      );
    }

    if (unitAtSelectedTile) {
      const own = unitAtSelectedTile.civilizationId === currentPlayer?.id;
      return (
        <div className="unit-card">
          <div className="unit-card-title">
            {unitAtSelectedTile.name
              ? capitalize(unitAtSelectedTile.name)
              : tUnitName(unitAtSelectedTile.type, capitalize(unitAtSelectedTile.type))}
          </div>
          <div className="unit-card-sub">
            {tUnitName(unitAtSelectedTile.type, capitalize(unitAtSelectedTile.type))}
          </div>
          {own ? (
            <div className="unit-card-line">
              {t('side.unitHpMoves', {
                hp: unitAtSelectedTile.health ?? 100,
                moves: unitAtSelectedTile.movesRemaining ?? 0,
              })}
            </div>
          ) : (
            <div className="unit-card-line">
              {t('side.unitAttackDefense', {
                attack: unitAtSelectedTile?.attack ?? 0,
                defense: unitAtSelectedTile?.defense ?? 0,
              })}
            </div>
          )}
          {unitRankLine(unitAtSelectedTile, t)}
        </div>
      );
    }

    if (selectedTile) {
      return (
        <div className="tile-card">
          <div className="tile-card-title">{capitalize(String(selectedTile.terrainName))}</div>
          <div className="sp-kv">{t('side.tileCoordinates')} <b>({selectedTile.col}, {selectedTile.row})</b></div>
          <div className="sp-kv">{t('side.tileMovementCost')} <b>{selectedTile.movementCost}</b></div>
          {selectedTile.resource && <div className="sp-kv">{t('side.tileResource')} <b>{selectedTile.resource}</b></div>}
          {selectedTile.improvement && <div className="sp-kv">{t('side.tileImprovement')} <b>{selectedTile.improvement}</b></div>}
        </div>
      );
    }

    return (
      <div className="sp-kv-grid">
        <div className="sp-kv">{t('side.summaryUnits')} <b>{playerUnits?.length ?? 0}</b></div>
        <div className="sp-kv">{t('side.summaryCities')} <b>{playerCities?.length ?? 0}</b></div>
        <div className="sp-kv">{t('side.summaryFood')} <b>{playerResources?.food ?? 0}</b></div>
        <div className="sp-kv">{t('side.summaryProduction')} <b>{playerResources?.production ?? 0}</b></div>
        <div className="sp-kv">{t('side.summaryTrade')} <b>{playerResources?.trade ?? 0}</b></div>
        <div className="sp-kv">{t('side.summaryScience')} <b>{sciencePerTurn}</b></div>
        <div className="sp-kv">{t('side.summaryGold')} <b>{playerResources?.gold ?? 0}</b></div>
      </div>
    );
  };

  const renderWorkedTiles = (city: City) => {
    const workedTiles = city.workingTiles;
    if (!workedTiles || workedTiles.size === 0) return null;

    // The whole citizen roster lives here now: tiles on the rows, specialists
    // counted on the centre row. One invariant keeps them honest — every
    // citizen of the city is on exactly one of the two lists.
    const specialists = city.specialists ?? [];
    const pop = city.population ?? 1;
    const ownCity = !!currentPlayer && city.civilizationId === currentPlayer.id;
    // A tile citizen can only be handed over if the city still has a citizen
    // to spare: `tiles + specialists === pop`, so the moment they match, every
    // citizen is accounted for and nothing may move.
    const canConvert = ownCity && !!gameEngine && specialists.length < pop;

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
      (acc, tile) => ({ food: acc.food + tile.food, production: acc.production + tile.production, trade: acc.trade + tile.trade }),
      { food: 0, production: 0, trade: 0 }
    );

    const governor = governorOption(city.governor);
    const manualCount = tiles.filter(
      (tile) => !(tile.col === city.col && tile.row === city.row) && manualTiles.has(tile.key),
    ).length;

    return (
      <div className="sp-block">
        <div className="sp-block-head">
          <span className="sp-block-label">
            {t('side.workedTiles')} <span className="sp-block-count">{tiles.length}</span>
          </span>
          <span
            className="side-panel-governor-badge"
            title={t('side.governorTooltip', {
              name: governor.name,
              description: governor.description,
            })}
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
          <span className="wt-specs-head">{ownCity ? '🕺 💸 🥼' : ''}</span>
        </div>

        <div className="worked-tiles-list">
          {tiles.map((tile) => {
            const isCenter = tile.col === city.col && tile.row === city.row;
            const isManual = !isCenter && manualTiles.has(tile.key);
            return (
              <div
                key={tile.key}
                className={`worked-tile-row${isCenter ? ' worked-tile-row--center' : ''}${isManual ? ' worked-tile-row--manual' : ''}`}
                title={
                  isCenter
                    ? t('side.tileTooltipCenter', { terrain: tile.terrain })
                    : t('side.tileTooltip', {
                        terrain: tile.terrain,
                        resource: tile.resource ? ` (${tile.resource})` : '',
                        allocation: isManual ? t('side.manualAllocationSuffix') : '',
                      })
                }
                onClick={() => {
                  if (gameEngine) {
                    const centerX = tile.col * TILE_SIZE;
                    const centerY = tile.row * TILE_SIZE;
                    actions.updateCamera({ x: centerX - window.innerWidth / 5, y: centerY - window.innerHeight / 4 });
                  }
                }}
              >
                <span className="wt-marker">{isCenter ? '🏛️' : isManual ? '✋' : '•'}</span>
                <span className="wt-name">
                  {tile.terrain}{tile.resource ? ` (${tile.resource})` : ''}
                </span>
                <span className="wt-num">{tile.food}</span>
                <span className="wt-num">{tile.production}</span>
                <span className="wt-num">{tile.trade}</span>
                {isCenter ? (
                  <span className="wt-specs">
                    {SPECIALIST_TYPES.map((type) => {
                      const def = SPECIALIST_YIELDS[type];
                      const specName = tSpecialistName(type, def.name);
                      const count = specialists.filter((s) => s === type).length;
                      const gains = [
                        def.luxury ? t('side.gainLuxury', { n: def.luxury }) : null,
                        def.gold ? t('side.gainGold', { n: def.gold }) : null,
                        def.science ? t('side.gainScience', { n: def.science }) : null,
                      ].filter(Boolean).join(', ');
                      return (
                        <button
                          key={type}
                          type="button"
                          className={`wt-spec${count > 0 ? ' wt-spec--on' : ''}`}
                          title={
                            count > 0
                              ? t('side.specialistActiveTooltip', { name: specName, count, gains })
                              : t('side.specialistIdleTooltip', { name: specName, gains })
                          }
                          aria-label={t('side.specialistRemoveAria', { name: specName })}
                          disabled={count === 0 || !gameEngine}
                          onClick={() => {
                            const idx = specialists.lastIndexOf(type);
                            if (idx >= 0 && gameEngine?.demoteSpecialistToWorker(city.id, idx)) {
                              actions?.addNotification?.({
                                type: 'info',
                                message: t('side.specialistRemovedNotice', { city: city.name, name: specName }),
                              });
                            }
                          }}
                        >
                          {def.icon}
                          {count > 0 && <span className="wt-spec-n">{count}</span>}
                        </button>
                      );
                    })}
                  </span>
                ) : (
                  <span className="wt-specs">
                    {SPECIALIST_TYPES.map((type) => {
                      const def = SPECIALIST_YIELDS[type];
                      const specName = tSpecialistName(type, def.name);
                      return (
                        <button
                          key={type}
                          type="button"
                          className="wt-spec"
                          disabled={!canConvert}
                          title={
                            canConvert
                              ? t('side.specialistPromoteTooltip', { terrain: tile.terrain, name: specName })
                              : t('side.specialistPromoteDisabled')
                          }
                          aria-label={t('side.specialistPromoteAria', { name: specName })}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (gameEngine?.convertTileCitizenToSpecialist(city.id, tile.col, tile.row, type)) {
                              actions?.addNotification?.({
                                type: 'info',
                                message: t('side.specialistPromotedNotice', {
                                  city: city.name,
                                  terrain: tile.terrain,
                                  name: specName,
                                }),
                              });
                            }
                          }}
                        >
                          {def.icon}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="wt-totals">
          <span className="wt-marker" />
          <span className="wt-name">{t('side.total')}</span>
          <span className="wt-num">{totals.food}</span>
          <span className="wt-num">{totals.production}</span>
          <span className="wt-num">{totals.trade}</span>
        </div>

        {manualCount > 0 && (
          <div className="sp-note">
            {manualCount === 1
              ? t('side.manualNoteSingular', { count: manualCount })
              : t('side.manualNotePlural', { count: manualCount })}
          </div>
        )}
        <div className="sp-hint">
          {t('side.workedTilesHint')}
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
            <div className="terrain-title">{t('side.terrainInformation')}</div>
            <div className="sp-kv-grid">
              <div className="sp-kv">{t('side.tileType')} <b>{capitalize(String(selectedTile.terrainName))}</b></div>
              <div className="sp-kv">{t('side.tileCoordinates')} <b>({selectedTile.col}, {selectedTile.row})</b></div>
              <div className="sp-kv">{t('side.tileMovementCost')} <b>{selectedTile.movementCost}</b></div>
              <div className="sp-kv">{t('side.tileDefense')} <b>{Math.round((selectedTile.defenseBonus - 1) * 100)}%</b></div>
              {selectedTile.improvement && (
                <div className="sp-kv">{t('side.tileImprovement')} <b>{selectedTile.improvement}</b></div>
              )}
              {selectedTile.resource && (
                <div className="sp-kv">{t('side.tileResource')} <b>{selectedTile.resource}</b></div>
              )}
              <div className="sp-kv">
                {t('side.summaryFood')} <b>{selectedTile.food ?? 0}
                {selectedTile.resourceBonus?.food ? (
                  <span className="sp-kv-sub">{t('side.baseYield', {
                    base: selectedTile.baseFood,
                    bonus: selectedTile.resourceBonus.food,
                  })}</span>
                ) : null}</b>
              </div>
              <div className="sp-kv">
                {t('side.summaryProduction')} <b>{selectedTile.production ?? 0}
                {selectedTile.resourceBonus?.production ? (
                  <span className="sp-kv-sub">{t('side.baseYield', {
                    base: selectedTile.baseProduction,
                    bonus: selectedTile.resourceBonus.production,
                  })}</span>
                ) : null}</b>
              </div>
              <div className="sp-kv">
                {t('side.summaryTrade')} <b>{selectedTile.trade ?? 0}
                {selectedTile.resourceBonus?.trade ? (
                  <span className="sp-kv-sub">{t('side.baseYield', {
                    base: selectedTile.baseTrade,
                    bonus: selectedTile.resourceBonus.trade,
                  })}</span>
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
            <div className="player-summary-title">{t('side.playerSummary')}</div>
            <div className="sp-kv-grid">
              <div className="sp-kv">{t('side.summaryUnits')} <b>{playerUnits?.length ?? 0}</b></div>
              <div className="sp-kv">{t('side.summaryCities')} <b>{playerCities?.length ?? 0}</b></div>
              <div className="sp-kv">{t('side.summaryGold')} <b>{playerResources?.gold ?? 0}</b></div>
              <div className="sp-kv">{t('side.summaryFood')} <b>{playerResources?.food ?? 0}</b></div>
              <div className="sp-kv">{t('side.summaryProduction')} <b>{playerResources?.production ?? 0}</b></div>
              <div className="sp-kv">{t('side.summaryTrade')} <b>{playerResources?.trade ?? 0}</b></div>
              <div className="sp-kv">{t('side.summaryScience')} <b>{sciencePerTurn}</b></div>
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
          {t('side.citizenPlacing', { col: re.col, row: re.row })}
        </div>
        <div className="citizen-menu-sub">
          {idleTiles > 0
            ? t('side.citizenIdle', { count: idleTiles, city: city.name })
            : t('side.citizenNone')}
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
              title={t('side.capitalHint')}
            >
              <span className="icon-span">{civIcon}</span>
            </div>

            <div className="name-div">
              <div className="player-name">
                {displayPlayer.name}
                {(() => {
                  const teamId = gameEngine?.teamManager?.enabled
                    ? gameEngine.teamManager.getTeamId(displayPlayer.id)
                    : null;
                  if (teamId === null || teamId === undefined) return null;
                  return (
                    <span
                      className="side-team-badge"
                      style={{ borderColor: teamColor(teamId), color: teamColor(teamId) }}
                      title={t('side.teamBadgeHint', { team: teamName(teamId) })}
                    >
                      {teamName(teamId)}
                    </span>
                  );
                })()}
              </div>
              <div className="side-panel-small-muted player-leader">
                {(displayPlayer as { civilizationName?: string })?.civilizationName || displayPlayer.leader || t('side.unknownCivilization')}
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
              title={t('side.ratesTooltip')}
              aria-label={t('side.ratesAria')}
            >
              📊
            </button>
          </div>

          <label
            className="settings-checkbox-label"
            title={t('side.autoEndTurnHint')}
          >
            <input
              type="checkbox"
              checked={settings.autoEndTurn}
              onChange={(e) => actions.updateSettings({ autoEndTurn: e.target.checked })}
            />
            <span className="checkbox-text">{t('side.autoEndTurn')}</span>
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
            <div className="details-title">{t('side.details')}</div>
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