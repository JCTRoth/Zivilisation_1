/**
 * DisasterManager — Civ1's seven city disasters, retuned for a modern player.
 *
 * Civ1 rolls a disaster for a random city during turn processing, and with a
 * decent-sized empire the player meets one most turns — usually a flood — which
 * turns a rare catastrophe into background noise. This manager keeps the
 * disasters and their prevention rules, and changes only the clock and the
 * punch:
 *
 *  - FAR RARER. Every chance below is per city per turn, and the sum is
 *    below 0.5% — around one disaster per 230 eligible city-turns. A twenty-
 *    city empire sees a disaster roughly every twelve turns; a single flood in
 *    that empire is a once-in-a-hundred-turns event. (Civ1's own rates put a
 *    flood somewhere almost every turn.)
 *  - A LITTLE HARDER. The population losses are the manual's percentages
 *    raised a notch (25 → 33, 33 → 40), and the secondary losses land in full:
 *    fires and earthquakes destroy a building, volcano eruptions both kill
 *    and burn, pirates empty the food AND shield stores while robbing the
 *    treasury.
 *  - CITIES ONLY, NEVER UNITS. Every disaster targets the city. Military
 *    units — ancient levies or mechanised infantry — are never damaged or
 *    destroyed by a flood, an eruption or any other event here. A disaster
 *    that randomly erased an army was never in Civ1, and it is not in this
 *    game either: randomness belongs in the city ledger, not in the order of
 *    battle.
 *
 * The Civ1 rule set, as implemented (trigger → prevention):
 *
 *  disaster     trigger                                   prevention
 *  ----------   ---------------------------------------   --------------------
 *  famine       size ≥ 2, Pottery known                   Granary
 *  flood        on / next to a River, Masonry known       City Walls
 *  fire         size ≥ 2, Construction, a building        Aqueduct
 *  plague       size ≥ 2, Construction known              Aqueduct or Medicine
 *  pirates      next to Ocean                             Barracks
 *  volcano      on / next to Mountains, Ceremonial        Temple
 *               Burial known
 *  earthquake   next to Hills, a building                 none (geography only)
 *
 * Wonders and the Palace can never be destroyed by a disaster; and a disaster
 * never removes the last citizen — a city may be humbled, never erased.
 *
 * Every city rolls at most one disaster per turn. The kinds are tested in a
 * fixed order (DISASTER_CHECK_ORDER) and the first hit lands, so the roll is
 * deterministic under a stubbed `random` and two catastrophes cannot
 * stack on the same city in the same turn.
 */

import { BUILDING_TYPES } from '../../data/BuildingConstants';
import { TERRAIN_TYPES } from '../../data/TerrainConstants';
import { isWonderId } from '../../data/WonderData';
import type { City, Civilization } from '../../../types/game';
import type GameEngine from './GameEngine';
import { isPalaceBuilding, storedBuildingId } from './BuildingEffects';

export type CityDisasterKind =
  | 'famine'
  | 'flood'
  | 'fire'
  | 'plague'
  | 'pirates'
  | 'volcano'
  | 'earthquake';

/**
 * Chance per eligible city per turn that THIS disaster strikes. The flood is
 * deliberately the rarest of the seven — it was the one that pestered the
 * player in Civ1 — and the total is well under half a percent.
 */
export const DISASTER_CHANCE_PER_CITY_TURN: Record<CityDisasterKind, number> = {
  famine: 0.0009,
  flood: 0.0004,
  fire: 0.0008,
  plague: 0.0007,
  pirates: 0.0007,
  volcano: 0.0004,
  earthquake: 0.0004,
};

/**
 * Share of the city's population lost when the disaster lands. Civ1's
 * percentages (25/33) raised a notch — rare events are allowed teeth — and
 * every loss is at least one citizen.
 */
export const DISASTER_POPULATION_SHARE: Partial<Record<CityDisasterKind, number>> = {
  famine: 0.4,
  flood: 0.33,
  plague: 0.33,
  volcano: 0.4,
};

/**
 * The fixed test order. A city checks each eligible, unprevented disaster in
 * this order and stops at the first hit — at most one disaster per city per
 * turn, and a deterministic sequence for tests.
 */
export const DISASTER_CHECK_ORDER: readonly CityDisasterKind[] = [
  'famine',
  'flood',
  'fire',
  'plague',
  'pirates',
  'volcano',
  'earthquake',
];

/** Pirates take the larger of this share of the treasury and the floor. */
const PIRATE_GOLD_SHARE = 0.1;
export const PIRATE_GOLD_FLOOR = 20;

/** What one landed disaster did — the payload of the `CITY_DISASTER` event. */
export interface CityDisasterResult {
  kind: CityDisasterKind;
  /** Citizens lost (0 for fires, earthquakes and empty pirate raids). */
  lostPopulation: number;
  /** Id of the building destroyed, or null. */
  destroyedBuilding: string | null;
  /** Gold taken from the treasury, or 0. */
  goldStolen: number;
}

/** The stored building ids of a city, tolerant of array and Set storage. */
function buildingIds(city: City | null | undefined): string[] {
  const stored: unknown = city?.buildings;
  if (stored instanceof Set) {
    return [...stored].map((entry) => storedBuildingId(entry)).filter(Boolean);
  }
  if (Array.isArray(stored)) {
    return stored.map((entry) => storedBuildingId(entry)).filter(Boolean);
  }
  return [];
}

export class DisasterManager {
  /**
   * Source of randomness. Defaults to `Math.random` so production keeps the
   * browser's generator; tests replace it (`engine.disasterManager.random =
   * () => 0`) to drive outcomes without touching the global `Math.random`
   * stream that seeded AI tests depend on.
   */
  random: () => number = Math.random;
  private gameEngine: GameEngine;

  constructor(gameEngine: GameEngine) {
    this.gameEngine = gameEngine;
    // A private stream: production never touches the global Math.random, so
    // seeded AI tests (which pin Math.random) are not perturbed by disasters
    // running during turn processing. Tests drive outcomes by replacing
    // `this.random`.
    let a = (Date.now() ^ 0x9e3779b9) >>> 0;
    this.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Roll the seven disasters for one city. Called at the end of the city's
   * turn processing — growth and production have both landed, so a loss is
   * felt on the turn it arrives. Returns the disaster that struck (for tests
   * and callers that want to react), or null for an ordinary turn.
   */
  processCity(city: City, civ: Civilization | null | undefined): CityDisasterResult | null {
    if (!city || !civ) return null;
    // Barbarians (id -1) live outside the disaster system: their camps are
    // spawned and razed by the raider AI, and a famine there would be noise.
    if ((city.civilizationId ?? 0) < 0) return null;
    // The manual's own framing: disasters target established cities, size 2+.
    if (Math.max(1, city.population ?? 1) < 2) return null;

    for (const kind of DISASTER_CHECK_ORDER) {
      if (!this.canStrike(kind, city, civ)) continue;
      if (this.isPrevented(kind, city, civ)) continue;
      if (this.random() >= DISASTER_CHANCE_PER_CITY_TURN[kind]) continue;
      return this.strike(kind, city, civ);
    }
    return null;
  }

  // ── Triggers ────────────────────────────────────────────────────────────

  /** Whether the city meets a disaster's geographic / civic conditions. */
  private canStrike(kind: CityDisasterKind, city: City, civ: Civilization): boolean {
    switch (kind) {
      case 'famine':
        return this.hasTechnology(civ, 'pottery');
      case 'flood':
        return this.hasRiverAccess(city) && this.hasTechnology(civ, 'masonry');
      case 'fire':
        return this.hasTechnology(civ, 'construction') && this.destroyableBuildings(city).length > 0;
      case 'plague':
        return this.hasTechnology(civ, 'construction');
      case 'pirates':
        // The city must have something to plunder: a treasury or a store.
        return this.hasOceanAccess(city)
          && ((civ.resources?.gold ?? 0) > 0
            || (city.foodStored ?? 0) > 0
            || (city.productionStored ?? 0) > 0);
      case 'volcano':
        return this.hasTerrainNear(city, TERRAIN_TYPES.MOUNTAINS)
          && this.hasTechnology(civ, 'ceremonial_burial');
      case 'earthquake':
        return this.hasTerrainNear(city, TERRAIN_TYPES.HILLS)
          && this.destroyableBuildings(city).length > 0;
      default:
        return false;
    }
  }

  /** The buildings a fire or an earthquake is allowed to claim. */
  private destroyableBuildings(city: City): string[] {
    return buildingIds(city).filter((id) => !isWonderId(id) && !isPalaceBuilding(id));
  }

  // ── Prevention ──────────────────────────────────────────────────────────

  /**
   * Whether a building or a technology turns the disaster away entirely. A
   * prevented disaster is skipped before its roll — the city is simply immune.
   */
  private isPrevented(kind: CityDisasterKind, city: City, civ: Civilization): boolean {
    switch (kind) {
      case 'famine':
        return this.hasBuilding(city, BUILDING_TYPES.GRANARY);
      case 'flood':
        return this.hasBuilding(city, BUILDING_TYPES.CITY_WALLS);
      case 'fire':
        return this.hasBuilding(city, BUILDING_TYPES.AQUEDUCT);
      case 'plague':
        return this.hasBuilding(city, BUILDING_TYPES.AQUEDUCT)
          || this.hasTechnology(civ, 'medicine');
      case 'pirates':
        return this.hasBuilding(city, BUILDING_TYPES.BARRACKS);
      case 'volcano':
        return this.hasBuilding(city, BUILDING_TYPES.TEMPLE);
      case 'earthquake':
        // No building stops an earthquake; the only defence is geography.
        return false;
      default:
        return false;
    }
  }

  // ── Effects ─────────────────────────────────────────────────────────────

  /** Apply one disaster, emit the event, and report what it did. */
  private strike(kind: CityDisasterKind, city: City, civ: Civilization): CityDisasterResult {
    const result: CityDisasterResult = {
      kind,
      lostPopulation: 0,
      destroyedBuilding: null,
      goldStolen: 0,
    };

    switch (kind) {
      case 'famine':
        result.lostPopulation = this.losePopulation(city, DISASTER_POPULATION_SHARE.famine ?? 0.4);
        // The stores are emptied — the same "portion of stored food" the
        // Granary is credited with saving.
        city.foodStored = 0;
        break;
      case 'flood':
      case 'plague':
        result.lostPopulation = this.losePopulation(city, DISASTER_POPULATION_SHARE[kind] ?? 0.33);
        break;
      case 'fire':
        result.destroyedBuilding = this.destroyRandomBuilding(city);
        break;
      case 'pirates':
        result.goldStolen = this.stealGold(civ);
        city.foodStored = 0;
        city.productionStored = 0;
        city.productionProgress = 0;
        city.carriedOverProgress = 0;
        break;
      case 'volcano':
        result.lostPopulation = this.losePopulation(city, DISASTER_POPULATION_SHARE.volcano ?? 0.4);
        result.destroyedBuilding = this.destroyRandomBuilding(city);
        break;
      case 'earthquake':
        result.destroyedBuilding = this.destroyRandomBuilding(city);
        break;
      default:
        break;
    }

    this.gameEngine.onStateChange?.('CITY_DISASTER', {
      city,
      civilizationId: city.civilizationId,
      ...result,
    });
    return result;
  }

  /**
   * Shrink a city by a share of its population. Never below one citizen, and
   * never a fractional kill — a size-2 city hit by famine loses one. The dead
   * citizens' tiles are released the same way starvation releases them.
   */
  private losePopulation(city: City, share: number): number {
    const population = Math.max(1, city.population ?? 1);
    const raw = Math.max(1, Math.floor(population * share));
    const loss = Math.min(raw, population - 1);
    if (loss <= 0) return 0;
    city.population = population - loss;
    // The growth threshold moves with the population — the same bookkeeping
    // starvation does, so the city screen never shows a stale target.
    city.foodNeeded = (city.population + 1) * 10;
    this.gameEngine.economicManager?.fitCityToPopulation(city);
    return loss;
  }

  /**
   * Burn one random building. Wonders and the Palace are exempt: a random
   * event may humble an empire's industry, never un-build its history.
   * Returns the destroyed id, or null when nothing was eligible.
   */
  private destroyRandomBuilding(city: City): string | null {
    const candidates = this.destroyableBuildings(city);
    if (candidates.length === 0) return null;
    const id = candidates[Math.floor(this.random() * candidates.length)];
    const stored: unknown = city.buildings;
    if (stored instanceof Set) {
      stored.delete(id);
    } else if (Array.isArray(stored)) {
      const index = stored.findIndex((entry) => storedBuildingId(entry) === id);
      if (index >= 0) stored.splice(index, 1);
    }
    return id;
  }

  /** Lift a tenth of the treasury (at least 20 gold) if there is any. */
  private stealGold(civ: Civilization): number {
    const treasury = Math.max(0, civ.resources?.gold ?? 0);
    if (treasury <= 0) return 0;
    const stolen = Math.min(treasury, Math.max(PIRATE_GOLD_FLOOR, Math.ceil(treasury * PIRATE_GOLD_SHARE)));
    civ.resources.gold = treasury - stolen;
    return stolen;
  }

  // ── Lookups ─────────────────────────────────────────────────────────────

  private hasBuilding(city: City, buildingId: string): boolean {
    return buildingIds(city).includes(buildingId);
  }

  private hasRiverAccess(city: City): boolean {
    return this.gameEngine.tileHasRiverAccess?.(city.col, city.row) ?? false;
  }

  private hasOceanAccess(city: City): boolean {
    return this.gameEngine.tileHasOceanAccess?.(city.col, city.row) ?? false;
  }

  /** True when one of the eight neighbours is the given terrain. */
  private hasTerrainNear(city: City, terrain: string): boolean {
    for (let dCol = -1; dCol <= 1; dCol++) {
      for (let dRow = -1; dRow <= 1; dRow++) {
        if (dCol === 0 && dRow === 0) continue;
        const tile = this.gameEngine.getTileAt(city.col + dCol, city.row + dRow) as
          | { type?: string; terrain?: string }
          | null;
        const key = String(tile?.type ?? tile?.terrain ?? '').trim().toLowerCase();
        if (key === terrain) return true;
      }
    }
    return false;
  }

  /**
   * The civ's tech list first, the shared tree's union flag as a fallback —
   * the same lookup GameEngine uses for building and unit requirements.
   */
  private hasTechnology(civ: Civilization, techId: string): boolean {
    if (Array.isArray(civ.technologies) && civ.technologies.includes(techId)) return true;
    const tech = this.gameEngine.technologies?.find((entry) => entry.id === techId);
    return !!tech?.researched;
  }
}
