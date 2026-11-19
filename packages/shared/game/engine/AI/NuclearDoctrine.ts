/**
 * Nuclear doctrine: how many warheads to hold, how many launch platforms to
 * sail, and what is worth a warhead.
 *
 * Deliberately pure — no engine, no DOM, no globals — so the endgame equation
 * is unit-tested against hand-written scenarios instead of a 600-round game.
 *
 * Civ1 rules the equation respects:
 *  - a warhead flies 16 tiles from its launch point (city or submarine);
 *  - SDI within 16 tiles of the aim point kills the strike harmlessly, so a
 *    shielded target is never worth a warhead however juicy it looks;
 *  - submarines carry exactly one warhead and nothing else; overseas targets
 *    need a sub within 16 of them, full stop.
 */

export interface NuclearTarget {
  col: number;
  row: number;
  kind: 'city' | 'stack';
  /** City population (cities) or stacked combat strength (stacks). */
  weight: number;
  /** Extra prize: capital, spaceship parts, wonder city. */
  bonus?: number;
  /** SDI covers this aim point — firing wastes the warhead. */
  sdiCovered?: boolean;
}

export interface NuclearTargetScore {
  score: number;
  hopeless: boolean;
}

/** Value weights: cities outrank stacks, capitals outrank cities. */
export const NUCLEAR_CITY_VALUE = 10;
const NUCLEAR_STACK_VALUE = 6;

/**
 * Rank one aim point. SDI-covered targets score hopeless: the missile dies in
 * mid-air, so even a capital under a shield is worth nothing. A lone weak
 * unit is never worth 160 shields and 5 gold/turn either.
 */
export function scoreNuclearTarget(target: NuclearTarget): NuclearTargetScore {
  if (target.sdiCovered) return { score: -Infinity, hopeless: true };
  const base = target.kind === 'city'
    ? (target.weight ?? 1) * NUCLEAR_CITY_VALUE + (target.bonus ?? 0)
    : (target.weight ?? 0) * NUCLEAR_STACK_VALUE + (target.bonus ?? 0);
  // A single weak unit is not worth a warhead.
  if (target.kind === 'stack' && (target.weight ?? 0) < 12) {
    return { score: -Infinity, hopeless: true };
  }
  return { score: base, hopeless: false };
}

export interface NuclearArsenalInput {
  /** Warheads owned + queued. */
  stock: number;
  /** Enemy cities worth striking (SDI-free preferred, caller filters). */
  valuableTargets: number;
  /** Targets beyond 16 tiles of our territory (need a submarine). */
  overseasTargets: number;
  /** Launch subs owned (subs carrying or able to carry a warhead). */
  subs: number;
  /** Current year (endgame arsenals are bigger). */
  year: number;
  /** Treasury gold (a warhead costs 5/turn to keep). */
  gold: number;
}

export interface NuclearArsenalWant {
  wantNukes: number;
  wantSubs: number;
}

/**
 * How big the arsenal should be. Peace with nothing worth striking wants
 * nothing; a late endgame with overseas targets wants a stockpile AND the
 * subs to deliver it (one sub per overseas target, capped at the stock).
 */
export function desiredNuclearArsenal(input: NuclearArsenalInput): NuclearArsenalWant {
  if (input.valuableTargets <= 0) return { wantNukes: 0, wantSubs: 0 };
  const endgame = input.year >= 1900 ? 1 : 0;
  const wantNukes = Math.min(3, Math.max(1, Math.min(input.valuableTargets, 1 + endgame + (input.gold > 500 ? 1 : 0))));
  const wantSubs = Math.min(wantNukes, Math.max(input.overseasTargets > 0 ? 1 : 0, Math.min(input.overseasTargets, 2)));
  return { wantNukes, wantSubs };
}

/**
 * Whether building another warhead is affordable right now. Warheads are the
 * most expensive upkeep in the game (5/turn): only a treasury above its
 * reserve with a real target starts one.
 */
export function canAffordNuclear(treasury: number, reserve: number, targets: number): boolean {
  return treasury > reserve && targets > 0;
}
