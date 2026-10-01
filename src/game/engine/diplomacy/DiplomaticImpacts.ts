/**
 * DiplomaticImpacts — the one funnel where an act becomes goodwill points.
 *
 *     delta = base × personality weight × relationship state × magnitude
 *
 * Keeping all four factors explicit (rather than baking them into one fudge
 * number, as the old SURPRISE_ATTACK_PENALTY / brokenTreaties × 15 pair did) is
 * what makes the system tunable and legible: a designer can ask "how expensive
 * is betrayal to a paranoid civ?" and read the answer off this table.
 *
 * Pure functions only — the manager applies the result to the ledger.
 */

import type { DiplomaticStatus, ImpactEvent } from '../DiplomacyTypes';
import { personalityMultiplier, type DiplomaticWeights } from './DiplomaticWeights';

/**
 * Base goodwill points, before multipliers. Negative = the actor made the
 * other side's life worse. Tuned so a fresh betrayal puts a civ clearly into
 * "annoyed" territory and betrayal of an ally is catastrophic.
 */
const BASE_IMPACT: Record<ImpactEvent, number> = {
  first_contact: 3,
  surprise_attack: -35,
  ceasefire_break: -30,
  late_ceasefire_break: -10,
  alliance_break: -60,
  tribute_extorted: -12,
  tribute_gift: 8,
  unit_bribed: -45,
  spy_detected: -20,
  treaty_cancelled: -6,
  border_pressure: -4,
  peace_made: 6,
  ceasefire_signed: 2,
  alliance_formed: 10,
  open_borders_signed: 3,
  trade_signed: 7,
  mutual_defense_signed: 8,
  non_aggression_signed: 5,
  embargo_signed: 2,
  tech_exchanged: 10,
  common_enemy_defeated: 15,
  refused_peace: -8,
  ally_abandoned: -10,
};

/** Human-readable text per impact, for the ledger's reason list. */
const IMPACT_TEXT: Record<ImpactEvent, string> = {
  first_contact: 'First contact',
  surprise_attack: 'Attacked without warning',
  ceasefire_break: 'Broke a ceasefire',
  late_ceasefire_break: 'Restarted a war after a ceasefire',
  alliance_break: 'Betrayed an alliance',
  tribute_extorted: 'Paid tribute under duress',
  tribute_gift: 'Received a gift',
  unit_bribed: 'Lost a unit to a bribe',
  spy_detected: 'Caught spying',
  treaty_cancelled: 'Cancelled a treaty',
  border_pressure: 'Cities too close to the border',
  peace_made: 'Signed a peace treaty',
  ceasefire_signed: 'Agreed a ceasefire',
  alliance_formed: 'Formed an alliance',
  open_borders_signed: 'Opened borders',
  trade_signed: 'Signed a trade agreement',
  mutual_defense_signed: 'Signed a mutual defence pact',
  non_aggression_signed: 'Signed a non-aggression pact',
  embargo_signed: 'Joined an embargo',
  tech_exchanged: 'Exchanged technology',
  common_enemy_defeated: 'Stood with me against a common enemy',
  refused_peace: 'Refused my peace offer',
  ally_abandoned: 'Left me to fight my own war',
};

export function impactText(event: ImpactEvent): string {
  return IMPACT_TEXT[event];
}

/** The terms of the act, when they have a size worth scaling by. */
export interface ImpactTerms {
  /** Gold involved: a demand, a gift, a bribe. */
  gold?: number;
  /** A technology changed hands. */
  tech?: boolean;
  /** A third party is involved (embargo target, common enemy). */
  thirdParty?: boolean;
}

/**
 * Magnitude 0.5 … 2: how big the act actually was, independent of who is
 * reacting. A 50-gold gift is a small kindness; a 400-gold one is a real
 * gesture. This is what the old model was missing entirely — a 500-gold demand
 * and a 5-gold one had identical odds of acceptance.
 */
export function magnitudeOf(terms: ImpactTerms | undefined): number {
  if (!terms) return 1;
  let magnitude = 1;
  if (typeof terms.gold === 'number' && Number.isFinite(terms.gold) && terms.gold > 0) {
    // 100 gold ≈ 1.0, saturating at 2.0 around 500 gold.
    magnitude *= Math.max(0.5, Math.min(2, 0.5 + terms.gold / 200));
  }
  if (terms.tech) magnitude *= 1.4;
  return magnitude;
}

/**
 * Relationship-state multiplier. This is the term that was missing: breaking
 * an alliance is not "breaking a peace with a bigger number", and a trade pact
 * is worth more to a mercantile civ than to a xenophobic one.
 */
export function stateMultiplier(
  event: ImpactEvent,
  weights: DiplomaticWeights,
  status: DiplomaticStatus,
): number {
  switch (event) {
    case 'alliance_break':
      // Betrayal compounds with how much the civ honours agreements.
      return 1 + (weights.loyalty / 10) * 0.6;
    case 'ceasefire_break':
    case 'late_ceasefire_break':
      return 1 + (weights.loyalty / 10) * 0.4;
    case 'surprise_attack':
      // An attack out of a standing alliance is also a betrayal, and the
      // multiplier above only fires for the explicit break case — fold it in.
      return status === 'alliance' ? 1 + (weights.loyalty / 10) * 0.6 : 1;
    case 'treaty_cancelled':
      return 1 + (weights.loyalty / 10) * 0.5;
    case 'tribute_extorted':
      // A greedy civ resents being milked more than a generous one.
      return 1 + (weights.greed / 10) * 0.5;
    case 'unit_bribed':
      return 1 + (weights.loyalty / 10) * 0.4;
    case 'spy_detected':
      // Suspicious civs punish espionage brutally — this is the lever that
      // makes "gather intelligence" a real decision instead of a free action.
      return 1 + (weights.paranoia / 10) * 1.5;
    case 'border_pressure':
      return 1 + (weights.xenophobia / 10) * 0.5;
    case 'trade_signed':
    case 'embargo_signed':
      return 1 + (weights.greed / 10) * 0.5;
    case 'open_borders_signed':
      // A xenophobic civ gives up more ground by opening its borders.
      return 1 + (weights.xenophobia / 10) * 0.5;
    case 'alliance_formed':
    case 'mutual_defense_signed':
      return 1 + (weights.trustSensitivity / 10) * 0.5;
    default:
      // Peace and gifts are absorbed in proportion to openness.
      return 1 + (weights.trustSensitivity / 10) * 0.2;
  }
}

/** The impact event to log for a war declaration, given what it interrupted. */
export function warEventFor(previousStatus: DiplomaticStatus, turnsIntoStatus: number): ImpactEvent {
  if (previousStatus === 'alliance') return 'alliance_break';
  if (previousStatus === 'ceasefire') {
    return turnsIntoStatus < 5 ? 'ceasefire_break' : 'late_ceasefire_break';
  }
  return 'surprise_attack';
}

/** Full delta for one act, with the multipliers kept in the return for tests/UI. */
export interface ImpactComputation {
  delta: number;
  base: number;
  personality: number;
  state: number;
  magnitude: number;
}

export function computeImpact(
  event: ImpactEvent,
  weights: DiplomaticWeights,
  status: DiplomaticStatus,
  terms?: ImpactTerms,
): ImpactComputation {
  const base = BASE_IMPACT[event];
  const personality = personalityMultiplier(weights, event);
  const state = stateMultiplier(event, weights, status);
  const magnitude = magnitudeOf(terms);
  return {
    base,
    personality,
    state,
    magnitude,
    // Rounded so a stored reason string never shows 3.3333333.
    delta: Math.round(base * personality * state * magnitude),
  };
}
