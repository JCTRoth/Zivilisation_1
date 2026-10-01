/**
 * DiplomaticWeights — personality as a set of *weights*, not as an offset.
 *
 * The old `getAttitude` folded personality in as a flat score offset
 * (`(diplomacy - 5) * 3 - (aggression - 5) * 2`), which swamped every
 * relationship-state term: a civ's army-build priority decided its diplomacy
 * more than anything the player did. Here personality instead scales *how much
 * each kind of act moves the ledger*, so the same betrayal costs a paranoid
 * diplomatic civ 2.5× what it costs a belligerent one.
 *
 * The six base traits come from the civ's production profile (unchanged, since
 * production and research read them). A stable per-civ jitter is added on top
 * so two `military_expansion` civs are not diplomatic clones of each other —
 * that uniformity was a large part of diplomacy feeling like noise.
 */

import type { ImpactEvent } from '../DiplomacyTypes';
import type { Civilization } from '../../../../types/game';

/** All weights are 1..10, matching the existing personality scale. */
export interface DiplomaticWeights {
  /** How much a hostile act offends (drives negative deltas). */
  hostility: number;
  /**
   * How much this civ *wants* to fight. Deliberately separate from
   * `hostility`: a warlike civ is not more offended by betrayal, and using one
   * weight for both would make aggression reduce its own war appetite — the
   * opposite of what an aggressive personality should mean.
   */
  warmongering: number;
  /** How far goodwill opens a civ to agreements. */
  trustSensitivity: number;
  /** Sensitivity to gold: demands cost more, gifts and trade pay more. */
  greed: number;
  /** How much breaking a signed agreement costs. */
  loyalty: number;
  /** Sensitivity to being spied on or bribed around. */
  paranoia: number;
  /** How long and how hard grudges are held. */
  vengeance: number;
  /** Discomfort at foreign civs (proximity, first contact). */
  xenophobia: number;
  /** Tolerance for repeated demands; low patience means refusal sticks. */
  patience: number;
}

const clamp10 = (v: number): number => Math.max(1, Math.min(10, v));

/**
 * Stable 0..1 jitter for a civ id, so weights are deterministic per civ but
 * differ between civs with the same production profile. Deterministic matters:
 * the whole point is that a game replays identically.
 */
function civJitter(civId: number, salt: number): number {
  let h = (2166136261 ^ (civId * 2654435761) ^ (salt * 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Spread a 0..1 jitter across ±1.5 trait points. */
const jitter = (civId: number, salt: number): number => (civJitter(civId, salt) - 0.5) * 3;

/**
 * Derive the diplomatic weight vector from a civ's production personality.
 * Traits are normalised to 1..10 first so a civ without a personality (an
 * engine-built one, or a human) still gets a sane, middling vector.
 */
export function diplomaticWeights(civ: Pick<Civilization, 'id' | 'personality'> | null | undefined): DiplomaticWeights {
  const id = civ?.id ?? 0;
  const p = civ?.personality ?? {};
  const aggression = clamp10(p.aggression ?? 5);
  const diplomacy = clamp10(p.diplomacy ?? 5);
  const military = clamp10(p.military ?? 5);
  const economy = clamp10(p.economy ?? 5);

  return {
    // A warlike civ is not *more* offended by war — it cares less. Hostility
    // therefore leans on trust/diplomacy, not on aggression.
    hostility: clamp10(6 + (diplomacy - 5) * 0.6 - (aggression - 5) * 0.8 + jitter(id, 1)),
    warmongering: clamp10(5 + (aggression - 5) * 0.8 + (military - 5) * 0.3 + jitter(id, 9)),
    trustSensitivity: clamp10(5 + (diplomacy - 5) * 0.7 + (economy - 5) * 0.2 + jitter(id, 2)),
    greed: clamp10(5 + (economy - 5) * 0.9 + (military - 5) * 0.2 + jitter(id, 3)),
    loyalty: clamp10(4 + (diplomacy - 5) * 0.8 + (aggression - 5) * 0.3 + jitter(id, 4)),
    paranoia: clamp10(5 - (diplomacy - 5) * 0.4 + (aggression - 5) * 0.3 + jitter(id, 5)),
    vengeance: clamp10(4 + (aggression - 5) * 0.8 + (military - 5) * 0.2 + jitter(id, 6)),
    xenophobia: clamp10(5 + (aggression - 5) * 0.3 + (10 - diplomacy) * 0.4 + jitter(id, 7)),
    patience: clamp10(5 + (diplomacy - 5) * 0.6 - (aggression - 5) * 0.4 + jitter(id, 8)),
  };
}

/** Which single weight governs the reaction to each kind of act. */
const GOVERNING_WEIGHT: Record<ImpactEvent, keyof DiplomaticWeights> = {
  first_contact: 'xenophobia',
  surprise_attack: 'hostility',
  ceasefire_break: 'loyalty',
  late_ceasefire_break: 'loyalty',
  alliance_break: 'loyalty',
  tribute_extorted: 'greed',
  tribute_gift: 'greed',
  unit_bribed: 'loyalty',
  spy_detected: 'paranoia',
  treaty_cancelled: 'loyalty',
  border_pressure: 'xenophobia',
  peace_made: 'trustSensitivity',
  ceasefire_signed: 'trustSensitivity',
  alliance_formed: 'trustSensitivity',
  open_borders_signed: 'xenophobia',
  trade_signed: 'greed',
  mutual_defense_signed: 'trustSensitivity',
  non_aggression_signed: 'trustSensitivity',
  embargo_signed: 'greed',
  tech_exchanged: 'trustSensitivity',
  common_enemy_defeated: 'trustSensitivity',
  refused_peace: 'hostility',
  ally_abandoned: 'loyalty',
};

/**
 * The personality multiplier: 0.7 for a weight of 1 up to 2.5 for a weight of
 * 10. Below 1 means the trait makes the civ *less* moved by this kind of act
 * (a greedy civ shrugs off open borders), above 1 means more.
 */
export function personalityMultiplier(weights: DiplomaticWeights, event: ImpactEvent): number {
  const key = GOVERNING_WEIGHT[event];
  return 0.5 + (weights[key] / 10) * 2;
}
