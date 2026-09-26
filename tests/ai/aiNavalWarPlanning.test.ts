/**
 * Naval aggression: an enemy on another island must be a valid REASON TO GO TO
 * WAR, even though no land army can march at it.
 *
 * Before this, `collectKnownTargets` dropped every enemy that was not
 * land-reachable. On an archipelago that emptied the target list, so
 * `planBulkAttack` produced no plan, so there was no `targetCivId` to declare
 * against — 0 declarations and 0 invasions in every naval run. The war now
 * happens; the invasion mission does the ferrying.
 */
import { describe, it, expect } from 'vitest';
import { planBulkAttack, type KnownTarget } from '@/game/engine/AI/AIAggression';

const W = 9;
/** A bare engine: enough for planBulkAttack's distance and city lookups. */
function makeEngine() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e: any = {
    cities: [
      { id: 'home', name: 'Islandport', civilizationId: 0, col: 2, row: 2, population: 3, hitPoints: 3, walls: false, buildings: [] },
      { id: 'far', name: 'Mainport', civilizationId: 1, col: 6, row: 2, population: 3, hitPoints: 3, walls: false, buildings: [] },
    ],
    units: [],
    map: { width: W, height: 5, tiles: [] },
    squareGrid: { squareDistance: (a: number, b: number, c: number, d: number) => Math.max(Math.abs(a - c), Math.abs(b - d)) },
    getCityAt: (col: number, row: number) =>
      e.cities.find((c: { col: number; row: number }) => c.col === col && c.row === row),
  };
  return e;
}

const target = (over: Partial<KnownTarget> = {}): KnownTarget => ({
  col: 6,
  row: 2,
  type: 'city',
  id: 'far',
  civId: 1,
  discoveredRound: 0,
  lastSeenRound: 0,
  ...over,
});

describe('naval war planning', () => {
  it('plans a war against an enemy city across the water', () => {
    const plan = planBulkAttack(
      makeEngine() as never,
      0,
      [target({ reachableBy: 'sea' })],
      40, // available strength
      6,  // eligible units
      0,  // round
      true, // aggressive
    );
    expect(plan).not.toBeNull();
    expect(plan!.targetCivId).toBe(1);
    expect(plan!.reachableBy).toBe('sea');
  });

  it('ignores a lone enemy unit across the water', () => {
    // You cannot ferry an army after one enemy scout; that is not a war.
    const plan = planBulkAttack(
      makeEngine() as never,
      0,
      [target({ type: 'unit', id: 'u1', reachableBy: 'sea' })],
      40,
      6,
      0,
      true,
    );
    expect(plan).toBeNull();
  });

  it('prefers a land target when both are available', () => {
    const engine = makeEngine();
    engine.cities.push({ id: 'near', name: 'Rivalport', civilizationId: 2, col: 1, row: 2, population: 3, hitPoints: 3, walls: false, buildings: [] });
    const plan = planBulkAttack(
      engine as never,
      0,
      [
        target({ reachableBy: 'sea' }),
        target({ col: 1, row: 2, id: 'near', civId: 2, reachableBy: 'land' }),
      ],
      40,
      6,
      0,
      true,
    );
    expect(plan).not.toBeNull();
    // The walkable city wins: an army on foot is already assembled.
    expect(plan!.targetCivId).toBe(2);
    expect(plan!.reachableBy).toBe('land');
  });

  it('still refuses a plan the civ cannot win', () => {
    // Reachability is not permission: a hopeless assault stays refused.
    const plan = planBulkAttack(
      makeEngine() as never,
      0,
      [target({ reachableBy: 'sea' })],
      0, // no strength at all
      0,
      0,
      true,
    );
    expect(plan).toBeNull();
  });
});
