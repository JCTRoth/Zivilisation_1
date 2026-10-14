/**
 * Situational strategic branches: the named postures the AI fights, sails and
 * builds under once per turn. Pure — no engine — so every branch condition is
 * pinned against hand-written situations instead of full games.
 *
 * Branches are exclusive and priority-ordered. Each one owns concrete effects
 * (production, research, spending), wired at its call sites — a branch with no
 * effect would be a label, not a strategy:
 *
 *  - `nuclear_endgame`: fission + Manhattan + warheads + launch subs, SDI
 *    awareness, no wasted strikes. The only branch that builds nukes.
 *  - `total_war`: siege trains for walled targets, attackers rushed with
 *    gold, no new wonders. Lethality over economy.
 *  - `island_spread`: parallel colony sealift (settlers + ferries per island).
 *    Already the naval behaviour; the branch makes it explicit and gates it.
 *  - `steady`: everything else — balanced doctrine as before.
 */

export type StrategyBranchId = 'nuclear_endgame' | 'total_war' | 'island_spread' | 'steady';

export interface StrategyBranchInput {
  /** At war with anyone. */
  atWar: boolean;
  /** Current year (endgame arsenals start ~1900). */
  year: number;
  /** This civ knows Nuclear Fission. */
  fissionKnown: boolean;
  /** Manhattan Project built (by anyone — it unlocks all civs). */
  manhattanBuilt: boolean;
  /** Warheads owned + queued. */
  nukeStock: number;
  /** Enemy cities remaining (known + remembered). */
  enemyCities: number;
  /** Committed offensive plan exists (bulk attack / invasion). */
  hasOffensivePlan: boolean;
  /** Any enemy city known behind walls. */
  walledTargetKnown: boolean;
  /** Split-water world where the civ can sail. */
  seaWorld: boolean;
  /** Unclaimed colonisable islands visible. */
  islandsOpen: number;
  /** Own cities (spread needs somewhere to build settlers). */
  ownCities: number;
}

export interface StrategyBranch {
  id: StrategyBranchId;
  reasons: string[];
}

/**
 * Pick the branch. Nuclear endgame outranks war (warheads end wars faster
 * than soldiers do); total war outranks spread (conquest before colonies);
 * spread outranks steady routine.
 */
export function selectStrategyBranch(input: StrategyBranchInput): StrategyBranch {
  // Endgame arm: the physics package is unlocked and there is still someone
  // worth striking. Fission without Manhattan still counts — racing the
  // wonder IS the branch (production prioritizes it; see AutoProduction).
  if ((input.fissionKnown || input.manhattanBuilt) && input.enemyCities > 0
    && (input.year >= 1900 || (input.atWar && input.year >= 1500))) {
    const reasons = [
      input.manhattanBuilt ? 'manhattan-online' : 'racing-manhattan',
      input.year >= 1900 ? 'endgame' : 'wartime-endgame',
    ];
    return { id: 'nuclear_endgame', reasons };
  }
  // Total war: a committed offensive with walls to crack, or a standing army
  // already at war with cities left to take. Shields go to soldiers and siege,
  // gold goes to rushing them, wonders wait.
  if (input.atWar && (input.hasOffensivePlan || input.enemyCities > 0)) {
    const reasons = [input.hasOffensivePlan ? 'committed-offensive' : 'war-no-plan'];
    if (input.walledTargetKnown) reasons.push('walls-to-crack');
    return { id: 'total_war', reasons };
  }
  // Island spread: a sea world with open islands and cities to build the
  // sealift. Parallel colonies, escorts, then warships.
  if (input.seaWorld && input.islandsOpen > 0 && input.ownCities > 0) {
    return { id: 'island_spread', reasons: [`${input.islandsOpen}-islands-open`] };
  }
  return { id: 'steady', reasons: ['routine'] };
}

/** Whether this branch rushes attackers with gold (tempo over treasury). */
export function branchRushesAttackers(branch: StrategyBranchId): boolean {
  return branch === 'total_war' || branch === 'nuclear_endgame';
}

/** Whether this branch builds siege trains for walled targets. */
export function branchWantsSiege(branch: StrategyBranchId): boolean {
  return branch === 'total_war';
}

/** Whether this branch builds the nuclear arsenal. */
export function branchBuildsNukes(branch: StrategyBranchId): boolean {
  return branch === 'nuclear_endgame';
}
