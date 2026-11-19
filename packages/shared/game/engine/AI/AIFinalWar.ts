/**
 * AIFinalWar — "when no enemy is left on the map anymore".
 *
 * The AI must not go quiet once it has run out of opponents. When every war it
 * was fighting is over, it picks the next civilisation it can actually reach,
 * declares active war and attacks it; when the only opponents left are across
 * water it declares the war anyway and lets the navy pipeline (transport +
 * invasion mission) carry the war over.
 *
 * Deliberately pure — no engine, no DOM, no globals — so the trigger and the
 * target choice can be unit-tested against hand-written scenarios instead of a
 * 400-round game.
 */

/** How a declared final war is prosecuted. */
export type FinalWarReach = 'land' | 'sea';

/** A living opponent the civ could actually get at. */
export interface FinalWarCandidate {
  civId: number;
  /** Diplomatic strength estimate — the weakest one is picked. */
  strength: number;
  reachableBy: FinalWarReach;
}

export interface FinalWarDecision {
  targetCivId: number;
  reachableBy: FinalWarReach;
}

/** What the civ remembers about the war it is currently waging. */
export interface FinalWarRecord {
  targetCivId: number;
  reachableBy: FinalWarReach;
  declaredRound: number;
}

export interface FinalWarTriggerInput {
  /** Civilisations the AI is at war with right now. */
  enemyCount: number;
  /** Met, living, non-allied civs that are reachable on foot or by sea. */
  candidateCount: number;
  /**
   * The civ has fought a war before. "No enemy left **anymore**" implies there
   * were some: without this a fresh game (everyone at peace since round 1)
   * would turn into a world war the moment two scouts met.
   */
  everFought: boolean;
}

/**
 * Fire the final-war trigger: nothing left to fight, and someone left to go
 * after.
 */
export function shouldDeclareFinalWar(input: FinalWarTriggerInput): boolean {
  if (input.enemyCount > 0) return false; // still enemies on the map
  if (!input.everFought) return false; // never fought — nothing is "left"
  return input.candidateCount > 0;
}

/**
 * Pick the one civilisation to declare on: the weakest reachable one, with a
 * strong preference for a target the army can walk to.
 *
 * Land beats sea even against a somewhat weaker overseas civ — an army already
 * standing next to the objective wins the war the same season it is declared,
 * while a sea war first has to build a hull, load it and sail it. Only when
 * nothing is walkable does the overseas civ become the objective, and that is
 * the case the navy half of the plan exists for.
 */
export function chooseFinalWarTarget(
  candidates: readonly FinalWarCandidate[],
): FinalWarDecision | null {
  const reachable = candidates.filter((c) => c.reachableBy === 'land' || c.reachableBy === 'sea');
  if (reachable.length === 0) return null;

  const land = reachable.filter((c) => c.reachableBy === 'land');
  const pool = land.length > 0 ? land : reachable;

  let best = pool[0];
  for (const candidate of pool) {
    if (candidate.strength < best.strength) best = candidate;
  }
  return { targetCivId: best.civId, reachableBy: best.reachableBy };
}
