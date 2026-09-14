import { describe, it, expect } from 'vitest';
import { AICoordinator } from '@/game/engine/AI/AICoordinator';
import type { ArmyGroup } from '@/game/engine/AI/AITypes';
import type { Unit, City } from '@/../types/game';

const makeUnit = (overrides: Partial<Unit> = {}): Unit => ({
  id: `unit-${Math.random().toString(36).slice(2, 6)}`,
  type: 'warrior',
  civilizationId: 1,
  col: 5,
  row: 5,
  attack: 2,
  defense: 1,
  movesRemaining: 1,
  isHuman: false,
  ...overrides,
} as any);

const makeTarget = (overrides: Record<string, unknown> = {}) => ({
  col: 20,
  row: 20,
  type: 'city' as const,
  estimatedStrength: 5,
  ...overrides,
});

const distanceFn = (col1: number, row1: number, col2: number, row2: number): number =>
  Math.max(Math.abs(col1 - col2), Math.abs(row1 - row2));

describe('AICoordinator.formArmyGroups', () => {
  it('should not form groups with fewer than 3 combat units', () => {
    const units = [makeUnit({ col: 5, row: 5 }), makeUnit({ col: 6, row: 5 })];
    const groups = AICoordinator.formArmyGroups(units, [makeTarget()], [], distanceFn);
    expect(groups).toEqual([]);
  });

  it('should form a group when enough units are near a target', () => {
    const units = [
      makeUnit({ col: 10, row: 10 }),
      makeUnit({ col: 11, row: 10 }),
      makeUnit({ col: 10, row: 11 }),
      makeUnit({ col: 12, row: 12 }),
    ];
    const targets = [makeTarget({ col: 15, row: 15, estimatedStrength: 3 })];
    const groups = AICoordinator.formArmyGroups(units, targets, [], distanceFn);

    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].unitIds.length).toBeGreaterThanOrEqual(3);
    expect(groups[0].status).toBe('forming');
  });

  it('should limit to 2 concurrent groups', () => {
    const units = Array.from({ length: 10 }, (_, i) => makeUnit({ col: i, row: 0 }));
    const targets = [
      makeTarget({ col: 5, row: 5 }),
      makeTarget({ col: 10, row: 10 }),
      makeTarget({ col: 15, row: 15 }),
    ];
    const groups = AICoordinator.formArmyGroups(units, targets, [], distanceFn);
    expect(groups.length).toBeLessThanOrEqual(2);
  });

  it('should carry forward existing valid groups', () => {
    const units = [
      makeUnit({ id: 'a', col: 5, row: 5 }),
      makeUnit({ id: 'b', col: 6, row: 5 }),
      makeUnit({ id: 'c', col: 5, row: 6 }),
    ];
    const existingGroup: ArmyGroup = {
      id: 'existing',
      unitIds: ['a', 'b', 'c'],
      targetLocation: { col: 20, row: 20 },
      rallyPoint: { col: 5, row: 5 },
      status: 'marching',
      requiredStrength: 5,
      currentStrength: 7,
    };

    const groups = AICoordinator.formArmyGroups(units, [makeTarget()], [existingGroup], distanceFn);
    const carried = groups.find(g => g.id === 'existing');
    expect(carried).toBeDefined();
    expect(carried!.unitIds).toContain('a');
  });
});

describe('AICoordinator.getGroupTarget', () => {
  const group: ArmyGroup = {
    id: 'grp-1',
    unitIds: ['u1', 'u2', 'u3'],
    targetLocation: { col: 20, row: 20 },
    rallyPoint: { col: 10, row: 10 },
    status: 'forming',
    requiredStrength: 10,
    currentStrength: 8,
  };

  it('should return rally point when forming', () => {
    const target = AICoordinator.getGroupTarget('u1', [group]);
    expect(target).toEqual({ col: 10, row: 10, groupStatus: 'forming' });
  });

  it('should return target location when marching', () => {
    const marchingGroup = { ...group, status: 'marching' as const };
    const target = AICoordinator.getGroupTarget('u2', [marchingGroup]);
    expect(target).toEqual({ col: 20, row: 20, groupStatus: 'marching' });
  });

  it('should return null for units not in any group', () => {
    const target = AICoordinator.getGroupTarget('unknown-unit', [group]);
    expect(target).toBeNull();
  });
});

describe('AICoordinator.updateGroupStatuses', () => {
  it('keeps a scattered army in forming until most units reach the rally point', () => {
    const group: ArmyGroup = {
      id: 'scattered',
      unitIds: ['a', 'b', 'c'],
      targetLocation: { col: 20, row: 20 },
      rallyPoint: { col: 0, row: 0 },
      status: 'forming',
      requiredStrength: 5,
      currentStrength: 6,
    };
    const units = [
      makeUnit({ id: 'a', col: 0, row: 0 }),
      makeUnit({ id: 'b', col: 10, row: 0 }),
      makeUnit({ id: 'c', col: 10, row: 10 }),
    ];

    AICoordinator.updateGroupStatuses([group], units, distanceFn);
    expect(group.status).toBe('forming');

    units[1].col = 1;
    units[1].row = 0;
    units[2].col = 0;
    units[2].row = 1;
    AICoordinator.updateGroupStatuses([group], units, distanceFn);
    expect(group.status).toBe('marching');
  });
});

describe('AICoordinator.shouldRetreat', () => {
  it('should retreat when enemy strength is much higher', () => {
    expect(AICoordinator.shouldRetreat(3, 10, false)).toBe(true);
  });

  it('should not retreat when evenly matched', () => {
    expect(AICoordinator.shouldRetreat(5, 5, false)).toBe(false);
  });

  it('should have higher threshold for army group members', () => {
    // Enemy strength 8, own 3 → ratio 2.67 > RETREAT_THRESHOLD(2.0) for solo
    expect(AICoordinator.shouldRetreat(3, 8, false)).toBe(true);
    // In army group, threshold is 2.0 * 1.5 = 3.0, ratio 2.67 < 3.0
    expect(AICoordinator.shouldRetreat(3, 8, true)).toBe(false);
  });
});

describe('AICoordinator.getRetreatTarget', () => {
  it('should prefer nearest friendly city', () => {
    const cities = [
      { col: 1, row: 1 } as City,
      { col: 10, row: 10 } as City,
    ];
    const target = AICoordinator.getRetreatTarget(8, 8, cities, [], distanceFn);
    expect(target).toEqual({ col: 10, row: 10 });
  });

  it('should consider army group rally points', () => {
    const groups: ArmyGroup[] = [{
      id: 'g1',
      unitIds: [],
      targetLocation: { col: 30, row: 30 },
      rallyPoint: { col: 7, row: 7 },
      status: 'forming',
      requiredStrength: 10,
      currentStrength: 5,
    }];
    // No cities nearby, rally point at (7,7) is close to unit at (8,8)
    const target = AICoordinator.getRetreatTarget(8, 8, [], groups, distanceFn);
    expect(target).toEqual({ col: 7, row: 7 });
  });

  it('should return null when no retreat options exist', () => {
    const target = AICoordinator.getRetreatTarget(50, 50, [], [], distanceFn);
    expect(target).toBeNull();
  });
});

describe('AICoordinator.evaluateArmyReadiness', () => {
  it('should return insufficient for groups below minimum size', () => {
    const group: ArmyGroup = {
      id: 'small',
      unitIds: ['a', 'b'],
      targetLocation: { col: 0, row: 0 },
      rallyPoint: { col: 0, row: 0 },
      status: 'forming',
      requiredStrength: 10,
      currentStrength: 5,
    };
    expect(AICoordinator.evaluateArmyReadiness(group)).toBe('insufficient');
  });

  it('should return ready when strength exceeds requirement', () => {
    const group: ArmyGroup = {
      id: 'strong',
      unitIds: ['a', 'b', 'c', 'd'],
      targetLocation: { col: 0, row: 0 },
      rallyPoint: { col: 0, row: 0 },
      status: 'forming',
      requiredStrength: 10,
      currentStrength: 12,
    };
    expect(AICoordinator.evaluateArmyReadiness(group)).toBe('ready');
  });

  it('should return forming when at 70-99% strength', () => {
    const group: ArmyGroup = {
      id: 'almost',
      unitIds: ['a', 'b', 'c'],
      targetLocation: { col: 0, row: 0 },
      rallyPoint: { col: 0, row: 0 },
      status: 'forming',
      requiredStrength: 10,
      currentStrength: 8,
    };
    expect(AICoordinator.evaluateArmyReadiness(group)).toBe('forming');
  });
});
