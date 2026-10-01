import type { Unit, City } from '../../../types/game';
import GameEngine from './GameEngine';
import { UNIT_PROPS } from '@/utils/Constants';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import { debugLog } from '../../utils/DevLog';

/**
 * Barbarian AI — "Forge of War" aggressive controller for the phantom
 * barbarian civ (id −1). Barbarians form war bands that scout together,
 * evaluate city strength, and attack when the horde can overwhelm the
 * defenders.
 *
 * Behaviour (runs once per round):
 *  1. Activate all barbarian units (reset move budget).
 *  2. Evaluate targets: find the weakest enemy city and compare its
 *     defense to the horde's total strength.
 *  3. If horde strength ≥ 1.5× city defense → full assault (all converge).
 *  4. Otherwise → scout outward to find cities, avoid strong ones.
 *  5. The moment barbarians hold a city they become a real faction (see
 *     GameEngine.ensureBarbarianCivilization) and the city runs AutoProduction
 *     restricted to MILITARY UNITS ONLY (see AutoProduction).
 */
export class BarbarianManager {
  constructor(private readonly gameEngine: GameEngine) {}

  /** Reset any per-game state when starting a new game. */
  reset(): void {
    // Stateless — everything is derived from the engine's current units/cities.
  }

  /** Called once per round from the turn cycle. */
  processBarbarians(): void {
    const engine = this.gameEngine;
    const units = (engine.units ?? []).filter((u) => u.civilizationId === BARBARIAN_CIV_ID);
    const barbarianCities = (engine.cities ?? []).filter((c) => c.civilizationId === BARBARIAN_CIV_ID);
    if (units.length === 0 && barbarianCities.length === 0) return;

    // Activate all units (reset move budget).
    for (const unit of units) {
      this.activateUnit(unit);
    }

    // Global battlefield assessment.
    const weakest = this.chooseWeakestCity();
    const hordeStrength = this.totalHordeStrength(units);

    // War band decision: attack or scout?
    // "Forge of War" threshold: need 1.5× city defense to assault.
    const ASSAULT_MULTIPLIER = 1.5;
    const shouldAssault = units.length >= 2 && weakest !== null
      && hordeStrength >= weakest.defense * ASSAULT_MULTIPLIER;

    if (shouldAssault) {
      // FORGE OF WAR: all troops converge on the weakest city.
      debugLog(`[BARB] 🔥 FORGE OF WAR — ${units.length} barbarians (str ${hordeStrength.toFixed(1)}) assault ${weakest!.defName ?? 'city'} (def ${weakest!.defense.toFixed(1)})`);
      this.assaultCity(units, weakest!);
    } else {
      // Scout phase: each unit independently scouts for enemy cities/units.
      for (const unit of units) {
        const target = this.nearestEnemyCity(unit) ?? this.nearestEnemyUnit(unit);
        this.act(unit, target);
      }
    }

    // Captured cities: sell everything, produce scouts then raiders.
    this.manageCities(barbarianCities);
  }

  /** Reset a barbarian unit's move budget for this round. */
  private activateUnit(unit: Unit): void {
    const props = UNIT_PROPS[unit.type];
    unit.movesRemaining = props?.movement ?? 1;
    unit.hasMovedThisTurn = false;
    unit.isSkipped = false;
    unit.isFortified = false;
    unit.isSleeping = false;
  }

  /** The weakest enemy city (lowest estimated defense). */
  private chooseWeakestCity(): { col: number; row: number; defense: number; defName?: string } | null {
    const engine = this.gameEngine;
    const cities = (engine.cities ?? []).filter(
      (c: City) => c.civilizationId >= 0 && c.civilizationId !== BARBARIAN_CIV_ID,
    );
    if (cities.length === 0) return null;

    let weakest: { col: number; row: number; defense: number; defName?: string } | null = null;
    for (const city of cities) {
      const defense = this.estimateCityDefense(city);
      if (!weakest || defense < weakest.defense) {
        weakest = { col: city.col, row: city.row, defense, defName: city.name };
      }
    }
    return weakest;
  }

  /** Civ1-style city defense: population (×3 with walls) + nearby garrison. */
  /** Total offensive strength of all barbarian units. */
  private totalHordeStrength(units: Unit[]): number {
    return units.reduce(
      (sum, u) => sum + Math.max(0.5, u.attack ?? 0.5) + (u.defense ?? 0) * 0.3,
      0,
    );
  }

  /**
   * Full assault: all barbarians converge on the target city.
   * Units march in formation — closest units move first for a natural battle line.
   */
  private assaultCity(units: Unit[], target: { col: number; row: number; defense: number }): void {
    const sorted = [...units].sort((a, b) => {
      const da = this.gameEngine.squareGrid?.squareDistance?.(a.col, a.row, target.col, target.row) ?? Infinity;
      const db = this.gameEngine.squareGrid?.squareDistance?.(b.col, b.row, target.col, target.row) ?? Infinity;
      return da - db;
    });
    for (const unit of sorted) {
      this.act(unit, target);
    }
  }

  private estimateCityDefense(city: City): number {
    const engine = this.gameEngine;
    let defense = Math.max(1, city.population ?? 1);
    const hasWalls =
      (city.buildings?.includes?.('city_walls') ?? false) ||
      (city.buildings?.includes?.('walls') ?? false);
    if (hasWalls) defense *= 3;
    if (engine?.squareGrid?.squareDistance) {
      for (const unit of engine.units ?? []) {
        if (unit.civilizationId !== city.civilizationId || unit.civilizationId === BARBARIAN_CIV_ID) continue;
        const dist = engine.squareGrid.squareDistance(unit.col, unit.row, city.col, city.row);
        if (dist <= 2) {
          defense += Math.max(1, unit.attack || 0) + (unit.defense || 0) * 0.5;
        }
      }
    }
    return defense;
  }

  private nearestEnemyCity(unit: Unit): { col: number; row: number } | null {
    const engine = this.gameEngine;
    let best: { col: number; row: number; dist: number } | null = null;
    for (const city of engine.cities ?? []) {
      if (city.civilizationId < 0 || city.civilizationId === BARBARIAN_CIV_ID) continue;
      const dist = engine.squareGrid?.squareDistance?.(unit.col, unit.row, city.col, city.row) ?? Infinity;
      if (!best || dist < best.dist) best = { col: city.col, row: city.row, dist };
    }
    return best ? { col: best.col, row: best.row } : null;
  }

  private nearestEnemyUnit(unit: Unit): { col: number; row: number } | null {
    const engine = this.gameEngine;
    let best: { col: number; row: number; dist: number } | null = null;
    for (const other of engine.units ?? []) {
      if (other.civilizationId < 0 || other.civilizationId === BARBARIAN_CIV_ID) continue;
      const dist = engine.squareGrid?.squareDistance?.(unit.col, unit.row, other.col, other.row) ?? Infinity;
      if (!best || dist < best.dist) best = { col: other.col, row: other.row, dist };
    }
    return best ? { col: best.col, row: best.row } : null;
  }

  /** One unit's turn: attack adjacent threats, otherwise step toward target. */
  private act(unit: Unit, target: { col: number; row: number } | null): void {
    const engine = this.gameEngine;
    if ((unit.movesRemaining ?? 0) <= 0 || unit.isDefeated) return;
    const neighbors = engine.squareGrid?.getNeighbors?.(unit.col, unit.row) ?? [];

    // 1. Attack an adjacent enemy unit.
    for (const n of neighbors) {
      const enemy = engine.getUnitAt?.(n.col, n.row);
      if (enemy && enemy.civilizationId !== BARBARIAN_CIV_ID && !enemy.isDefeated) {
        debugLog(`[BARB] ${unit.type} attacks enemy ${enemy.type} at (${n.col},${n.row})`);
        engine.combatUnit?.(unit, enemy);
        return; // spent the move either way
      }
    }

    // 2. Assault an adjacent enemy city (moveUnit resolves the capture).
    for (const n of neighbors) {
      const city = engine.getCityAt?.(n.col, n.row);
      if (city && city.civilizationId !== BARBARIAN_CIV_ID) {
        debugLog(`[BARB] ${unit.type} assaults city ${city.name} at (${n.col},${n.row})`);
        engine.moveUnit?.(unit.id, n.col, n.row);
        return;
      }
    }

    // 3. Otherwise take one pathfinding step toward the target.
    if (!target) return;
    const path = engine.squareGrid?.findPath?.(
      unit.col,
      unit.row,
      target.col,
      target.row,
      new Set<string>(),
      engine.getPassabilityFilter?.(),
    );
    if (path && path.length > 1) {
      const next = path[1];
      engine.moveUnit?.(unit.id, next.col, next.row);
    }
  }

  /**
   * Barbarian-held cities run AutoProduction restricted to military units
   * (AutoProduction.buildBarbarianMilitaryProduction) and are advanced here
   * once per round, because the barbarian faction does not take a normal turn.
   *  - "sell everything": no buildings survive barbarian occupation.
   *  - shields accumulate and the finished military unit spawns.
   */
  private manageCities(cities: City[]): void {
    const engine = this.gameEngine;

    // The moment barbarians hold a city they count as a faction in the game.
    if (cities.length > 0) {
      engine.ensureBarbarianCivilization?.();
    }

    // AutoProduction picks what each city builds (military units only). It
    // only touches cities with autoProduction enabled.
    for (const city of cities) {
      city.autoProduction = true;
    }
    engine.autoProduction?.processAutoProductionForCivilization?.(BARBARIAN_CIV_ID);

    // Apply shields and spawn the finished unit (once per round).
    for (const city of cities) {
      // Sell everything — raiders, not improvements.
      if (Array.isArray(city.buildings) && city.buildings.length > 0) {
        debugLog(`[BARB] Selling ${city.buildings.length} building(s) in ${city.name}`);
        city.buildings = [];
      }

      if (!city.currentProduction) {
        continue; // auto-production found nothing to build
      }

      // Apply the city's shields.
      const gross = Math.max(1, city.yields?.production ?? city.population ?? 1);
      city.productionStored = (city.productionStored ?? 0) + gross;
      city.productionProgress = city.productionStored;

      if (city.productionStored >= (city.currentProduction.cost ?? 10)) {
        const item = city.currentProduction;
        city.productionStored = 0;
        city.productionProgress = 0;
        debugLog(`[BARB] ${city.name} produced ${item.itemType}`);
        engine.spawnBarbarianUnit?.(item.itemType, city.col, city.row);
        city.currentProduction = null; // re-picked next round by auto-production
      }
    }
  }
}
