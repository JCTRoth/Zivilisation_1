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

describe('AICoordinator.summarizeCityMilitarySituation', () => {
  const city = { id: 'capital', col: 10, row: 10 };

  const makeGroup = (overrides: Partial<ArmyGroup> = {}): ArmyGroup => ({
    id: 'group',
    unitIds: ['a', 'b', 'c'],
    targetLocation: { col: 20, row: 20 },
    rallyPoint: { col: 11, row: 10 },
    status: 'forming',
    requiredStrength: 10,
    currentStrength: 10,
    ...overrides,
  });

  const summarize = (over: Partial<Parameters<typeof AICoordinator.summarizeCityMilitarySituation>[0]> = {}) =>
    AICoordinator.summarizeCityMilitarySituation({
      city,
      groups: [],
      units: [],
      civilizationId: 1,
      distanceFn,
      ...over,
    });

  it('reports a quiet city when nothing military is happening', () => {
    const situation = summarize();
    expect(situation.role).toBe('quiet');
    expect(situation.nearbyOwnUnits).toBe(0);
    expect(situation.incomingEnemyStrength).toBe(0);
  });

  it('reports assault_staging for a city a committed group marches from', () => {
    const situation = summarize({
      groups: [makeGroup({ status: 'marching' })],
      units: [
        makeUnit({ civilizationId: 1, col: 10, row: 10 }),
        makeUnit({ civilizationId: 1, col: 11, row: 10 }),
      ],
    });
    expect(situation.role).toBe('assault_staging');
    expect(situation.assaultingGroupCount).toBe(1);
    expect(situation.stagingGroupCount).toBe(1);
    expect(situation.nearbyOwnUnits).toBe(2);
  });

  it('reports garrison_only when defenders sit there but no group operates from it', () => {
    const situation = summarize({
      units: [
        makeUnit({ civilizationId: 1, col: 10, row: 10 }),
        makeUnit({ civilizationId: 1, col: 11, row: 11 }),
      ],
    });
    expect(situation.role).toBe('garrison_only');
    expect(situation.assaultingGroupCount).toBe(0);
  });

  it('a forming group staging nearby is not yet an assault base', () => {
    const situation = summarize({ groups: [makeGroup({ status: 'forming' })] });
    expect(situation.role).toBe('garrison_only');
    expect(situation.stagingGroupCount).toBe(1);
  });

  it('reports incoming_assault when enemy strength bears down on the city', () => {
    const situation = summarize({
      units: [
        makeUnit({ civilizationId: 2, col: 10, row: 11, attack: 6 }),
        makeUnit({ civilizationId: 2, col: 11, row: 11, attack: 6 }),
      ],
    });
    expect(situation.role).toBe('incoming_assault');
    expect(situation.nearbyEnemyUnits).toBe(2);
    expect(situation.incomingEnemyStrength).toBeGreaterThan(2.5);
  });

  it('reports incoming_assault for an enemy group targeting the city', () => {
    const situation = summarize({
      enemyGroups: [makeGroup({ targetLocation: { col: 10, row: 12 } })],
    });
    expect(situation.role).toBe('incoming_assault');
    expect(situation.incomingGroupCount).toBe(1);
  });

  it('weights incoming enemy strength by distance (adjacent raiders count more)', () => {
    const adjacent = summarize({ units: [makeUnit({ civilizationId: 2, col: 11, row: 10, attack: 4 })] });
    const distant = summarize({ units: [makeUnit({ civilizationId: 2, col: 14, row: 10, attack: 4 })] });
    expect(adjacent.incomingEnemyStrength).toBeGreaterThan(distant.incomingEnemyStrength);
  });

  it('ignores units outside the situation radius', () => {
    const situation = summarize({
      units: [makeUnit({ civilizationId: 1, col: 10, row: 18 })],
    });
    expect(situation.nearbyOwnUnits).toBe(0);
    expect(situation.role).toBe('quiet');
  });

  it('ignores defeated units', () => {
    const situation = summarize({
      units: [makeUnit({ civilizationId: 2, col: 10, row: 10, isDefeated: true })],
    });
    expect(situation.incomingEnemyStrength).toBe(0);
    expect(situation.role).toBe('quiet');
  });

  it('respects a custom radius', () => {
    const units = [makeUnit({ civilizationId: 1, col: 13, row: 10 })];
    expect(summarize({ units, radius: 2 }).nearbyOwnUnits).toBe(0);
    expect(summarize({ units, radius: 4 }).nearbyOwnUnits).toBe(1);
  });
});

describe('AICoordinator.pruneStaleGroups', () => {
  const liveGroup: ArmyGroup = {
    id: 'live',
    unitIds: ['a', 'b', 'c'],
    targetLocation: { col: 20, row: 20 },
    rallyPoint: { col: 10, row: 10 },
    status: 'forming',
    requiredStrength: 10,
    currentStrength: 8,
  };
  const liveIds = new Set(['a', 'b', 'c', 'd', 'e']);
  const validTarget = () => true;
  const invalidTarget = () => false;

  it('keeps a coherent group with live units and a valid target', () => {
    const pruned = AICoordinator.pruneStaleGroups([liveGroup], liveIds, { isTargetValid: validTarget });
    expect(pruned).toHaveLength(1);
    expect(pruned[0].unitIds).toEqual(['a', 'b', 'c']);
  });

  it('drops a group whose target no longer holds an enemy', () => {
    const pruned = AICoordinator.pruneStaleGroups([liveGroup], liveIds, { isTargetValid: invalidTarget });
    expect(pruned).toEqual([]);
  });

  it('drops a group left with fewer than 2 live units', () => {
    const pruned = AICoordinator.pruneStaleGroups([liveGroup], new Set(['a']), { isTargetValid: validTarget });
    expect(pruned).toEqual([]);
  });

  it('strips dead unit ids from a surviving group', () => {
    const pruned = AICoordinator.pruneStaleGroups([liveGroup], new Set(['a', 'b']), { isTargetValid: validTarget });
    expect(pruned).toHaveLength(1);
    expect(pruned[0].unitIds).toEqual(['a', 'b']);
  });

  it('keeps groups when no validity check is provided', () => {
    const pruned = AICoordinator.pruneStaleGroups([liveGroup], liveIds);
    expect(pruned).toHaveLength(1);
  });
});

describe('AICoordinator.scoreSettlerExposure', () => {
  const BARB = 99;
  const hostileCivIds = new Set([BARB]);
  const settler = { col: 10, row: 10 };
  const score = (over: Record<string, unknown> = {}) =>
    AICoordinator.scoreSettlerExposure({
      settler,
      destination: null,
      units: [],
      civilizationId: 1,
      hostileCivIds,
      distanceFn,
      ...over,
    } as Parameters<typeof AICoordinator.scoreSettlerExposure>[0]);

  it('is zero when no hostile is near', () => {
    const exposure = score({
      units: [
        makeUnit({ civilizationId: 1, col: 10, row: 11 }),
        makeUnit({ civilizationId: 2, col: 11, row: 10 }),
      ],
    });
    expect(exposure.threat).toBe(0);
    expect(exposure.hostileCount).toBe(0);
    expect(exposure.nearestThreatDistance).toBe(-1);
  });

  it('counts a barbarian by strength over distance', () => {
    // Warrior 2/1 -> strength 2.5 at distance 2 -> 2.5 / 3 ~= 0.8.
    const exposure = score({ units: [makeUnit({ civilizationId: BARB, col: 12, row: 10 })] });
    expect(exposure.hostileCount).toBe(1);
    expect(exposure.nearestThreatDistance).toBe(2);
    expect(exposure.threat).toBeCloseTo(0.8, 1);
  });

  it('counts a raider sitting on the destination, not the settler', () => {
    const exposure = score({
      destination: { col: 14, row: 10 },
      units: [makeUnit({ civilizationId: BARB, col: 14, row: 11 })],
    });
    expect(exposure.hostileCount).toBe(1);
    expect(exposure.nearestThreatDistance).toBe(1);
  });

  it('ignores defeated and out-of-range hostiles', () => {
    const exposure = score({
      units: [
        makeUnit({ civilizationId: BARB, col: 11, row: 10, isDefeated: true }),
        makeUnit({ civilizationId: BARB, col: 10, row: 20 }),
      ],
    });
    expect(exposure.threat).toBe(0);
    expect(exposure.hostileCount).toBe(0);
  });
});

describe('AICoordinator.shouldSettlerHold', () => {
  const high = { threat: 1.5, nearestThreatDistance: 1, hostileCount: 2 };
  const distant = { threat: 1.5, nearestThreatDistance: 4, hostileCount: 3 };
  const calm = { threat: 0, nearestThreatDistance: -1, hostileCount: 0 };

  it('holds an unguarded settler facing killing-blow threat up close', () => {
    expect(AICoordinator.shouldSettlerHold(high, false)).toBe(true);
  });

  it('never holds a guarded settler', () => {
    expect(AICoordinator.shouldSettlerHold(high, true)).toBe(false);
  });

  it('does not freeze the walk for a distant menace', () => {
    expect(AICoordinator.shouldSettlerHold(distant, false)).toBe(false);
  });

  it('walks when nothing is near', () => {
    expect(AICoordinator.shouldSettlerHold(calm, false)).toBe(false);
  });
});

describe('AICoordinator.assignSettlerGuards', () => {
  const pair = (over: Record<string, unknown> = {}) =>
    AICoordinator.assignSettlerGuards({
      settlers: [{ id: 's1', col: 10, row: 10 }],
      guards: [{ id: 'g1', col: 11, row: 10 }],
      distanceFn,
      ...over,
    } as Parameters<typeof AICoordinator.assignSettlerGuards>[0]);

  it('pairs the nearest guard', () => {
    const pairs = pair({
      settlers: [{ id: 's1', col: 10, row: 10 }],
      guards: [
        { id: 'g1', col: 15, row: 10 },
        { id: 'g2', col: 11, row: 10 },
      ],
    });
    expect(pairs.get('s1')).toBe('g2');
  });

  it('assigns one guard per settler — the second walker goes unguarded', () => {
    const pairs = pair({
      settlers: [
        { id: 's1', col: 10, row: 10 },
        { id: 's2', col: 10, row: 12 },
      ],
      guards: [{ id: 'g1', col: 11, row: 10 }],
    });
    expect(pairs.get('s1')).toBe('g1');
    expect(pairs.get('s2')).toBeNull();
  });

  it('leaves the settler unguarded when no guard is in range', () => {
    const pairs = pair({ guards: [{ id: 'g1', col: 10, row: 30 }] });
    expect(pairs.get('s1')).toBeNull();
  });

  it('keeps a live pairing instead of thrashing to a nearer guard', () => {
    const pairs = pair({
      guards: [
        { id: 'g1', col: 14, row: 10 },
        { id: 'g2', col: 11, row: 10 },
      ],
      existingPairs: new Map([['s1', 'g1']]),
      liveSettlerIds: new Set(['s1']),
      liveGuardIds: new Set(['g1', 'g2']),
    });
    expect(pairs.get('s1')).toBe('g1');
  });

  it('re-tasks when the old guard is dead', () => {
    const pairs = pair({
      guards: [
        { id: 'g1', col: 11, row: 10 },
        { id: 'g2', col: 12, row: 10 },
      ],
      existingPairs: new Map([['s1', 'g1']]),
      liveSettlerIds: new Set(['s1']),
      liveGuardIds: new Set(['g2']),
    });
    expect(pairs.get('s1')).toBe('g2');
  });

  it('skips settlers that are no longer alive', () => {
    const pairs = pair({
      settlers: [
        { id: 's1', col: 10, row: 10 },
        { id: 's2', col: 10, row: 12 },
      ],
      existingPairs: new Map([['s2', 'g1']]),
      liveSettlerIds: new Set(['s1']),
      liveGuardIds: new Set(['g1']),
    });
    expect(pairs.has('s2')).toBe(false);
    expect(pairs.get('s1')).toBe('g1');
  });
});

describe('readiness-gated group targeting', () => {
  it('a 2-unit remnant below strength rallies instead of suiciding', () => {
    const remnant: ArmyGroup = {
      id: 'remnant',
      unitIds: ['u1', 'u2'],
      targetLocation: { col: 20, row: 20 },
      rallyPoint: { col: 10, row: 10 },
      status: 'forming',
      requiredStrength: 10,
      currentStrength: 10,
    };
    const target = AICoordinator.getGroupTarget('u1', [remnant]);
    expect(target).toEqual({ col: 10, row: 10, groupStatus: 'forming' });
  });
});
