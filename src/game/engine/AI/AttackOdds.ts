/**
 * AttackOdds — the AI's quick pre-attack calculation.
 *
 * The Civ1 strategy guide's central tactical rule: *"Always keep the odds in
 * your head — do not attack without a quick calculation."* Before this module
 * the AI attacked whatever stood next to it (`AIManager` marched every unit
 * into the first hostile it met), so a knight happily charged a fortified
 * Musketeer in the woods — the guide's textbook example of a 3:2 underdog —
 * and a lone catapult wandered into the open field where faster units ate it.
 *
 * Two decisions live here:
 *
 *  1. **Odds** — `estimateEngagementWinChance` replays the CombatSystem damage
 *     model (only the loser of a round takes 25 %, a round win is lethal on an
 *     overrun or at ≤ 25 HP) over the whole duel and returns the probability
 *     that the attacker wins it. Terrain defence, fortification, in-city +50 %,
 *     fortress multipliers and rank are folded in via `CombatSystem`, so the
 *     AI estimates exactly what the engine will resolve.
 *
 *  2. **Discipline** — `decideAiAttack` applies two rules on top of that
 *     probability:
 *       - a solo attacker needs at least an even fight (0.5); every friendly
 *         unit focusing the same target lowers the floor, because numbers turn
 *         a losing duel into a winning siege (focus fire weakens the defender
 *         for the next attacker);
 *       - siege units (catapult, cannon, artillery) never start a fight in the
 *         open field — *"In the field, they will be slaughtered by the faster
 *         units"* — they only fire at units in cities or fortresses, or when a
 *         friendly unit is pressing the same target ("brought up with
 *         musketeers for protection").
 *
 * The floor never drops below `AI_ATTACK_FLOOR_CLAMP`, so even a full stack
 * refuses pure suicide — the army keeps its strength for the next wave.
 */

import { UNIT_PROPS } from '@/utils/Constants';
import { IMPROVEMENT_TYPES } from '@/data/TileImprovementConstants';
import {
  CombatSystem,
  type CombatUnitLike,
  type UnitCombatContext,
} from '../CombatSystem';

/** A lone attacker needs at least an even fight to be worth starting. */
export const AI_ATTACK_MIN_WIN_CHANCE = 0.5;

/**
 * Each friendly unit focusing the same defender lowers the floor by this
 * much: 1 friend → 0.42, 2 → 0.34, 3+ → clamped at the floor below.
 */
const AI_ATTACK_SUPPORT_STEP = 0.08;

/** The floor no amount of support may drop below — never pure suicide. */
export const AI_ATTACK_FLOOR_CLAMP = 0.3;

/** How much support counts for the floor before further units add nothing. */
const MAX_SUPPORT_STEPS = 3;

/** HP after which a won round is lethal in `CombatSystem.resolveUnitRound`. */
const LETHAL_HP_THRESHOLD = 25;

export interface AiAttackContext extends UnitCombatContext {
  /** Live friendly combat units standing next to the defender's tile. */
  support?: number;
}

export interface AiAttackDecision {
  allow: boolean;
  /** Estimated probability (0..1) that the attacker wins the engagement. */
  chance: number;
  /** Short machine-readable reason (logged and shown in AI debug output). */
  reason: string;
}

/**
 * Estimated probability that `attacker` wins the whole engagement against
 * `defender` standing on its current tile.
 *
 * The engine resolves one round per attack and recomputes both strengths from
 * the units' current HP each time, so this is a small recursion over the state
 * pair (attackerHP, defenderHP): a won round costs the defender 25 HP — or
 * everything, when the attacker is at least as strong (overrun) or the
 * defender is already at ≤ 25 HP — a lost round costs the attacker 25 HP.
 * Both units start from their real health and the recursion terminates after
 * at most a handful of steps.
 */
export function estimateEngagementWinChance(
  attacker: CombatUnitLike,
  defender: CombatUnitLike,
  context: UnitCombatContext = {},
): number {
  // Strengths at full HP; the recursion scales them back down per state.
  const attackFull = CombatSystem.attackerStrength({ ...attacker, health: 100 });
  const defendFull = CombatSystem.defenderStrength({ ...defender, health: 100 }, context);
  if (attackFull <= 0) return 0;
  if (defendFull <= 0) return 1; // cannot fight back at all

  const startAttackerHp = clampHp(attacker.health);
  const startDefenderHp = clampHp(defender.health);
  const memo = new Map<string, number>();

  const at = (attackerHp: number, defenderHp: number): number => {
    if (attackerHp <= 0) return 0;
    if (defenderHp <= 0) return 1;
    const key = `${attackerHp}|${defenderHp}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const attackStrength = (attackFull * attackerHp) / 100;
    const defendStrength = (defendFull * defenderHp) / 100;
    const total = attackStrength + defendStrength;
    if (total <= 0) {
      memo.set(key, 0);
      return 0;
    }
    const winChance = attackStrength / total;
    const overrun = attackStrength >= defendStrength;
    const defenderAfterWin = overrun || defenderHp <= LETHAL_HP_THRESHOLD
      ? 0
      : defenderHp - LETHAL_HP_THRESHOLD;

    const value =
      winChance * at(attackerHp, defenderAfterWin) +
      (1 - winChance) * at(attackerHp - LETHAL_HP_THRESHOLD, defenderHp);
    memo.set(key, value);
    return value;
  };

  return at(startAttackerHp, startDefenderHp);
}

/**
 * Should the AI unit standing next to this defender actually attack?
 *
 * Returns the estimate alongside the decision so callers can log why the unit
 * held instead ("low_odds 38 %", "siege_field_discipline").
 */
export function decideAiAttack(
  attacker: CombatUnitLike,
  defender: CombatUnitLike,
  context: AiAttackContext = {},
): AiAttackDecision {
  const chance = estimateEngagementWinChance(attacker, defender, context);
  const support = Math.max(0, context.support ?? 0);
  const unitClass = UNIT_PROPS[String(attacker.type ?? '')]?.type;
  const defenderClass = UNIT_PROPS[String(defender.type ?? '')]?.type;

  // Enemy civilians (settlers, caravans, diplomats) are always worth taking:
  // the guide rides down "the odd Settler, Caravan, or Diplo-dude" wherever
  // they are caught, and denying an enemy city or trade route is worth worse
  // than even odds. Neither the siege rule nor the odds floor applies to them.
  // Scouts get the same exemption: they are the eyes of the enemy, and two
  // adjacent scouts must be able to kill each other instead of standing off
  // forever (their 1 defence makes every estimate look bad).
  if (defenderClass === 'civilian' || String(defender.type ?? '') === 'scout') {
    return { allow: true, chance, reason: 'soft_target' };
  }

  // Civ1 guide: siege engines are siege weapons — in the open field faster
  // units slaughter them. They fire from a fortified position (city, fortress)
  // or when a front-line unit is keeping the target busy.
  if (unitClass === 'siege') {
    const tile = context.defenderTile ?? null;
    const fortifiedSite =
      context.defenderInCity === true ||
      String(tile?.improvement ?? '') === IMPROVEMENT_TYPES.FORTRESS;
    if (!fortifiedSite && support < 1) {
      return { allow: false, chance, reason: 'siege_field_discipline' };
    }
  }

  const floor = Math.max(
    AI_ATTACK_FLOOR_CLAMP,
    AI_ATTACK_MIN_WIN_CHANCE - AI_ATTACK_SUPPORT_STEP * Math.min(support, MAX_SUPPORT_STEPS),
  );
  // Epsilon so an exactly even fight (warrior vs warrior on open ground) is
  // allowed — floating point must not turn 0.5 into 0.4999999999.
  if (chance + 1e-9 < floor) {
    return { allow: false, chance, reason: 'low_odds' };
  }
  return {
    allow: true,
    chance,
    reason: support > 0 ? 'focus_fire' : 'even_or_better',
  };
}

function clampHp(health: number | undefined): number {
  if (health === undefined || Number.isNaN(health)) return 100;
  return Math.max(0, Math.min(100, health));
}
