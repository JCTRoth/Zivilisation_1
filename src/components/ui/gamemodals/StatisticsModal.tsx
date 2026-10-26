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
import { ModalUtils } from './ModalUtils';
import { CityUtils } from '@/utils/CityUtils';
import { UNIT_PROPS, BUILDING_PROPS } from '@/utils/Constants';
import { WONDER_PROPERTIES } from '@/data/BuildingConstants';
import { GameUtils } from '@/utils/GameUtils';
import { useTranslation } from '@/i18n/useTranslation';
import { tBuildingName, tUnitName, tWonderName } from '@/i18n/dataNames';
import type { TranslationKey } from '@/i18n';
import GameModal from './ModalShell';
import type GameEngine from '@/game/engine/GameEngine';
import type { City, ProductionItem } from '../../../../types/game';
import '../../../styles/statisticsModal.css';

interface StatisticsModalProps {
  show: boolean;
  onHide: () => void;
  /**
   * The live engine, for the per-civ unit ledger (units lost vs disbanded).
   * Those counters are engine state — they survive a save/load — so the screen
   * reads them from there rather than counting from `engine.units`, which by
   * now only holds the survivors.
   */
  gameEngine?: GameEngine | null;
}

const formatVal = (r: DemographicRow): string =>
  r.fmt === 'pct' ? `${r.value}%` : r.fmt === 'float' ? r.value.toFixed(1) : Number.isInteger(r.value) ? r.value.toLocaleString() : r.value.toFixed(1);

// ── Cities tab ────────────────────────────────────────────────────────────
// One row per city owned by the player, sortable on every column. The
// census reuses the same calculators the City screen uses (CityUtils for the
// trade split, the engine's economicManager for food and garrison) so the two
// screens can never disagree about a city's numbers.

type CitySortKey =
  | 'name'
  | 'population'
  | 'producing'
  | 'turnsLeft'
  | 'productionPerTurn'
  | 'foodSurplus'
  | 'growth'
  | 'trade'
  | 'gold'
  | 'science'
  | 'buildings'
  | 'garrison';

interface CityStatRow {
  city: City;
  name: string;
  isCapital: boolean;
  disorder: boolean;
  population: number;
  /** Localizable id of the active production item (`''` = nothing started). */
  producingKey: string;
  producingKind: 'unit' | 'building';
  producingIcon: string;
  producingNameFallback: string;
  /** Turns until the active item is finished — `null` when nothing is built. */
  turnsLeft: number | null;
  productionPerTurn: number;
  /** Food per turn after eating; negative = the city cannot feed itself. */
  foodSurplus: number;
  /** Turns until the next citizen (`0` while not growing). */
  growthTurns: number;
  /** Turns until the granary is empty (`0` while not starving). */
  starvationTurns: number;
  trade: number;
  gold: number;
  science: number;
  buildings: number;
  garrison: number;
}

interface CityColumnDef {
  key: CitySortKey;
  label: TranslationKey;
  numeric?: boolean;
  /** First-click direction; numeric columns start at their most useful end. */
  defaultDir?: 'asc' | 'desc';
}

const CITY_COLUMNS: CityColumnDef[] = [
  { key: 'name', label: 'stats.colCity' },
  { key: 'population', label: 'stats.colPop', numeric: true },
  { key: 'producing', label: 'stats.colProducing' },
  { key: 'turnsLeft', label: 'stats.colTurns', numeric: true, defaultDir: 'asc' },
  { key: 'productionPerTurn', label: 'city.stat.production', numeric: true },
  { key: 'foodSurplus', label: 'city.stat.food', numeric: true },
  { key: 'growth', label: 'stats.colGrowth', numeric: true, defaultDir: 'asc' },
  { key: 'trade', label: 'city.stat.trade', numeric: true },
  { key: 'gold', label: 'stats.colGold', numeric: true },
  { key: 'science', label: 'city.stat.science', numeric: true },
  { key: 'buildings', label: 'stats.colBuildings', numeric: true },
  { key: 'garrison', label: 'stats.colGarrison', numeric: true },
];

const cityIcon = (item: ProductionItem): string => {
  const key = item?.itemType ?? item?.type ?? '';
  if (!key) return '🏗️';
  return UNIT_PROPS[key]?.icon ?? BUILDING_PROPS[key]?.icon ?? (item?.type === 'unit' ? '⚔️' : '🏗️');
};

/**
 * Sort key of one row for one column. `null` is only returned for a missing
 * production item (the Turns column) — the comparator pins nulls to the last
 * row regardless of direction, because "nothing started" is never the answer.
 */
const citySortValue = (key: CitySortKey, row: CityStatRow): string | number | null => {
  switch (key) {
    case 'name': return row.name.toLowerCase();
    case 'population': return row.population;
    case 'producing': return row.producingNameFallback.toLowerCase();
    case 'turnsLeft': return row.turnsLeft;
    case 'productionPerTurn': return row.productionPerTurn;
    // Growth sorts by surplus, not by turns: a starving city's negative
    // surplus puts it first either way — the row that needs the eye.
    case 'growth': return row.foodSurplus;
    case 'foodSurplus': return row.foodSurplus;
    case 'trade': return row.trade;
    case 'gold': return row.gold;
    case 'science': return row.science;
    case 'buildings': return row.buildings;
    case 'garrison': return row.garrison;
  }
};

const StatisticsModal: React.FC<StatisticsModalProps> = ({ show, onHide, gameEngine }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('demographics');
  const civilizations = useGameStore(s => s.civilizations);
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
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

  // ── Cities tab data ────────────────────────────────────────────────────
  const cityRows = useMemo<CityStatRow[]>(() => {
    if (!currentPlayer) return [];
    const player = currentPlayer;
    const econ = gameEngine?.economicManager;
    const civCities = cities.filter(c => c.civilizationId === player.id);
    // The seat of government: engine flag first, the civ's pointer second, and
    // as a last resort the civ's first city — the same fallback
    // GameResultOverlay uses, because scenario starts (MANY_CITIES,
    // NO_SETTLERS) place cities without ever flagging one.
    const capitalId =
      civCities.find(c => c.isCapital === true)?.id ??
      (player.capital && civCities.some(c => c.id === player.capital?.id) ? player.capital.id : undefined) ??
      civCities[0]?.id;

    return civCities
      .map((city): CityStatRow => {
        // The same trade→tax/science split the City screen shows.
        const resources = CityUtils.calculateCityResources(city, player);
        // The engine's food ledger is authoritative when available — it also
        // charges the settlers the plain census does not know about.
        const balance = typeof econ?.cityFoodBalance === 'function'
          ? econ.cityFoodBalance(city, player)
          : null;
        const item = city.currentProduction ?? null;
        const itemKind: 'unit' | 'building' = item?.type === 'unit' ? 'unit' : 'building';
        return {
          city,
          name: city.name,
          isCapital: capitalId === city.id,
          disorder: city.disorder === true,
          population: numberValue(city.population),
          producingKey: String(item?.itemType ?? item?.type ?? ''),
          producingKind: itemKind,
          producingIcon: item ? cityIcon(item) : '',
          producingNameFallback: ModalUtils.getProductionName(item),
          turnsLeft: item
            ? ModalUtils.getTurnsRemaining(
                ModalUtils.getProductionProgressValue(city),
                ModalUtils.getProductionCost(item),
                ModalUtils.getProductionPerTurn(city),
              )
            : null,
          productionPerTurn: ModalUtils.getProductionPerTurn(city),
          foodSurplus: balance?.surplus ?? resources.food.surplus,
          growthTurns: balance?.turnsUntilGrowth ?? resources.food.turnsUntilGrowth,
          starvationTurns: balance?.turnsUntilStarvation ?? resources.food.turnsUntilStarvation,
          trade: resources.trade.total,
          gold: resources.taxes.amount,
          science: resources.science.amount,
          buildings: Array.isArray(city.buildings) ? city.buildings.length : 0,
          garrison: typeof econ?.garrisonOnCityTile === 'function'
            ? econ.garrisonOnCityTile(player, city)
            : units.filter(
                u =>
                  u?.civilizationId === player.id &&
                  u.isDefeated !== true &&
                  (u.attack ?? 0) > 0 &&
                  u.col === city.col &&
                  u.row === city.row,
              ).length,
        };
      });
  }, [cities, currentPlayer, units, gameEngine]);

  const [citySort, setCitySort] = useState<{ key: CitySortKey; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });

  const sortedCityRows = useMemo<CityStatRow[]>(() => {
    const dir = citySort.dir === 'asc' ? 1 : -1;
    return [...cityRows].sort((a, b) => {
      const av = citySortValue(citySort.key, a);
      const bv = citySortValue(citySort.key, b);
      // A city with nothing in production sorts to the very end.
      if (av === null || bv === null) return (av === null ? 1 : 0) - (bv === null ? 1 : 0);
      return (typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : av - bv) * dir;
    });
  }, [cityRows, citySort]);

  const clickCitySort = (col: CityColumnDef) => {
    setCitySort(prev =>
      prev.key === col.key
        ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: col.defaultDir ?? (col.numeric ? 'desc' : 'asc') },
    );
  };

  const renderCityHeader = (col: CityColumnDef) => {
    const active = citySort.key === col.key;
    return (
      <th
        key={col.key}
        className={col.numeric ? 'text-end is-sortable' : 'is-sortable'}
        aria-sort={active ? (citySort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          className={`stats-sort-btn ${col.numeric ? 'stats-sort-btn--end' : ''} ${active ? 'is-active' : ''}`}
          onClick={() => clickCitySort(col)}
        >
          <span>{t(col.label)}</span>
          {active && (
            <span className="stats-sort-btn__arrow" aria-hidden="true">
              {citySort.dir === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </button>
      </th>
    );
  };

  /** Localized name of what a city is building; data ids → `data.*.id` keys. */
  const cityNameProduction = (row: CityStatRow): string => {
    const isWonder = row.producingKind === 'building' && !!WONDER_PROPERTIES[row.producingKey];
    if (isWonder) return tWonderName(row.producingKey, row.producingNameFallback);
    return row.producingKind === 'unit'
      ? tUnitName(row.producingKey, row.producingNameFallback)
      : tBuildingName(row.producingKey, row.producingNameFallback);
  };

  const fmtSigned = (n: number): string => (n > 0 ? `+${n}` : String(n));

  // ── Players tab data (devMode only) ─────────────────────────────────
  const playerStats = useMemo(
    () =>
      civilizations.map(c => {
        const pop = realPopulation(c.id, cities);
        const civCities = cities.filter(ci => ci.civilizationId === c.id);
        // Units the store still knows about: everything alive on the board.
        const alive = units.filter(u => u.civilizationId === c.id);
        const field = alive.filter(u => (u.attack ?? 0) > 0);
        const ledger = gameEngine?.getUnitLedger?.(c.id);
        return {
          civ: c,
          cityCount: civCities.length,
          pop,
          score: numberValue(c.score) || civCities.length * 10 + pop * 2,
          units: alive.length,
          // Military only — a settler count would say nothing about strength.
          military: field.length,
          // What the ledger knows and the board no longer does: the units that
          // are gone. `lost` is combat, `disbanded` is a treasury that could
          // not feed them, and the two tell very different stories.
          lost: ledger?.lost ?? 0,
          disbanded: ledger?.disbanded ?? 0,
          techs: Array.isArray(c.technologies) ? c.technologies.length : 0,
          gold: Math.round(numberValue(c.resources?.gold)),
          strength: Math.round(gameEngine?.diplomacyManager?.estimateMilitaryStrength?.(c.id) ?? 0),
        };
      }).sort((a, b) => b.score - a.score),
    [civilizations, cities, units, gameEngine],
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

          {/* ── Cities — every city the player owns, sortable columns ─────── */}
          <Tab eventKey="cities" title={t('stats.tabCities' as TranslationKey)}>
            {cityRows.length > 0 ? (
              <div className="gm-section gm-section--flush">
                <div className="stats-table-head">
                  <span className="gm-chip gm-chip--accent">{currentPlayer?.name}</span>
                  <span className="stats-table-head__hint">{t('stats.citiesHint' as TranslationKey)}</span>
                </div>
                <div className="table-responsive">
                  <Table
                    variant="dark"
                    size="sm"
                    className="mb-0 align-middle stats-table stats-table--cities"
                    aria-label={t('stats.tabCities' as TranslationKey)}
                  >
                    <thead>
                      <tr>{CITY_COLUMNS.map(renderCityHeader)}</tr>
                    </thead>
                    <tbody>
                      {sortedCityRows.map((row, i) => {
                        const starving = row.foodSurplus < 0;
                        return (
                          <tr key={row.city.id} className={i % 2 === 0 ? 'table-active' : ''}>
                            <td className="text-nowrap">
                              <span className="fw-semibold text-white">{row.name}</span>
                              {row.isCapital && (
                                <span className="badge bg-secondary ms-1">{t('stats.badgeCapital' as TranslationKey)}</span>
                              )}
                              {row.disorder && (
                                <span className="badge bg-danger ms-1">{t('stats.badgeDisorder' as TranslationKey)}</span>
                              )}
                            </td>
                            <td className="text-end">{row.population}</td>
                            <td className="stats-cell--producing">
                              {row.producingKey ? (
                                <>
                                  <span className="me-1" aria-hidden="true">{row.producingIcon}</span>
                                  {cityNameProduction(row)}
                                </>
                              ) : (
                                <span className="text-white-50">—</span>
                              )}
                            </td>
                            <td className="text-end">
                              {row.turnsLeft === null ? <span className="text-white-50">—</span> : row.turnsLeft}
                            </td>
                            <td className="text-end">{row.productionPerTurn}</td>
                            <td className={`text-end ${row.foodSurplus < 0 ? 'stats-cell--warning' : undefined}`}>
                              {fmtSigned(row.foodSurplus)}
                            </td>
                            <td className={`text-end ${starving ? 'stats-cell--warning' : undefined}`}>
                              {row.foodSurplus > 0 ? (
                                Math.max(1, row.growthTurns)
                              ) : starving ? (
                                <span
                                  title={
                                    row.starvationTurns > 0
                                      ? t('stats.starvingTurns' as TranslationKey, { turns: row.starvationTurns })
                                      : t('stats.starvingNow' as TranslationKey)
                                  }
                                >
                                  ⚠{row.starvationTurns > 0 ? ` ${row.starvationTurns}` : ''}
                                </span>
                              ) : (
                                <span className="text-white-50">—</span>
                              )}
                            </td>
                            <td className="text-end">{row.trade}</td>
                            <td className="text-end">{row.gold}</td>
                            <td className="text-end">{row.science}</td>
                            <td className="text-end">{row.buildings}</td>
                            {/* A city without a garrison holds no happy citizens
                                and no walls — flag it right in the table. */}
                            <td className={`text-end ${row.garrison === 0 ? 'stats-cell--warning' : undefined}`}>
                              {row.garrison}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="gm-section">
                <div className="gm-prose stats-empty">{t('stats.emptyCities' as TranslationKey)}</div>
              </div>
            )}
          </Tab>

          {/* ── Players (devMode only) ─────────────────────────────────── */}
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
                        <th>{t('stats.colUnits' as TranslationKey)}</th>
                        <th>{t('stats.colMilitary' as TranslationKey)}</th>
                        <th>{t('stats.colLost' as TranslationKey)}</th>
                        <th>{t('stats.colDisbanded' as TranslationKey)}</th>
                        <th>{t('stats.colTechs' as TranslationKey)}</th>
                        <th>{t('stats.colGold' as TranslationKey)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerStats.map((row) => (
                        <tr key={row.civ.id}>
                          <td>
                            <span className="me-2" style={{ color: row.civ.color }}>●</span>
                            {row.civ.name}
                            {row.civ.id === currentPlayer?.id && <span className="badge bg-primary ms-2">{t('stats.badgeYou' as TranslationKey)}</span>}
                          </td>
                          <td>
                            {row.civ.isAlive === false
                              ? <span className="badge bg-danger">{t('stats.badgeOut' as TranslationKey)}</span>
                              : <span className="badge bg-success">{t('stats.badgeAlive' as TranslationKey)}</span>}
                          </td>
                          <td>{Number.isInteger(row.score) ? row.score.toLocaleString() : row.score.toFixed(1)}</td>
                          <td>{row.cityCount.toLocaleString()}</td>
                          <td>{row.pop.toLocaleString()}</td>
                          <td>{row.units.toLocaleString()}</td>
                          <td>{row.military.toLocaleString()}</td>
                          {/* Combat losses — red when they outnumber the army
                              still standing, which is a civ about to fall. */}
                          <td className={row.lost > row.military ? 'stats-cell--warning' : undefined}>
                            {row.lost.toLocaleString()}
                          </td>
                          {/* Disbanded is not a battle: amber, because it
                              means the treasury failed the army. */}
                          <td className={row.disbanded > 0 ? 'stats-cell--cost' : undefined}>
                            {row.disbanded.toLocaleString()}
                          </td>
                          <td>{row.techs}</td>
                          <td>{row.gold.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                {playerStats.length === 0 && (
                  <div className="gm-prose stats-empty">{t('stats.emptyWorld' as TranslationKey)}</div>
                )}
                <div className="gm-note">{t('stats.playersHint' as TranslationKey)}</div>
              </div>
            </Tab>
          )}
        </Tabs>
      </div>
    </GameModal>
  );
};

export default StatisticsModal;
