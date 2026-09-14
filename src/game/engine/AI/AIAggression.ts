/**
 * AIAggression — situational aggression assessment and bulk-attack planning.
 *
 * The old AI only attacked once it had accumulated a fixed army strength and
 * never evaluated whether it SHOULD attack, so it sat in a defensive
 * stalemate. This module gives the AI a situational read on the right moment
 * to be aggressive (cities secured, army advantage, known targets, early rush
 * window) and adds a stochastic trigger: near the decision threshold the
 * choice is a weighted coin-flip, so games don't all play out identically.
 */

import { TERRAIN_PROPERTIES } from '../../../data/TerrainConstants';
import type { City } from '../../../../types/game';
import type GameEngine from '../GameEngine';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Above this the AI is always aggressive; below it never is. */
export const AGGRESSION_TRIGGER_THRESHOLD = 50;
/** Width of the stochastic band around the threshold. */
export const AGGRESSION_TRIGGER_BAND = 15;
/** Bulk attacks require this much available strength relative to target defense. */
export const BULK_ATTACK_STRENGTH_RATIO = 0.7;
/** Default defensive strength assumed for an unknown/unbuilt enemy city. */
export const UNKNOWN_CITY_DEFENSE = 8;
/** Default defensive strength assumed for an enemy unit. */
export const UNKNOWN_UNIT_DEFENSE = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AggressionInput {
  /** Personality aggression 1-10. */
  personalityAggression: number;
  ownArmyStrength: number;
  enemyArmyStrength: number;
  /** Own cities with a critical (overwhelming) threat. */
  criticalThreats: number;
  /** Own cities that need defense at all. */
  threatenedCities: number;
  knownEnemyCities: number;
  numOwnCities: number;
  numEnemyCities: number;
  isAtWar: boolean;
  currentYear: number;
}

export interface AggressionAssessment {
  /** 0-100 situational aggression score. */
  score: number;
  aggressive: boolean;
  reasons: string[];
}

export interface BulkAttackPlan {
  target: { col: number; row: number };
  targetCivId?: number;
  targetType: 'city' | 'unit';
  targetDefense: number;
  requiredUnits: number;
  reason: string;
}

export interface KnownTarget {
  col: number;
  row: number;
  type: 'city' | 'unit';
  id: string;
  lastSeenRound?: number;
  discoveredRound?: number;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Stochastic trigger near the decision threshold. Far above the threshold
 * aggression always triggers, far below it never does; within the band the
 * trigger is a coin-flip weighted by how close the score is to the threshold
 * (score 50 → 50% chance, score 58 → 73% chance, …).
 */
export function shouldTriggerAggression(
  score: number,
  random: () => number = Math.random,
): boolean {
  if (score >= AGGRESSION_TRIGGER_THRESHOLD + AGGRESSION_TRIGGER_BAND) return true;
  if (score <= AGGRESSION_TRIGGER_THRESHOLD - AGGRESSION_TRIGGER_BAND) return false;
  const p =
    (score - (AGGRESSION_TRIGGER_THRESHOLD - AGGRESSION_TRIGGER_BAND)) /
    (2 * AGGRESSION_TRIGGER_BAND);
  return random() < Math.max(0, Math.min(1, p));
}

/**
 * Situational aggression score: how much this civ SHOULD push right now.
 *  - Personality baseline.
 *  - Cities secured → aggression up; critical threats → aggression crushed.
 *  - Army advantage over the enemy → up; outmatched → down.
 *  - Known enemy cities are opportunities; an early rush window adds pressure.
 *  - At war → commit; a city-count advantage → push to take more cities.
 */
export function computeAggression(
  input: AggressionInput,
  random: () => number = Math.random,
): AggressionAssessment {
  const reasons: string[] = [];
  let score = 0;

  // Personality baseline: aggressive civs lean aggressive.
  score += input.personalityAggression * 6;
  reasons.push(`aggression ${input.personalityAggression}/10`);

  // Cities secured: a civ that has to defend everywhere cannot push.
  if (input.criticalThreats === 0) {
    score += 20;
    reasons.push('cities secured');
  } else {
    score -= 45;
    reasons.push(`${input.criticalThreats} critical threat(s)`);
  }
  if (input.threatenedCities === 0) {
    score += 10;
    reasons.push('no border pressure');
  }

  // Relative army strength.
  const ratio =
    input.enemyArmyStrength > 0
      ? input.ownArmyStrength / input.enemyArmyStrength
      : input.ownArmyStrength > 0
        ? 5
        : 1;
  if (ratio >= 1.6) {
    score += 15;
    reasons.push('army advantage');
  } else if (ratio >= 1.25) {
    score += 11;
    reasons.push('slight army edge');
  } else if (ratio <= 0.5) {
    // Severely outmatched — the largest penalty. (Checked before the milder
    // band so a lopsided deficit crushes aggression harder than a mild one.)
    score -= 50;
    reasons.push('severely outmatched');
  } else if (ratio <= 0.75) {
    score -= 30;
    reasons.push('outmatched');
  }

  // Opportunity: known enemy cities are targets worth taking.
  if (input.knownEnemyCities >= 2) {
    score += 10;
    reasons.push(`${input.knownEnemyCities} enemy cities known`);
  } else if (input.knownEnemyCities === 1) {
    score += 5;
    reasons.push('1 enemy city known');
  }

  // Early rush window: strike before the enemy fortifies — but only when we
  // are not outmatched and nothing critical is on fire at home.
  if (
    input.currentYear < -1500 &&
    input.knownEnemyCities >= 1 &&
    !input.isAtWar &&
    input.criticalThreats === 0 &&
    ratio >= 1
  ) {
    score += 12;
    reasons.push('early rush window');
  }

  // Already committed: finish the war instead of stalling.
  if (input.isAtWar) {
    score += 8;
    reasons.push('at war');
  }

  // Empire advantage: push to take as many cities as possible.
  if (
    input.numOwnCities > 0 &&
    input.numEnemyCities > 0 &&
    input.numOwnCities >= input.numEnemyCities + 2
  ) {
    score += 5;
    reasons.push('city-count advantage');
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    aggressive: shouldTriggerAggression(finalScore, random),
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Strength estimation
// ---------------------------------------------------------------------------

/** Estimate the defensive strength of an enemy city: garrison + walls + pop + terrain. */
export function estimateCityDefense(engine: GameEngine, city: City): number {
  let defense = Math.max(1, city.population ?? 1);
  const hasWalls =
    (city.buildings?.includes?.('city_walls') ?? false) ||
    (city.buildings?.includes?.('walls') ?? false);
  if (hasWalls) defense *= 3;

  if (engine?.squareGrid && Array.isArray(engine.units)) {
    for (const unit of engine.units) {
      if (unit.civilizationId !== city.civilizationId) continue;
      const dist = engine.squareGrid.squareDistance(unit.col, unit.row, city.col, city.row);
      if (dist <= 2) {
        defense += Math.max(1, unit.attack || 0) + (unit.defense || 0) * 0.5;
      }
    }
  }

  // Terrain under the city boosts its defensibility: a city on hills, forest,
  // river or mountains is far harder to assault than one on open plains.
  const tile = engine?.getTileAt?.(city.col, city.row) as { type?: string } | null | undefined;
  if (tile?.type) {
    defense *= TERRAIN_PROPERTIES[tile.type]?.defense ?? 1;
  }

  return defense;
}

// ---------------------------------------------------------------------------
// Bulk attack planning
// ---------------------------------------------------------------------------

/**
 * Plan a bulk assault on a single enemy city (or, failing that, an enemy
 * unit). Returns null when:
 *  - the civ is not in an aggressive posture, or
 *  - there is no usable known target, or
 *  - the best target is TOO STRONG (our available strength is below
 *    targetDefense * BULK_ATTACK_STRENGTH_RATIO) — an attack that cannot be
 *    won must not be triggered.
 */
export function planBulkAttack(
  engine: GameEngine,
  civId: number,
  targets: KnownTarget[],
  availableStrength: number,
  eligibleUnits: number,
  roundNumber: number,
  aggressive: boolean,
): BulkAttackPlan | null {
  if (!aggressive) return null;

  const friendlyCities = (engine.cities ?? []).filter(
    (c: City) => c.civilizationId === civId,
  );
  const distFn = (c1: number, r1: number, c2: number, r2: number) =>
    engine.squareGrid?.squareDistance?.(c1, r1, c2, r2) ?? Infinity;

  let best: KnownTarget | null = null;
  let bestScore = -Infinity;

  for (const target of targets) {
    const age = roundNumber - (target.lastSeenRound ?? target.discoveredRound ?? roundNumber);
    // Intel stays actionable longer than a pure "current sighting". Two civs
    // that meet once then separate (units parked apart) would otherwise lose
    // the only known enemy city after 20 rounds and never plan an assault —
    // the "aggression never fires" stalemate. 40 rounds keeps a known target
    // usable until the front line actually re-contacts it.
    if (age > 40) continue;

    // Skip enemy cities we have already captured (stale intelligence).
    if (target.type === 'city') {
      const city = engine.getCityAt?.(target.col, target.row);
      if (city && city.civilizationId === civId) continue;
    }

    const nearestOwnDist =
      friendlyCities.length > 0
        ? friendlyCities.reduce(
            (min, c) => Math.min(min, distFn(c.col, c.row, target.col, target.row)),
            Infinity,
          )
        : 0;

    // Prefer cities (take territory), fresher intel, and near targets.
    const cityBonus = target.type === 'city' ? 60 : 20;
    const freshness = Math.max(0, 20 - age);
    const score = cityBonus + freshness * 2 - nearestOwnDist;

    if (score > bestScore) {
      bestScore = score;
      best = target;
    }
  }

  if (!best) return null;

  const city = best.type === 'city' ? engine.getCityAt?.(best.col, best.row) : undefined;
  const targetDefense =
    best.type === 'city'
      ? city
        ? estimateCityDefense(engine, city)
        : UNKNOWN_CITY_DEFENSE
      : UNKNOWN_UNIT_DEFENSE;

  // Too-strong gating: never trigger (or keep) an assault we cannot win.
  if (availableStrength < targetDefense * BULK_ATTACK_STRENGTH_RATIO) {
    return null;
  }

  // A real bulk: at least 3 units, scaled by the target's defense.
  const requiredUnits = Math.max(
    3,
    Math.min(eligibleUnits, Math.ceil(targetDefense * 0.8)),
  );

  return {
    target: { col: best.col, row: best.row },
    targetCivId: city?.civilizationId,
    targetType: best.type,
    targetDefense,
    requiredUnits,
    reason: best.type === 'city' ? 'bulk city assault' : 'bulk unit hunt',
  };
}
