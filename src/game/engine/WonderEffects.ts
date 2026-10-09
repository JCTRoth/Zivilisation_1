/**
 * WonderEffects — the effect engine for the 25 World Wonders.
 *
 * Pure computation: given the current game state it answers "how much does
 * wonder X contribute to this city / civ right now?". Obsolescence is checked
 * live, so effects stop the instant any civilization discovers the
 * obsolescence technology, and start again never (wonders are not rebuilt).
 *
 * The engine-bound class wraps the scope logic (city / civilization /
 * continent / global); the exported pure functions need only plain
 * cities + civilizations arrays and are used by the React store as well.
 */

import type GameEngine from './GameEngine';
import type { City, Civilization } from '../../../types/game';
import {
  getWonder,
  isWonderObsolete,
  wondersInCity,
  type WonderDefinition,
  type WonderEffect,
} from '@/data/WonderData';

// ---------------------------------------------------------------------------
// Pure helpers (no engine needed — safe for the zustand store)
// ---------------------------------------------------------------------------

type EffectsOf<K extends WonderEffect['kind']> = Extract<WonderEffect, { kind: K }>;

/**
 * Effects of `kind` from wonders that `civId` owns AND that are not obsolete
 * anywhere in the world. Only scope 'city'/'civilization'/'global' effects are
 * returned here — continent scope needs the map and lives in the class.
 */
function civWonderEffects<K extends WonderEffect['kind']>(
  kind: K,
  cities: City[],
  civilizations: Civilization[],
  civId: number,
): Array<EffectsOf<K>> {
  const result: Array<EffectsOf<K>> = [];
  for (const city of cities) {
    if (city.civilizationId !== civId) continue;
    for (const id of wondersInCity(city)) {
      if (isWonderObsolete(id, civilizations)) continue;
      const wonder = getWonder(id);
      if (!wonder) continue;
      for (const effect of wonder.effects) {
        if (effect.kind === kind) result.push(effect as EffectsOf<K>);
      }
    }
  }
  return result;
}

/** +N vision range for a civ's units/cities from the Silk Road. */
export function computeVisionRangeBonus(
  cities: City[],
  civilizations: Civilization[],
  civId: number,
): number {
  return civWonderEffects('visionRange', cities, civilizations, civId).reduce(
    (sum, e) => sum + e.amount,
    0,
  );
}

/** +N movement for a civ's sea units (Lighthouse, Magellan's Expedition). */
function computeNavalMoveBonus(
  cities: City[],
  civilizations: Civilization[],
  civId: number,
): number {
  return civWonderEffects('navalMovement', cities, civilizations, civId).reduce(
    (sum, e) => sum + e.amount,
    0,
  );
}

/** Does the civ see every city on the map (active International Space Station)? */
export function computeSeesAllCities(
  cities: City[],
  civilizations: Civilization[],
  civId: number,
): boolean {
  return civWonderEffects('revealAllCities', cities, civilizations, civId).length > 0;
}

/** Any civ that has the tech may build nukes once the Manhattan Project exists. */
export function computeNuclearAllowed(
  cities: City[],
  civilizations: Civilization[],
): boolean {
  const builtSomewhere = cities.some((c) => (c.buildings ?? []).includes('manhattan_project'));
  return builtSomewhere && !isWonderObsolete('manhattan_project', civilizations);
}

/** The space race (Moonshot) opens for everyone once the ISS exists. */
export function computeSpaceshipEnabled(
  cities: City[],
  civilizations: Civilization[],
): boolean {
  const builtSomewhere = cities.some((c) => (c.buildings ?? []).includes('international_space_station'));
  return builtSomewhere && !isWonderObsolete('international_space_station', civilizations);
}

// ---------------------------------------------------------------------------
// Engine-bound effect engine
// ---------------------------------------------------------------------------

export class WonderEffects {
  constructor(private readonly gameEngine: GameEngine) {}

  private get cities(): City[] {
    return this.gameEngine.cities ?? [];
  }

  private get civilizations(): Civilization[] {
    return this.gameEngine.civilizations ?? [];
  }

  /** Wonders `civId` owns that are still active (not obsolete). */
  activeWondersOf(civId: number): WonderDefinition[] {
    const result: WonderDefinition[] = [];
    for (const city of this.cities) {
      if (city.civilizationId !== civId) continue;
      for (const id of wondersInCity(city)) {
        const wonder = getWonder(id);
        if (wonder && !isWonderObsolete(id, this.civilizations)) result.push(wonder);
      }
    }
    return result;
  }

  private landmassOf(city: City): number {
    try {
      return this.gameEngine.getLandmassId?.(city.col, city.row) ?? -1;
    } catch {
      return -1;
    }
  }

  /**
   * Whether a wonder effect (sitting in `wonderCity`) affects `city`.
   *  - city: same city object
   *  - civilization: any city of the owner
   *  - continent: owner's cities on the wonder's landmass
   */
  private covers(effect: WonderEffect, city: City, wonderCity: City): boolean {
    switch (effect.scope) {
      case 'city':
        return city.id === wonderCity.id;
      case 'civilization':
        return city.civilizationId === wonderCity.civilizationId;
      case 'continent':
        return (
          city.civilizationId === wonderCity.civilizationId &&
          this.landmassOf(city) >= 0 &&
          this.landmassOf(city) === this.landmassOf(wonderCity)
        );
      case 'global':
        return false; // gates are handled separately
      default:
        return false;
    }
  }

  /** Every active effect that applies to `city`, paired with its wonder. */
  private effectsForCity(city: City): Array<{ wonder: WonderDefinition; effect: WonderEffect }> {
    const out: Array<{ wonder: WonderDefinition; effect: WonderEffect }> = [];
    for (const wonder of this.activeWondersOf(city.civilizationId)) {
      const wonderCity = this.findWonderCityOf(wonder.id);
      if (!wonderCity) continue;
      for (const effect of wonder.effects) {
        if (this.covers(effect, city, wonderCity)) {
          out.push({ wonder, effect });
        }
      }
    }    return out;
  }

  private findWonderCityOf(wonderId: string): City | null {
    return this.cities.find((c) => (c.buildings ?? []).includes(wonderId)) ?? null;
  }

  // ── Science ─────────────────────────────────────────────────────────────

  /** Combined science multiplier for one city, e.g. 1.1 = +10%, 2 = double. */
  scienceMultiplierForCity(city: City): number {
    if (!city) return 1;
    let percent = 0;
    for (const { effect } of this.effectsForCity(city)) {
      if (effect.kind === 'sciencePercent') percent += effect.percent;
    }
    return 1 + percent / 100;
  }

  /**
   * Multiplier for the science one specific building grants (Newton's College
   * doubles Libraries and Universities). 1 when no wonder applies.
   */
  buildingScienceMultiplier(city: City, buildingId: string): number {
    if (!city) return 1;
    let multiplier = 1;
    for (const { effect } of this.effectsForCity(city)) {
      if (effect.kind === 'buildingScienceMultiplier' && effect.buildings.includes(buildingId)) {
        multiplier *= effect.multiplier;
      }
    }
    return multiplier;
  }

  // ── Trade ───────────────────────────────────────────────────────────────

  /** Extra trade granted on every trade square of this city (Colossus / Statue of Liberty). */
  tradePerTradeSquareForCity(city: City): number {
    if (!city) return 0;
    let amount = 0;
    for (const { effect } of this.effectsForCity(city)) {
      if (effect.kind === 'tradePerTradeSquare') amount += effect.amount;
    }
    return amount;
  }

  // ── Production (Hoover Dam / AI Supercluster) ───────────────────────────

  /** Flat + percent production modifiers for one city. */
  productionBonusForCity(city: City): { flat: number; percent: number } {
    const result = { flat: 0, percent: 0 };
    if (!city) return result;
    const hasPowerPlant = ['power_plant', 'hydro_plant', 'nuclear_plant'].some((b) =>
      (city.buildings ?? []).includes(b),
    );
    for (const { effect } of this.effectsForCity(city)) {
      if (effect.kind === 'productionFlat') {
        if (effect.requiresNoPowerPlant && hasPowerPlant) continue;
        result.flat += effect.amount;
      } else if (effect.kind === 'productionPercent') {
        result.percent += effect.percent;
      }
    }
    return result;
  }

  // ── Happiness ───────────────────────────────────────────────────────────

  /** Flat happiness a wonder grants this city (Human Genome Project, Hanging Gardens, Transistor). */
  happinessForCity(city: City): number {
    if (!city) return 0;
    let amount = 0;
    for (const { effect } of this.effectsForCity(city)) {
      if (effect.kind === 'happiness') amount += effect.amount;
    }
    return amount;
  }

  /** Unhappy citizens made content in this city (Bach / Shakespeare's Theatre). */
  unhappyToContentForCity(city: City): number {
    if (!city) return 0;
    let amount = 0;
    for (const { effect } of this.effectsForCity(city)) {
      if (effect.kind === 'unhappyToContent') amount += effect.amount;
    }
    return amount;
  }

  /** Happiness multiplier for one building type (Oracle ×2 Temple, Michelangelo ×1.5 Cathedral). */
  buildingHappinessMultiplier(city: City, buildingId: string): number {
    if (!city) return 1;
    let multiplier = 1;
    for (const { effect } of this.effectsForCity(city)) {
      if (effect.kind === 'buildingHappinessMultiplier' && effect.buildingType === buildingId) {
        multiplier *= effect.multiplier;
      }
    }
    return multiplier;
  }

  // ── Per-civ modifiers ───────────────────────────────────────────────────

  /** +N movement for the civ's sea units. */
  navalMoveBonus(civId: number): number {
    return computeNavalMoveBonus(this.cities, this.civilizations, civId);
  }

  /** +N vision range for the civ's units and cities. */
  visionBonus(civId: number): number {
    return computeVisionRangeBonus(this.cities, this.civilizations, civId);
  }

  /** Anarchy length for this civ: 1 with the Pyramids, otherwise `baseTurns`. */
  anarchyTurns(civId: number, baseTurns: number): number {
    const effects = civWonderEffects('governmentAnarchyTurns', this.cities, this.civilizations, civId);
    if (effects.length === 0) return baseTurns;
    return Math.min(baseTurns, ...effects.map((e) => e.turns));
  }

  /** Leonardo's Workshop: obsolete units upgrade automatically. */
  autoUpgradeUnits(civId: number): boolean {
    return civWonderEffects('autoUpgradeUnits', this.cities, this.civilizations, civId).length > 0;
  }

  /** The civ sees every city on the map (active ISS). */
  seesAllCities(civId: number): boolean {
    return computeSeesAllCities(this.cities, this.civilizations, civId);
  }

  // ── Global gates ────────────────────────────────────────────────────────

  /** Nuclear weapons allowed for civs with the tech (Manhattan Project built). */
  nuclearAllowed(): boolean {
    return computeNuclearAllowed(this.cities, this.civilizations);
  }

  /** Space race open for everyone (ISS built) — gates the Moonshot tech. */
  spaceshipEnabled(): boolean {
    return computeSpaceshipEnabled(this.cities, this.civilizations);
  }
}
