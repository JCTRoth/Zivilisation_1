// Civilization I villages (goody huts) — implementation constants.

/** Phantom civ id used for barbarian units (never present in civilizations[]). */
export const BARBARIAN_CIV_ID = -1;

export const VILLAGE_OUTCOME = {
  ADVANCED_TRIBE: 'advanced_tribe',
  SCROLL_OF_ANCIENT_WISDOM: 'scroll_of_ancient_wisdom',
  VALUABLE_METALS: 'valuable_metals',
  FRIENDLY_MERCENARIES: 'friendly_mercenaries',
  BARBARIANS: 'barbarians',
} as const;

/** All outcomes in equal weight (20 each → 20% chance each). */
export const VILLAGE_OUTCOMES: string[] = [
  VILLAGE_OUTCOME.ADVANCED_TRIBE,
  VILLAGE_OUTCOME.SCROLL_OF_ANCIENT_WISDOM,
  VILLAGE_OUTCOME.VALUABLE_METALS,
  VILLAGE_OUTCOME.FRIENDLY_MERCENARIES,
  VILLAGE_OUTCOME.BARBARIANS,
];

/** Free building granted by an Advanced Tribe village (equal chance each). */
export const VILLAGE_FREE_BUILDINGS: string[] = ['barracks', 'granary', 'temple'];

/**
 * Possible gold amounts granted by a Valuable Metals village (Civ1: a lump
 * sum of 25, 50, or 100 gold, drawn randomly).
 */
export const VILLAGE_GOLD_AMOUNTS: number[] = [25, 50, 100];

/**
 * Barbarian unit types spawned by a Barbarian Ambush village (equal chance
 * each) — Civ1 basic land military (Warriors or Legions).
 */
export const VILLAGE_BARBARIAN_TYPES: string[] = ['warrior', 'legion'];

/** Barbarian ambush horde size range (inclusive) — Civ1 spawns 1–3. */
export const VILLAGE_BARBARIAN_MIN = 1;
export const VILLAGE_BARBARIAN_MAX = 3;

// ── AI village risk model ──────────────────────────────────────────────
//
// Popping a hut can spawn Barbarians next to it. A hut close to one of the
// civ's towns is therefore dangerous (the horde hits the town), while a hut
// far away and a large empire are safer: the farther the village from the
// nearest own city and the more cities the civ has, the higher the chance the
// AI takes it instead of leaving it for later/recon.
export const AI_VILLAGE_TAKE_BASE = 0.25;
export const AI_VILLAGE_TAKE_DISTANCE_WEIGHT = 0.5;
export const AI_VILLAGE_TAKE_CITY_WEIGHT = 0.3;
/** Distance (tiles) at which the "far away" bonus saturates. */
export const AI_VILLAGE_SAFE_DISTANCE = 8;
/** City count at which the "big empire" bonus saturates. */
export const AI_VILLAGE_CITY_SCALE = 6;
export const AI_VILLAGE_TAKE_MIN = 0.1;
export const AI_VILLAGE_TAKE_MAX = 0.95;

/**
 * Probability (0..1) that the AI actively collects a village at
 * `distanceFromNearestCity` tiles when it owns `cityCount` cities.
 * Monotonically increasing in both inputs.
 */
export function calculateVillageTakeChance(
  distanceFromNearestCity: number,
  cityCount: number,
): number {
  const distance = Number.isFinite(distanceFromNearestCity)
    ? Math.max(0, distanceFromNearestCity)
    : AI_VILLAGE_SAFE_DISTANCE;
  const distanceFactor = Math.min(1, distance / AI_VILLAGE_SAFE_DISTANCE);
  const empireFactor = Math.max(0, Math.min(1, cityCount / AI_VILLAGE_CITY_SCALE));
  const chance =
    AI_VILLAGE_TAKE_BASE +
    AI_VILLAGE_TAKE_DISTANCE_WEIGHT * distanceFactor +
    AI_VILLAGE_TAKE_CITY_WEIGHT * empireFactor;
  return Math.max(AI_VILLAGE_TAKE_MIN, Math.min(AI_VILLAGE_TAKE_MAX, chance));
}

/**
 * Deterministic pseudo-random roll in [0,1) for a (civ, tile) pair.
 * The AI's village decision uses `roll <= calculateVillageTakeChance(...)`;
 * the hash makes the decision stable across turns, so a unit never
 * flip-flops between taking and ignoring the same hut.
 */
export function villageDecisionRoll(civId: number, col: number, row: number): number {
  let h = (2166136261 ^ (civId + 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ col, 16777619) >>> 0;
  h = Math.imul(h ^ row, 16777619) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
