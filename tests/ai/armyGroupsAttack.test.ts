/**
 * Army groups must actually ATTACK — not just form.
 *
 * Regression focus:
 *  - the rally point is snapped to passable land (a rally on water used to
 *    freeze the group in `forming` forever),
 *  - a stalled rally times out and the group marches anyway,
 *  - a vanguard in range flips the group to `attacking`,
 *  - groups whose target was captured/killed are dropped,
 *  - a group with enough strength presses on while still "forming",
 *  - the city-defense reserve keeps at least 3 units free for offense,
 *  - end-to-end: a group unit targets the enemy city and captures it.
 */
import { describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { AICoordinator } from '@/game/engine/AI/AICoordinator';
import type { ArmyGroup } from '@/game/engine/AI/AITypes';
import type { Unit } from '../../types/game';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

const distanceFn = (c1: number, r1: number, c2: number, r2: number): number =>
  Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: `u-${Math.random().toString(36).slice(2, 6)}`,
  type: 'warrior',
  civilizationId: 0,
  col: 5,
  row: 5,
  attack: 2,
  defense: 1,
  health: 100,
  movesRemaining: 1,
  isDefeated: false,
  ...overrides,
} as Unit);

const target = (overrides: Record<string, unknown> = {}) => ({
  col: 20, row: 20, type: 'city' as const, estimatedStrength: 5,
  ...overrides,
});

describe('AICoordinator: rally points are reachable', () => {
  it('snaps the rally point off impassable water to the nearest land tile', () => {
    const units = [
      unit({ id: 'a', col: 4, row: 4 }),
      unit({ id: 'b', col: 6, row: 4 }),
      unit({ id: 'c', col: 5, row: 6 }),
    ];
    // Only land at col <= 3 is passable; the centroid (5,4) is water.
    const groups = AICoordinator.formArmyGroups(
      units, [target({ col: 12, row: 4, estimatedStrength: 3 })], [], distanceFn,
      { isPassable: (col) => col <= 3 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rallyPoint.col).toBeLessThanOrEqual(3);
    expect(groups[0].formedRound).toBe(0);
  });

  it('does not form a group when there is no passable rally tile', () => {
    const units = [
      unit({ id: 'a', col: 4, row: 4 }),
      unit({ id: 'b', col: 6, row: 4 }),
      unit({ id: 'c', col: 5, row: 6 }),
    ];
    const groups = AICoordinator.formArmyGroups(
      units, [target({ col: 12, row: 4, estimatedStrength: 3 })], [], distanceFn,
      { isPassable: () => false },
    );
    expect(groups).toEqual([]);
  });

  it('drops a carried-forward group whose target no longer holds an enemy', () => {
    const units = [
      unit({ id: 'a', col: 5, row: 5 }),
      unit({ id: 'b', col: 6, row: 5 }),
      unit({ id: 'c', col: 5, row: 6 }),
    ];
    const existing: ArmyGroup = {
      id: 'stale', unitIds: ['a', 'b', 'c'],
      targetLocation: { col: 9, row: 9 }, rallyPoint: { col: 5, row: 5 },
      status: 'marching', requiredStrength: 5, currentStrength: 7,
    };
    const groups = AICoordinator.formArmyGroups(
      units, [target({ col: 12, row: 12, estimatedStrength: 3 })], [existing], distanceFn,
      { isTargetValid: () => false },
    );
    expect(groups.find((g) => g.id === 'stale')).toBeUndefined();
  });
});

describe('AICoordinator: groups escalate to attacks', () => {
  const baseGroup = (overrides: Partial<ArmyGroup> = {}): ArmyGroup => ({
    id: 'g', unitIds: ['a', 'b', 'c'],
    targetLocation: { col: 20, row: 20 }, rallyPoint: { col: 0, row: 0 },
    status: 'forming', requiredStrength: 10, currentStrength: 6,
    formedRound: 0,
    ...overrides,
  });

  it('times out a stalled rally and marches anyway', () => {
    const group = baseGroup();
    const units = [
      unit({ id: 'a', col: 0, row: 0 }),
      unit({ id: 'b', col: 10, row: 0 }),
      unit({ id: 'c', col: 10, row: 10 }),
    ];
    AICoordinator.updateGroupStatuses([group], units, distanceFn, 2);
    expect(group.status).toBe('forming');

    // Six rounds later the group stops waiting.
    AICoordinator.updateGroupStatuses([group], units, distanceFn, 6);
    expect(group.status).toBe('marching');
  });

  it('flips to attacking when a vanguard reaches the target', () => {
    const group = baseGroup({ status: 'marching' });
    const units = [
      unit({ id: 'a', col: 19, row: 20 }), // adjacent to the target
      unit({ id: 'b', col: 15, row: 15 }),
      unit({ id: 'c', col: 14, row: 14 }),
    ];
    AICoordinator.updateGroupStatuses([group], units, distanceFn, 3);
    expect(group.status).toBe('attacking');
    const t = AICoordinator.getGroupTarget('a', [group]);
    expect(t).toEqual({ col: 20, row: 20, groupStatus: 'attacking' });
  });

  it('a group with enough strength presses on while still forming', () => {
    const strong = baseGroup({ currentStrength: 12, requiredStrength: 10 });
    const weak = baseGroup({ currentStrength: 6, requiredStrength: 10 });
    expect(AICoordinator.getGroupTarget('a', [strong])).toEqual({
      col: 20, row: 20, groupStatus: 'forming',
    });
    expect(AICoordinator.getGroupTarget('a', [weak])).toEqual({
      col: 0, row: 0, groupStatus: 'forming',
    });
  });
});

// ---------------------------------------------------------------------------
// Reserve policy + end-to-end attack
// ---------------------------------------------------------------------------

function makeBattleEngine() {
  const size = 14;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.onStateChange = null;
  e.unitTurnQueue = null;
  e.diplomacyManager = null;
  e.isPaused = true;
  e.activePlayer = 0;
  e.devMode = true;
  e.squareGrid = new SquareGrid(size, size);
  e.map = {
    width: size,
    height: size,
    tiles: Array.from({ length: size * size }, (_, index) => {
      const col = index % size;
      const row = Math.floor(index / size);
      return { col, row, type: TERRAIN_TYPES.PLAINS, terrain: TERRAIN_TYPES.PLAINS, resource: null, visible: true, explored: true };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Attackers', isHuman: false, isAI: true, technologies: ['bronze_working'], resources: { gold: 100 }, personality: { aggression: 9, expansion: 5, diplomacy: 5, science: 5, military: 8, economy: 5 } },
    { id: 1, name: 'Defenders', isHuman: false, isAI: true, technologies: [], resources: { gold: 0 }, personality: { aggression: 1, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 } },
  ];
  e.cities = [
    { id: 'home', name: 'Home', civilizationId: 0, col: 1, row: 1, population: 2, buildings: [], buildQueue: [], currentProduction: null, tradeRoutes: [] },
    { id: 'enemy', name: 'Enemy City', civilizationId: 1, col: 11, row: 11, population: 2, buildings: [], buildQueue: [], currentProduction: null, tradeRoutes: [] },
  ];
  e.checkAndEndTurnIfNoMoves = () => undefined;
  e.initializePlayerStorage(0);
  return e as GameEngine;
}

function addWarrior(e: GameEngine, id: string, col: number, row: number): Unit {
  const u = unit({ id, col, row, movesRemaining: 2 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).units.push(u);
  return u;
}

describe('Army groups actually attack', () => {
  it('keeps at least 3 units free for offense when the army is small', () => {
    const e = makeBattleEngine();
    addWarrior(e, 'w1', 5, 5);
    addWarrior(e, 'w2', 6, 5);
    addWarrior(e, 'w3', 5, 6);
    addWarrior(e, 'w4', 10, 11); // adjacent to the enemy city
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reserves = (e.aiManager as any).getCityDefenseReserveIds(0) as Set<string>;
    // 4 units, 1 city → only 1 reserve; 3 remain for the group.
    expect(reserves.size).toBe(1);
  });

  it('keeps a committed offensive plan instead of resetting assignments each turn', () => {
    const e = makeBattleEngine();
    addWarrior(e, 'w1', 5, 5);
    addWarrior(e, 'w2', 6, 5);
    addWarrior(e, 'w3', 5, 6);
    addWarrior(e, 'w4', 6, 6);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = e.aiManager as any;
    const storage = e.getPlayerStorage(0)!;
    storage.enemyLocations.set(1, [{
      col: 11, row: 11, type: 'city', id: 'enemy', discoveredRound: 0, lastSeenRound: 0,
    }]);

    manager.updateOffensivePlan(0, storage, 0);
    const plan = storage.turnData.offensivePlan as {
      target: { col: number; row: number }; assignedUnitIds: string[];
    };
    expect(plan).toBeDefined();
    expect(plan.target).toEqual({ col: 11, row: 11 });

    // Assign a NON-reserve unit (one unit always garrisons the home city),
    // then re-plan next round: the assignment must survive.
    const reserves = manager.getCityDefenseReserveIds(0) as Set<string>;
    const attacker = e.units.find((u) => !reserves.has(u.id))!;
    const assignedTarget = manager.getOffensivePlanTarget(attacker, storage) as { col: number; row: number };
    expect(assignedTarget).toEqual({ col: 11, row: 11 });
    expect(plan.assignedUnitIds).toContain(attacker.id);

    manager.updateOffensivePlan(0, storage, 1);
    const kept = storage.turnData.offensivePlan as { assignedUnitIds: string[] };
    expect(kept.assignedUnitIds).toContain(attacker.id);

    // Capturing the target clears the plan (it is no longer valid).
    const city = e.getCityAt(11, 11)!;
    city.civilizationId = 0;
    manager.updateOffensivePlan(0, storage, 2);
    const afterCapture = storage.turnData.offensivePlan as { target?: { col: number; row: number } } | null;
    // Either re-planned to another target or cleared — never still pointing at
    // the now-friendly city.
    if (afterCapture?.target) {
      expect(afterCapture.target).not.toEqual({ col: 11, row: 11 });
    }
  });

  it('forms a group, marches and captures the enemy city', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    try {
      const e = makeBattleEngine();
      addWarrior(e, 'w1', 5, 5);
      addWarrior(e, 'w2', 6, 5);
      addWarrior(e, 'w3', 5, 6);
      const vanguard = addWarrior(e, 'w4', 10, 11);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = e.aiManager as any;
      const storage = e.getPlayerStorage(0)!;
      storage.enemyLocations.set(1, [{
        col: 11, row: 11, type: 'city', id: 'enemy', discoveredRound: 0, lastSeenRound: 0,
      }]);

      const combatUnits = e.units.filter((u) => u.civilizationId === 0);
      const reserveIds = manager.getCityDefenseReserveIds(0, combatUnits) as Set<string>;
      const offensiveUnits = combatUnits.filter((u) => !reserveIds.has(u.id));
      expect(offensiveUnits.length).toBeGreaterThanOrEqual(3);

      const targets = manager.getKnownEnemyTargets(0, storage) as Array<{
        col: number; row: number; type: 'city' | 'unit'; estimatedStrength: number;
      }>;
      expect(targets.some((t) => t.col === 11 && t.row === 11)).toBe(true);

      const groups = AICoordinator.formArmyGroups(
        offensiveUnits, targets, [], distanceFn, {
          isPassable: (col: number, row: number) => e.isTilePassable(col, row),
          isReachable: (u: Unit, t: { col: number; row: number }) => e.areLandConnected(u.col, u.row, t.col, t.row),
          isTargetValid: () => true,
          roundNumber: 0,
        },
      );
      expect(groups).toHaveLength(1);
      // The group escalates and its members target the enemy city. The
      // vanguard is already adjacent, so it flips straight to 'attacking'.
      AICoordinator.updateGroupStatuses(groups, offensiveUnits, distanceFn, 10);
      expect(groups[0].status).toBe('attacking');

      const vanguardTarget = manager.chooseAITarget(vanguard) as { col: number; row: number };
      expect(vanguardTarget).toEqual({ col: 11, row: 11 });

      // The adjacent unit attacks and captures the city.
      const result = e.moveUnit(vanguard.id, 11, 11);
      expect(result.success).toBe(true);
      expect(e.getCityAt(11, 11)?.civilizationId).toBe(0);
    } finally {
      random.mockRestore();
    }
  });
});
