/**
 * Open-ground tactics: splash-aware targeting and stacking discipline.
 *
 * Pure — no engine, no DOM — so the cluster math is pinned against
 * hand-written situations instead of full games. `AIManager` supplies the
 * board facts (stack sizes, open ground, distances) and walks the answers.
 *
 * The doctrine, in one line: stacks are safe under a roof (cities,
 * fortresses — splash immunity) and bait on open ground (25% splash per
 * mate). So the AI hunts stacks it can splash and refuses to form them
 * where the enemy can do the same back.
 */

import { SPLASH_DAMAGE_FRACTION } from '../CombatSystem';

/** Splash bonus per stacked mate beyond the first, in target-score points. */
const STACK_SPLASH_BONUS = 12;

/** Stack mates counted before the bonus saturates (a 5-stack is not 4× bait). */
const STACK_BONUS_CAP = 4;

export interface StackTargetScoreInput {
  /** Hostile units standing on the candidate tile. */
  stackSize: number;
  /** Chebyshev distance from the hunting unit to the tile. */
  distance: number;
  /** True when the tile has no city and no fortress (splash applies). */
  openGround: boolean;
  /** Base value of the target (strength, city prize, …) — distance-independent. */
  baseValue?: number;
}

/**
 * Rank one attack candidate. An open-ground stack outranks a lone unit: every
 * mate beyond the first eats 25% of the hit for free, so killing into a
 * cluster is multi-kill value. Under a roof there is no splash and distance
 * (plus base value) decides alone.
 */
export function scoreStackTarget({
  stackSize,
  distance,
  openGround,
  baseValue = 0,
}: StackTargetScoreInput): number {
  const splash = stackSize >= 2 && openGround
    ? (Math.min(stackSize, STACK_BONUS_CAP) - 1) * STACK_SPLASH_BONUS
    : 0;
  return baseValue + splash - Math.max(0, distance) * 2;
}

export interface StackRiskInput {
  /** Own combat units already standing on the tile we'd enter. */
  ownStack: number;
  /** True when the tile has no city and no fortress (splash applies). */
  openGround: boolean;
  /** Hostile strength that can reach the tile (0 when nobody is near). */
  enemyThreat: number;
}

/**
 * Whether stepping onto an allied stack is reckless. One mate on open ground
 * with enemies about is exactly the cluster the enemy's splash wants: spread
 * instead. Cities, fortresses and empty tiles are always fine, and so is a
 * stack nobody threatens (the threat term carries the "away from cities"
 * judgement — a quiet backline may mass freely).
 */
export function stackStepRisk({ ownStack, openGround, enemyThreat }: StackRiskInput): number {
  if (ownStack <= 0 || !openGround || enemyThreat <= 0) return 0;
  return ownStack * SPLASH_DAMAGE_FRACTION * enemyThreat;
}

/** Risk above which the AI spreads instead of stacking (one doomed mate). */
export const STACK_RISK_LIMIT = 6;
