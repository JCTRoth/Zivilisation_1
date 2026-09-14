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
    distanceFn: (col1: number, row1: number, col2: number, row2: number) => number
  ): ArmyGroup[] {
    if (combatUnits.length < MIN_GROUP_SIZE || targets.length === 0) {
      return existingGroups;
    }

    const groups: ArmyGroup[] = [];
    const assignedUnitIds = new Set<string>();

    // Carry forward existing groups that still have valid units and targets
    for (const group of existingGroups) {
      const validUnits = group.unitIds.filter(id => combatUnits.some(u => u.id === id));
      if (validUnits.length >= 2) {
        groups.push({
          ...group,
          unitIds: validUnits,
          currentStrength: AICoordinator.calculateGroupStrength(
            validUnits.map(id => combatUnits.find(u => u.id === id)!).filter(Boolean)
          ),
        });
        validUnits.forEach(id => assignedUnitIds.add(id));
      }
    }

    // For each target, try to form a new group from unassigned units
    for (const target of targets) {
      const requiredStrength = target.estimatedStrength * ATTACK_READINESS_MULTIPLIER;

      // Find nearby unassigned combat units
      const nearbyUnits = combatUnits
        .filter(u => !assignedUnitIds.has(u.id))
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
        // Calculate rally point: centroid of the group units
        const rallyCol = Math.round(groupUnits.reduce((sum, u) => sum + u.col, 0) / groupUnits.length);
        const rallyRow = Math.round(groupUnits.reduce((sum, u) => sum + u.row, 0) / groupUnits.length);

        groups.push({
          id: `army_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          unitIds: groupUnits.map(u => u.id),
          targetLocation: { col: target.col, row: target.row },
          rallyPoint: { col: rallyCol, row: rallyRow },
          status: 'forming',
          requiredStrength,
          currentStrength: groupStrength,
        });
      }
    }

    // Limit to max 2 concurrent groups
    return groups.slice(0, 2);
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
          // Move to rally point
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
    distanceFn: (col1: number, row1: number, col2: number, row2: number) => number
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
        if (avgDistToRally <= 2 || gatheredUnits >= groupUnits.length * 0.75) {
          group.status = 'marching';
          console.log(`[AICoordinator] Army group ${group.id}: forming -> marching (${gatheredUnits}/${groupUnits.length} gathered, avg rally dist: ${avgDistToRally.toFixed(1)})`);
        }
      }

      if (group.status === 'marching') {
        // Transition to attacking when close to target
        if (avgDistToTarget <= 3) {
          group.status = 'attacking';
          console.log(`[AICoordinator] Army group ${group.id}: marching -> attacking (avg target dist: ${avgDistToTarget.toFixed(1)})`);
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
