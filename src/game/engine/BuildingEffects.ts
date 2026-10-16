/**
 * BuildingEffects — the effect engine for regular buildings.
 *
 * The parallel of `WonderEffects`: it reads the `effects` record DECLARED in
 * `BUILDING_PROPERTIES` and turns it into game rules. Before this module the
 * engine either ignored a declared effect entirely (`production`, `culture`,
 * `health`, `growthBonus`) or reacted to the building's hardcoded id while
 * ignoring the declared value (`city_walls`, `granary`, `barracks`,
 * `sdi_defense`, `aqueduct`, `palace`) — so "City Walls: defense 2" was really
 * "if id === 'city_walls'".
 *
 * Semantics of the wired effects (each one documented where it is consumed):
 *
 *  - `production: N`      — flat +N shields per turn for the city.
 *  - `unitProduction: N`  — extra +N shields while the city builds a combat
 *                           unit (Barracks: military units roll out faster).
 *  - `veteranUnits: true` — combat units built here start Seasoned.
 *  - `foodStorage: N`     — on growth, keep `N × 25%` of the food box
 *                           (Granary's 2 → half the box, Civ1's rule).
 *  - `growthBonus: N`     — +N food credited to the new box when the city
 *                           grows (it helps the next growth too).
 *  - `health: N`          — demographics: lowers disease, raises life
 *                           expectancy (Aqueduct, Hospital).
 *  - `defense: N`         — city combat defense multiplier `1 + N × 0.25`
 *                           (City Walls' 2 → ×1.5), and the marker for
 *                           "this tile is walled" (walls are stripped when a
 *                           nuke or a capture takes the city).
 *  - `missileDefense`     — intercepts warheads (SDI Defense).
 *  - `isPalace`           — this building makes its city the capital.
 *  - `culture: N`         — culture per turn, tracked in the demographics.
 *
 * Pure — no engine handle, safe for the zustand store and tests.
 */

import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';

/** Anything with a buildings list — a City, a fixture, a save-game stub. */
export interface HasBuildings {
  buildings?: unknown[] | null;
}

/** The engine-visible summary of one settlement's regular buildings. */
export interface BuildingEffectsSummary {
  /** Flat shields the buildings add every turn. */
  production: number;
  /** Extra shields while a combat unit is under construction. */
  unitProduction: number;
  /** Combat units built here start Seasoned (Barracks). */
  veteranUnits: boolean;
  /** Share of the food box kept on growth, 0..1 (Granary: 0.5). */
  foodRetention: number;
  /** Food credited back to the new box each time the city grows. */
  growthBonusFood: number;
  /** Health points (disease down, life expectancy up). */
  health: number;
  /** City defense multiplier, 1 when no defensive building stands. */
  defenseMultiplier: number;
  /** A building intercepts warheads within its radius (SDI Defense). */
  missileDefense: boolean;
  /** A building designates the city as its owner's capital (Palace). */
  isCapital: boolean;
  /** Culture points per turn. */
  culture: number;
}

const NO_EFFECTS: BuildingEffectsSummary = {
  production: 0,
  unitProduction: 0,
  veteranUnits: false,
  foodRetention: 0,
  growthBonusFood: 0,
  health: 0,
  defenseMultiplier: 1,
  missileDefense: false,
  isCapital: false,
  culture: 0,
};

/** Whether one declared value counts as "the effect is present". */
function effectPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  return true;
}

/**
 * The building id from a stored entry. Saves and fixtures carry ids as plain
 * strings; some legacy paths stored `{ id }` / `{ type }` objects, so both
 * shapes are accepted (same defensive read the economy uses).
 */
export function storedBuildingId(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const obj = entry as { id?: unknown; type?: unknown };
    if (typeof obj.id === 'string') return obj.id;
    if (typeof obj.type === 'string') return obj.type;
  }
  return '';
}

/** All `effects` records of the regular buildings a settlement holds. */
function effectRecords(entry: HasBuildings | null | undefined): Array<Record<string, unknown>> {
  const list = Array.isArray(entry?.buildings) ? entry!.buildings! : [];
  const records: Array<Record<string, unknown>> = [];
  for (const stored of list) {
    const id = storedBuildingId(stored);
    if (!id) continue;
    const effects = BUILDING_PROPERTIES[id]?.effects as Record<string, unknown> | undefined;
    if (effects) records.push(effects);
  }
  return records;
}

/** Whether any building declares `key` truthy (booleans, numbers ≠ 0, text). */
export function hasBuildingEffect(entry: HasBuildings | null | undefined, key: string): boolean {
  return effectRecords(entry).some((effects) => effectPresent(effects[key]));
}

/** The full engine-visible summary for one settlement. */
export function cityBuildingEffects(entry: HasBuildings | null | undefined): BuildingEffectsSummary {
  const records = effectRecords(entry);
  if (records.length === 0) return NO_EFFECTS;

  const result: BuildingEffectsSummary = { ...NO_EFFECTS };
  for (const effects of records) {
    for (const [key, value] of Object.entries(effects)) {
      switch (key) {
        case 'production':
          if (typeof value === 'number') result.production += value;
          break;
        case 'unitProduction':
          if (typeof value === 'number') result.unitProduction += value;
          break;
        case 'veteranUnits':
          result.veteranUnits = result.veteranUnits || effectPresent(value);
          break;
        case 'foodStorage':
          if (typeof value === 'number') result.foodRetention += value * 0.25;
          break;
        case 'growthBonus':
          if (typeof value === 'number') result.growthBonusFood += value;
          break;
        case 'health':
          if (typeof value === 'number') result.health += value;
          break;
        case 'defense':
          if (typeof value === 'number') result.defenseMultiplier += value * 0.25;
          break;
        case 'missileDefense':
          result.missileDefense = result.missileDefense || effectPresent(value);
          break;
        case 'isPalace':
          result.isCapital = result.isCapital || effectPresent(value);
          break;
        case 'culture':
          if (typeof value === 'number') result.culture += value;
          break;
        default:
          break;
      }
    }
  }
  // The food box can never be kept whole (growth must cost something) and a
  // fraction below half is not worth a building; cap the declarative value.
  result.foodRetention = Math.max(0, Math.min(0.75, result.foodRetention));
  return result;
}

/**
 * Remove every defensive structure from a captured / irradiated city: the
 * buildings that declare a `defense` value (City Walls today, ramparts of any
 * kind tomorrow). Non-defense buildings are returned untouched.
 */
export function stripDefensiveBuildings(buildings: unknown[] | null | undefined): unknown[] {
  return (buildings ?? []).filter((stored) => !isDefensiveBuilding(stored));
}

/** Whether one stored building entry declares a `defense` value. */
export function isDefensiveBuilding(entry: unknown): boolean {
  const id = storedBuildingId(entry);
  if (!id) return false;
  const defense = BUILDING_PROPERTIES[id]?.effects?.defense;
  return typeof defense === 'number' && defense > 0;
}

/** Whether one stored building entry is the seat of government (Palace). */
export function isPalaceBuilding(entry: unknown): boolean {
  const id = storedBuildingId(entry);
  if (!id) return false;
  return effectPresent(BUILDING_PROPERTIES[id]?.effects?.isPalace);
}

/** Remove the Palace (the capital building) from a captured city's list. */
export function stripPalaceBuildings(buildings: unknown[] | null | undefined): unknown[] {
  return (buildings ?? []).filter((stored) => !isPalaceBuilding(stored));
}

/**
 * The id of the building that declares `isPalace` (the Palace), derived from
 * the building data so no code has to spell the id out. Null only if the
 * building table loses its palace entirely.
 */
export const PALACE_BUILDING_ID: string | null =
  Object.keys(BUILDING_PROPERTIES).find((id) =>
    effectPresent(BUILDING_PROPERTIES[id]?.effects?.isPalace),
  ) ?? null;
