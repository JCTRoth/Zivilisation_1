import { describe, expect, it } from 'vitest';
import { AIManager } from '@/game/engine/AI/AIManager';

/**
 * `AIManager.getWarPlan` is the read-only bridge the dev-mode "Forge of War"
 * overlay uses to draw an AI player's war plan. It must mirror exactly what the
 * AI itself stored — target, committed army, odds and posture — and must still
 * produce a usable record (target: null) for a civ that is only defending.
 */
const engineWith = (options: {
  storage?: Record<string, unknown>;
  city?: { name: string; civilizationId: number } | null;
}) => {
  const engine: any = {
    getPlayerStorage: () => options.storage,
    getCityAt: () => options.city ?? null,
    roundManager: { getRoundNumber: () => 42 },
  };
  return engine;
};

const plan = (overrides: Record<string, unknown> = {}) => ({
  target: { col: 10, row: 5 },
  targetType: 'city',
  requiredUnits: 4,
  assignedUnitIds: ['u1', 'u2', 'u3'],
  roundPrepared: 31,
  targetDefense: 12.5,
  targetCivId: 2,
  reachableBy: 'land',
  ...overrides,
});

describe('AI war plan — dev overlay read-out', () => {
  it('maps a committed city offensive with its assigned army and odds', () => {
    const manager = new AIManager(
      engineWith({
        storage: {
          turnData: {
            offensivePlan: plan(),
            aiState: { aggression: { posture: 'aggressive', score: 77 } },
          },
        },
        city: { name: 'Argos', civilizationId: 2 },
      }),
    );

    const warPlan = manager.getWarPlan(0);

    expect(warPlan).toMatchObject({
      civilizationId: 0,
      round: 31,
      requiredUnits: 4,
      targetDefense: 12.5,
      reachableBy: 'land',
      posture: 'aggressive',
      aggression: 77,
    });
    expect(warPlan.target).toEqual({
      col: 10,
      row: 5,
      kind: 'city',
      name: 'Argos',
      civId: 2,
    });
    expect(warPlan.assignedUnitIds).toEqual(['u1', 'u2', 'u3']);
  });

  it('keeps the civ readable while it has no committed offensive', () => {
    const manager = new AIManager(
      engineWith({
        storage: {
          turnData: {
            aiState: { aggression: { posture: 'defensive', score: 12 } },
          },
        },
      }),
    );

    const warPlan = manager.getWarPlan(5);

    expect(warPlan.target).toBeNull();
    expect(warPlan.assignedUnitIds).toEqual([]);
    expect(warPlan.posture).toBe('defensive');
    expect(warPlan.aggression).toBe(12);
    // No plan → the current round is the useful timestamp.
    expect(warPlan.round).toBe(42);
  });

  it('leaves a unit target nameless and reports no city defense', () => {
    const manager = new AIManager(
      engineWith({
        storage: {
          turnData: {
            offensivePlan: plan({ targetType: 'unit', targetDefense: undefined }),
          },
        },
      }),
    );

    const warPlan = manager.getWarPlan(0);

    expect(warPlan.target).toMatchObject({ kind: 'unit', name: null });
    expect(warPlan.targetDefense).toBe(0);
  });

  it('marks a sea invasion', () => {
    const manager = new AIManager(
      engineWith({
        storage: {
          turnData: {
            offensivePlan: plan({ reachableBy: 'sea', assignedUnitIds: [] }),
          },
        },
      }),
    );

    const warPlan = manager.getWarPlan(0);

    expect(warPlan.reachableBy).toBe('sea');
    expect(warPlan.assignedUnitIds).toEqual([]);
  });

  it('copies the assigned ids so the overlay cannot mutate AI storage', () => {
    const assignedUnitIds = ['u1'];
    const manager = new AIManager(
      engineWith({
        storage: { turnData: { offensivePlan: plan({ assignedUnitIds }) } },
      }),
    );

    manager.getWarPlan(0).assignedUnitIds.push('tampered');

    expect(assignedUnitIds).toEqual(['u1']);
  });
});
