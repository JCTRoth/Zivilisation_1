/**
 * AICoordinator - Inter-unit coordination and army group management
 * 
 * Groups combat units into coordinated army groups that rally, march,
 * and attack together. Also provides retreat/regroup logic for
 * outmatched units.
 */

import type { Unit, City } from '../../../../types/game';
import type { ArmyGroup } from './AITypes';
import type { BuildingEconomics } from './BuildingEconomics';
import { debugLog } from '../../../utils/DevLog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum units to form an army group */
const MIN_GROUP_SIZE = 3;

/** Maximum distance between units to be grouped */
const MAX_GROUP_DISTANCE = 8;

/** Strength multiplier threshold to trigger retreat (enemy / own) */
const RETREAT_THRESHOLD = 2.0;

/** Minimum strength required relative to estimated target defense */
const ATTACK_READINESS_MULTIPLIER = 1.5;

/**
 * If a group cannot gather at its rally point within this many rounds it stops
 * waiting and marches anyway. Without this a rally point that units cannot
 * reach (water, a blocked pass, a strait) kept the group in `forming` forever
 * — the "groups form but never attack" stalemate.
 */
const RALLY_TIMEOUT_ROUNDS = 6;

/** How far from the centroid we search for a passable rally tile. */
const RALLY_SEARCH_RADIUS = 6;

/**
 * Radius around a city within which the army is "at" that city: units this
 * close stage from it, screen it and fall back on it.
 */
export const MILITARY_SITUATION_RADIUS = 4;

/**
 * A city counts as `incoming_assault` once the enemy strength bearing on it is
 * at least a small warband's worth (weighted by distance, so adjacent raiders
 * count for far more than ones on the rim of the radius).
 */
const INCOMING_ASSAULT_STRENGTH = 2.5;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * What a city means to the civ's coordinated force RIGHT NOW. This is the
 * bridge between army coordination and city building: a barracks only earns
 * its upkeep in a city that actually feeds the army, walls only in one the
 * army has to protect. The building auditor reads this.
 */
export type CityMilitaryRole =
  /** Enemy force is converging — the city is about to be attacked. */
  | 'incoming_assault'
  /** Our own army stages/marches from here: it is a forward base. */
  | 'assault_staging'
  /** Only defenders are parked here; no offensive force operates from it. */
  | 'garrison_only'
  /** Nothing military is happening around this city. */
  | 'quiet';

export interface CityMilitarySituation {
  cityId: string;
  role: CityMilitaryRole;
  /** Our own army groups this civ fields at all. */
  activeGroupCount: number;
  /** Our groups whose rally point sits within the situation radius. */
  stagingGroupCount: number;
  /** Our groups that are committed (marching/attacking) from this city. */
  assaultingGroupCount: number;
  /** Our combat units within the radius. */
  nearbyOwnUnits: number;
  /** Combat strength of those units. */
  nearbyOwnStrength: number;
  /** Enemy units within the radius (raw, unweighted). */
  nearbyEnemyUnits: number;
  /**
   * Enemy strength bearing down on the city, weighted by distance the same
   * way `assessCityThreat` weights pressure (near = much heavier).
   */
  incomingEnemyStrength: number;
  /** Enemy army groups targeting this city (only when the caller tracks them). */
  incomingGroupCount: number;
}

export interface CityMilitarySituationInput {
  city: { id: string; col: number; row: number };
  /** Army groups the civ fields (own formations). */
  groups: ArmyGroup[];
  /** Enemy army groups, when the caller knows of them. Optional. */
  enemyGroups?: ArmyGroup[];
  /** Every unit on the map, own and enemy. */
  units: Unit[];
  civilizationId: number;
  distanceFn: (col1: number, row1: number, col2: number, row2: number) => number;
  /** Radius that counts as "this city". Defaults to MILITARY_SITUATION_RADIUS. */
  radius?: number;
}

/** Options injected by the engine-aware caller (AIManager). */
export interface ArmyGroupOptions {
  /** Whether a rally tile is passable for the group's (land) units. */
  isPassable?: (col: number, row: number) => boolean;
  /** Whether a unit can actually march to the target (same landmass). */
  isReachable?: (
    unit: Unit,
    target: { col: number; row: number },
  ) => boolean;
  /** Whether the group's target still holds an enemy (else the group drops). */
  isTargetValid?: (target: { col: number; row: number }) => boolean;
  /** Current round, used for the rally timeout. */
  roundNumber?: number;
}

// ---------------------------------------------------------------------------
// AICoordinator class
// ---------------------------------------------------------------------------

export class AICoordinator {
  /**
   * Form army groups from available combat units heading toward known targets.
   * 
   * @param combatUnits - All combat units for this civilization
   * @param targets - Known enemy positions to form groups around
   * @param existingGroups - Previously formed groups to update
   * @param distanceFn - Distance function (col1,row1,col2,row2) => number
   * @returns Updated army groups
   */
  static formArmyGroups(
    combatUnits: Unit[],
    targets: Array<{ col: number; row: number; type: 'city' | 'unit'; estimatedStrength: number }>,
    existingGroups: ArmyGroup[],
    distanceFn: (col1: number, row1: number, col2: number, row2: number) => number,
    options: ArmyGroupOptions = {},
  ): ArmyGroup[] {
    if (combatUnits.length < MIN_GROUP_SIZE || targets.length === 0) {
      return existingGroups;
    }

    const groups: ArmyGroup[] = [];
    const assignedUnitIds = new Set<string>();

    // Carry forward existing groups that still have valid units and targets.
    // A group whose target no longer holds an enemy (captured city, killed
    // unit) is dropped so its units can be re-tasked.
    for (const group of existingGroups) {
      if (options.isTargetValid && !options.isTargetValid(group.targetLocation)) {
        continue;
      }
      const validUnits = group.unitIds.filter(id => combatUnits.some(u => u.id === id));
      if (validUnits.length >= 2) {
        groups.push({
          ...group,
          unitIds: validUnits,
          currentStrength: AICoordinator.calculateGroupStrength(
            validUnits.map(id => combatUnits.find(u => u.id === id)!).filter(Boolean)
          ),
          formedRound: group.formedRound ?? options.roundNumber ?? 0,
        });
        validUnits.forEach(id => assignedUnitIds.add(id));
      }
    }

    // For each target, try to form a new group from unassigned units
    for (const target of targets) {
      const requiredStrength = target.estimatedStrength * ATTACK_READINESS_MULTIPLIER;

      // Find nearby unassigned combat units that can actually march to the
      // target (a unit on another landmass would stall the whole group).
      const nearbyUnits = combatUnits
        .filter(u => !assignedUnitIds.has(u.id))
        .filter(u => (options.isReachable ? options.isReachable(u, target) : true))
        .map(u => ({
          unit: u,
          distance: distanceFn(u.col, u.row, target.col, target.row),
        }))
        .filter(u => u.distance <= MAX_GROUP_DISTANCE * 2) // Wide net for initial grouping
        .sort((a, b) => a.distance - b.distance);

      if (nearbyUnits.length < MIN_GROUP_SIZE) continue;

      // Take enough units to meet required strength
      const groupUnits: Unit[] = [];
      let groupStrength = 0;

      for (const { unit } of nearbyUnits) {
        groupUnits.push(unit);
        groupStrength += (unit.attack || 1) + (unit.defense || 0) * 0.5;
        assignedUnitIds.add(unit.id);

        if (groupStrength >= requiredStrength && groupUnits.length >= MIN_GROUP_SIZE) {
          break;
        }
      }

      if (groupUnits.length >= MIN_GROUP_SIZE) {
        // Rally point: the centroid, snapped to the nearest passable land tile
        // so the group can actually gather there.
        const rallyPoint = AICoordinator.findRallyPoint(groupUnits, options.isPassable);
        if (!rallyPoint) continue; // nowhere to gather — do not form the group

        groups.push({
          id: `army_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          unitIds: groupUnits.map(u => u.id),
          targetLocation: { col: target.col, row: target.row },
          rallyPoint,
          status: 'forming',
          requiredStrength,
          currentStrength: groupStrength,
          formedRound: options.roundNumber ?? 0,
        });
      }
    }

    // Limit to max 2 concurrent groups
    return groups.slice(0, 2);
  }

  /**
   * The group's rally point: the centroid of its units, snapped outward to the
   * nearest passable tile. Returns null when no passable tile is found within
   * `RALLY_SEARCH_RADIUS` (the caller then skips the group).
   */
  private static findRallyPoint(
    units: Unit[],
    isPassable?: (col: number, row: number) => boolean,
  ): { col: number; row: number } | null {
    if (units.length === 0) return null;
    const cx = Math.round(units.reduce((sum, u) => sum + u.col, 0) / units.length);
    const cy = Math.round(units.reduce((sum, u) => sum + u.row, 0) / units.length);
    if (!isPassable) return { col: cx, row: cy };
    if (isPassable(cx, cy)) return { col: cx, row: cy };

    for (let radius = 1; radius <= RALLY_SEARCH_RADIUS; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
          const col = cx + dc;
          const row = cy + dr;
          if (isPassable(col, row)) return { col, row };
        }
      }
    }
    return null;
  }

  /**
   * Get the target for a unit based on its army group assignment.
   * Returns null if unit is not in any group.
   */
  static getGroupTarget(
    unitId: string,
    armyGroups: ArmyGroup[]
  ): { col: number; row: number; groupStatus: ArmyGroup['status'] } | null {
    for (const group of armyGroups) {
      if (!group.unitIds.includes(unitId)) continue;

      switch (group.status) {
        case 'forming':
          // A group that already has enough strength does not wait for the
          // last straggler — it presses on to the target.
          if (group.currentStrength >= group.requiredStrength) {
            return { col: group.targetLocation.col, row: group.targetLocation.row, groupStatus: 'forming' };
          }
          // Otherwise move to the rally point.
          return { col: group.rallyPoint.col, row: group.rallyPoint.row, groupStatus: 'forming' };
        case 'marching':
        case 'attacking':
          // Move toward target
          return { col: group.targetLocation.col, row: group.targetLocation.row, groupStatus: group.status };
      }
    }
    return null;
  }

  /**
   * Update army group statuses based on unit positions.
   * Call this once per turn before unit processing.
   */
  static updateGroupStatuses(
    armyGroups: ArmyGroup[],
    units: Unit[],
    distanceFn: (col1: number, row1: number, col2: number, row2: number) => number,
    roundNumber?: number,
  ): void {
    for (const group of armyGroups) {
      const groupUnits = group.unitIds
        .map(id => units.find(u => u.id === id))
        .filter((u): u is Unit => u !== undefined);

      if (groupUnits.length === 0) {
        group.status = 'forming';
        continue;
      }

      // Calculate how gathered the group is
      const avgDistToRally = groupUnits.reduce(
        (sum, u) => sum + distanceFn(u.col, u.row, group.rallyPoint.col, group.rallyPoint.row), 0
      ) / groupUnits.length;

      const avgDistToTarget = groupUnits.reduce(
        (sum, u) => sum + distanceFn(u.col, u.row, group.targetLocation.col, group.targetLocation.row), 0
      ) / groupUnits.length;

      if (group.status === 'forming') {
        // Transition to marching only when most units are actually near the
        // rally point. The old comparison used groupUnits.length on both
        // sides, so every group instantly left the forming phase and marched
        // as a scattered line.
        const gatheredUnits = groupUnits.filter((unit) =>
          distanceFn(unit.col, unit.row, group.rallyPoint.col, group.rallyPoint.row) <= 2
        ).length;
        // Escalation: a rally that cannot be reached must not freeze the
        // group forever — after the timeout it marches anyway.
        const rallyTimedOut =
          typeof roundNumber === 'number' &&
          typeof group.formedRound === 'number' &&
          roundNumber - group.formedRound >= RALLY_TIMEOUT_ROUNDS;
        if (avgDistToRally <= 2 || gatheredUnits >= groupUnits.length * 0.75 || rallyTimedOut) {
          group.status = 'marching';
          debugLog(`[AICoordinator] Army group ${group.id}: forming -> marching (${gatheredUnits}/${groupUnits.length} gathered, avg rally dist: ${avgDistToRally.toFixed(1)}${rallyTimedOut ? ', rally timeout' : ''})`);
        }
      }

      if (group.status === 'marching') {
        // Transition to attacking when close to target — or immediately when
        // any group unit is already in attack range (a vanguard must not wait
        // for the rest of the army).
        const anyAdjacent = groupUnits.some(
          (unit) => distanceFn(unit.col, unit.row, group.targetLocation.col, group.targetLocation.row) <= 1,
        );
        if (avgDistToTarget <= 3 || anyAdjacent) {
          group.status = 'attacking';
          debugLog(`[AICoordinator] Army group ${group.id}: marching -> attacking (avg target dist: ${avgDistToTarget.toFixed(1)}${anyAdjacent ? ', vanguard in range' : ''})`);
        }
      }

      // Update current strength
      group.currentStrength = AICoordinator.calculateGroupStrength(groupUnits);
    }
  }

  /**
   * Determine if a unit should retreat based on local threat assessment.
   * 
   * @param unitStrength - The unit's effective combat strength
   * @param localEnemyStrength - Total enemy strength in immediate area
   * @param isInArmyGroup - Whether the unit is part of an army group
   * @returns true if the unit should retreat
   */
  static shouldRetreat(
    unitStrength: number,
    localEnemyStrength: number,
    isInArmyGroup: boolean
  ): boolean {
    // Units in army groups have higher morale — harder to break
    const threshold = isInArmyGroup ? RETREAT_THRESHOLD * 1.5 : RETREAT_THRESHOLD;
    return localEnemyStrength > unitStrength * threshold;
  }

  /**
   * Find the best retreat target for a unit.
   * Prefers nearest friendly city, or nearest army group rally point.
   */
  static getRetreatTarget(
    unitCol: number,
    unitRow: number,
    friendlyCities: City[],
    armyGroups: ArmyGroup[],
    distanceFn: (col1: number, row1: number, col2: number, row2: number) => number
  ): { col: number; row: number } | null {
    let bestTarget: { col: number; row: number } | null = null;
    let bestDistance = Infinity;

    // Check friendly cities
    for (const city of friendlyCities) {
      const dist = distanceFn(unitCol, unitRow, city.col, city.row);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestTarget = { col: city.col, row: city.row };
      }
    }

    // Check army group rally points
    for (const group of armyGroups) {
      if (group.status === 'forming' || group.status === 'marching') {
        const dist = distanceFn(unitCol, unitRow, group.rallyPoint.col, group.rallyPoint.row);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestTarget = { col: group.rallyPoint.col, row: group.rallyPoint.row };
        }
      }
    }

    return bestTarget;
  }

  /**
   * Evaluate if an army group has sufficient strength to attack.
   */
  static evaluateArmyReadiness(group: ArmyGroup): 'ready' | 'forming' | 'insufficient' {
    if (group.unitIds.length < MIN_GROUP_SIZE) return 'insufficient';
    if (group.currentStrength >= group.requiredStrength) return 'ready';
    if (group.currentStrength >= group.requiredStrength * 0.7) return 'forming'; // Close enough, keep gathering
    return 'insufficient';
  }

  /**
   * Read a city's military ROLE out of the army formations around it.
   *
   * `formArmyGroups`/`getGroupTarget` decide where units go; this answers the
   * question the building auditor needs: *is this city part of the war effort
   * at all?* Without it a barracks in a quiet backwater of a peaceful empire
   * looks exactly like a barracks in a city an army group is mustering from,
   * so the AI keeps paying upkeep for an advantage it never uses.
   *
   * Pure — no engine access, like the rest of this class — so the callers
   * (BuildingAnalyzer) stay testable.
   */
  static summarizeCityMilitarySituation({
    city,
    groups,
    enemyGroups = [],
    units,
    civilizationId,
    distanceFn,
    radius = MILITARY_SITUATION_RADIUS,
  }: CityMilitarySituationInput): CityMilitarySituation {
    let nearbyOwnUnits = 0;
    let nearbyOwnStrength = 0;
    let nearbyEnemyUnits = 0;
    let incomingEnemyStrength = 0;

    for (const unit of units) {
      if (unit.isDefeated) continue;
      const distance = distanceFn(unit.col, unit.row, city.col, city.row);
      if (distance > radius) continue;
      const strength = AICoordinator.unitStrength(unit);
      if (unit.civilizationId === civilizationId) {
        nearbyOwnUnits += 1;
        nearbyOwnStrength += strength;
      } else {
        nearbyEnemyUnits += 1;
        // Distance weighting mirrors `assessCityThreat`: an adjacent attacker
        // is worth far more than one on the rim of the radius.
        incomingEnemyStrength += strength / (distance + 1);
      }
    }

    let stagingGroupCount = 0;
    let assaultingGroupCount = 0;
    for (const group of groups) {
      const stagingDistance = distanceFn(
        group.rallyPoint.col, group.rallyPoint.row, city.col, city.row,
      );
      if (stagingDistance > radius) continue;
      stagingGroupCount += 1;
      if (group.status === 'marching' || group.status === 'attacking') {
        assaultingGroupCount += 1;
      }
    }

    let incomingGroupCount = 0;
    for (const group of enemyGroups) {
      const targetDistance = distanceFn(
        group.targetLocation.col, group.targetLocation.row, city.col, city.row,
      );
      if (targetDistance <= radius) incomingGroupCount += 1;
    }

    let role: CityMilitaryRole;
    if (incomingGroupCount > 0 || incomingEnemyStrength >= INCOMING_ASSAULT_STRENGTH) {
      role = 'incoming_assault';
    } else if (assaultingGroupCount > 0) {
      role = 'assault_staging';
    } else if (stagingGroupCount > 0 || nearbyOwnUnits > 0) {
      role = 'garrison_only';
    } else {
      role = 'quiet';
    }

    return {
      cityId: city.id,
      role,
      activeGroupCount: groups.length,
      stagingGroupCount,
      assaultingGroupCount,
      nearbyOwnUnits,
      nearbyOwnStrength: round1(nearbyOwnStrength),
      nearbyEnemyUnits,
      incomingEnemyStrength: round1(incomingEnemyStrength),
      incomingGroupCount,
    };
  }

  /**
   * Calculate total combat strength of a group of units.
   */
  private static calculateGroupStrength(units: Unit[]): number {
    return units.reduce((total, unit) => total + AICoordinator.unitStrength(unit), 0);
  }

  /** Shared combat-strength model — identical to `calculateGroupStrength`. */
  private static unitStrength(unit: Unit): number {
    return Math.max(1, unit.attack || 0) + (unit.defense || 0) * 0.5;
  }

  // -------------------------------------------------------------------------
  // Forced liquidation: selling buildings to fund a plan
  // -------------------------------------------------------------------------

  /**
   * Turn a set of spending intents into a concrete list of buildings to sell.
   *
   * The passive audit only sells a building that has stopped earning its
   * upkeep. This is the opposite pressure: the civ has decided it NEEDS to spend
   * — settlers for public works, units for an army, a bribe for a war that has
   * gone badly — and is short of money. Something has to go.
   *
   * The rule that keeps this from becoming vandalism is that only a building
   * which is not paying its own way may be sold. Liquidating a profitable
   * building to raise money would mean paying more in lost income than it saves
   * in upkeep, losing on both sides of the trade, so those are never eligible
   * however badly the treasury is doing. What can be sold is exactly the set the
   * cost/usage equation already calls a drain or inert.
   *
   * Pure — the caller executes the sales.
   */
  static planBuildingFunding(input: BuildingFundingInput): BuildingFundingPlan {
    const { demands, budget, candidates } = input;

    const ranked = [...demands].sort((a, b) => b.urgency - a.urgency || b.goldNeeded - a.goldNeeded);
    const totalNeeded = ranked.reduce((sum, d) => sum + Math.max(0, d.goldNeeded), 0);
    const shortfall = Math.max(0, totalNeeded - budget);

    const reasons: string[] = [];
    if (totalNeeded === 0) reasons.push('no spending demand');
    if (shortfall === 0 && totalNeeded > 0) reasons.push('the treasury already covers the plan');
    if (budget <= 0 && totalNeeded > 0) reasons.push('nothing in the treasury');

    if (shortfall <= 0) {
      return { demands: ranked, totalNeeded, available: budget, shortfall, sales: [], reasons };
    }

    // Only buildings that cost more than they earn are eligible, and the
    // smallest loss first — a 1 gold/turn drain goes before a 4 gold/turn one,
    // because it closes the same gap while giving up less income. Hence the
    // descending sort on `netPerTurn`: the value closest to zero is cheapest.
    const eligible = candidates
      .filter(c => c.economics.netPerTurn < 0)
      .sort((a, b) => b.economics.netPerTurn - a.economics.netPerTurn);

    if (eligible.length === 0) {
      reasons.push('nothing left to sell that would not cost more than it saves');
      return { demands: ranked, totalNeeded, available: budget, shortfall, sales: [], reasons };
    }

    // Refunds are part of the money raised, so the plan can finish without
    // waiting for the freed upkeep to arrive next turn.
    let raised = 0;
    let savedPerTurn = 0;
    const sales: BuildingFundingSale[] = [];
    for (const candidate of eligible) {
      raised += candidate.refund;
      savedPerTurn += -candidate.economics.netPerTurn;
      sales.push({
        cityId: candidate.cityId,
        cityName: candidate.cityName,
        buildingType: candidate.buildingType,
        refund: candidate.refund,
        netPerTurn: candidate.economics.netPerTurn,
        verdict: candidate.economics.verdict,
        reason: candidate.economics.reasons[candidate.economics.reasons.length - 1] ?? '',
      });
      // One turn's income is enough to close the gap; liquidation beyond that
      // is just vandalism with extra steps.
      if (raised + savedPerTurn >= shortfall) break;
    }

    reasons.push(
      `selling ${sales.length} building(s) raises ${Math.round(raised)} gold and saves `
      + `${round1(savedPerTurn)} gold/turn to cover a ${Math.round(shortfall)} gold shortfall`,
    );

    return { demands: ranked, totalNeeded, available: budget, shortfall, sales, reasons };
  }
}

export type FundingKind = 'infrastructure' | 'army' | 'bribe';

/** One thing the civ wants to spend money on. */
export interface FundingDemand {
  kind: FundingKind;
  label: string;
  goldNeeded: number;
  /** 0..1 — how badly this want trumps the others. */
  urgency: number;
}

/** A building the funding plan may liquidate. */
export interface BuildingFundingCandidate {
  cityId: string;
  cityName: string;
  buildingType: string;
  /** Gold recovered from the 50% refund. */
  refund: number;
  economics: BuildingEconomics;
}

export interface BuildingFundingSale {
  cityId: string;
  cityName: string;
  buildingType: string;
  refund: number;
  netPerTurn: number;
  verdict: BuildingEconomics['verdict'];
  reason: string;
}

export interface BuildingFundingInput {
  demands: FundingDemand[];
  /** Gold the civ can already spend. */
  budget: number;
  candidates: BuildingFundingCandidate[];
}

export interface BuildingFundingPlan {
  demands: FundingDemand[];
  totalNeeded: number;
  available: number;
  shortfall: number;
  /** Ordered cheapest-loss first; the caller executes. */
  sales: BuildingFundingSale[];
  reasons: string[];
}
