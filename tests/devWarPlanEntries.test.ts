import { describe, expect, it, vi } from 'vitest';
import {
  buildDevWarPlanEntries,
} from '@/utils/DevWarPlanEntries';
import { devWarPlanColor } from '@/utils/DevWarPlanColors';

/**
 * The Forge of War "All players" overview lists every AI player's current
 * objective at once. This is the selection/colour rule behind it: humans and
 * the barbarian faction are excluded (they have their own views), dead civs
 * are skipped, and each surviving AI gets a stable colour by id.
 */
const civ = (overrides: Record<string, unknown>) => ({
  id: 0,
  name: 'Civ',
  isAI: true,
  isAlive: true,
  ...overrides,
}) as any;

const plan = (civilizationId: number, target: unknown = null): any => ({
  civilizationId,
  round: 10,
  target,
  requiredUnits: 0,
  assignedUnitIds: [],
  targetDefense: 0,
  reachableBy: 'land',
  posture: 'defensive',
  aggression: 0,
});

describe('Dev overlay — all-players war-plan overview', () => {
  it('includes every living AI civ and excludes humans and the barbarians', () => {
    const getWarPlan = vi.fn((id: number) => plan(id));
    const entries = buildDevWarPlanEntries(
      [
        civ({ id: 0, name: 'Germans' }),
        civ({ id: 1, name: 'Huns' }),
        civ({ id: 2, name: 'Player', isAI: false }),
        civ({ id: -1, name: 'Barbarians' }),
        civ({ id: 3, name: 'Dead', isAlive: false }),
      ],
      getWarPlan,
      -1,
    );

    expect(entries.map((entry) => entry.playerName)).toEqual(['Germans', 'Huns']);
    expect(entries.map((entry) => entry.plan.civilizationId)).toEqual([0, 1]);
    expect(getWarPlan).toHaveBeenCalledTimes(2);
  });

  it('gives each civ its stable high-contrast colour', () => {
    const entries = buildDevWarPlanEntries(
      [civ({ id: 4, name: 'A' }), civ({ id: 5, name: 'B' })],
      (id) => plan(id),
    );

    expect(entries[0].color).toBe(devWarPlanColor(4));
    expect(entries[1].color).toBe(devWarPlanColor(5));
    // Two different civs must not share a colour in a normal game.
    expect(entries[0].color).not.toBe(entries[1].color);
  });

  it('returns an empty list when no AI civ is alive', () => {
    const entries = buildDevWarPlanEntries(
      [civ({ isAI: false }), civ({ id: 2, isAlive: false })],
      (id) => plan(id),
    );

    expect(entries).toEqual([]);
  });
});
