/**
 * AICoordinator - Inter-unit coordination and army group management
 * 
 * Groups combat units into coordinated army groups that rally, march,
 * and attack together. Also provides retreat/regroup logic for
 * outmatched units.
 */

import type { Unit, City } from '../../../../types/game';
import type { ArmyGroup } from './AITypes';

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
          console.log(`[AICoordinator] Army group ${group.id}: forming -> marching (${gatheredUnits}/${groupUnits.length} gathered, avg rally dist: ${avgDistToRally.toFixed(1)}${rallyTimedOut ? ', rally timeout' : ''})`);
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
          console.log(`[AICoordinator] Army group ${group.id}: marching -> attacking (avg target dist: ${avgDistToTarget.toFixed(1)}${anyAdjacent ? ', vanguard in range' : ''})`);
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
   * Calculate total combat strength of a group of units.
   */
  private static calculateGroupStrength(units: Unit[]): number {
    return units.reduce((total, unit) => {
      return total + Math.max(1, unit.attack || 0) + (unit.defense || 0) * 0.5;
    }, 0);
  }
}
