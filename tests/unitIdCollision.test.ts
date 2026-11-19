import { describe, it, expect, afterEach } from 'vitest';
import GameEngine from '@shared/game/engine/GameEngine';

/**
 * Unit id uniqueness (regression).
 *
 * The old id scheme `${type}_${civId}_${liveCount}` reused ids once a unit died,
 * because `liveCount` came from the CURRENT array length (which shrinks when a
 * unit is removed). A new unit could then inherit the id of a still-alive unit,
 * and any removal-by-id (combat setTimeout, UnitTurnQueue.removeUnit, ...)
 * deleted BOTH units at once — units silently going missing.
 */
describe('Unit id uniqueness', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as any).units = [];
      (engine as any).cities = [];
      (engine as any).civilizations = [];
      engine = null;
    }
  });

  async function setup(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as any).sleep = () => Promise.resolve();
    (e as any).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 1,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  function ids(e: GameEngine, civId: number): string[] {
    return ((e as any).units as Array<{ civilizationId: number; id: string }>)
      .filter((u) => u.civilizationId === civId)
      .map((u) => u.id);
  }

  it('creates sequential ids 0,1,2 for the first units', async () => {
    const e = await setup();
    (e as any).units = []; // clear starting units
    (e as any).createUnit(0, 'warrior', 5, 5);
    (e as any).createUnit(0, 'warrior', 6, 5);
    (e as any).createUnit(0, 'warrior', 7, 5);
    expect(ids(e, 0)).toEqual(['warrior_0_0', 'warrior_0_1', 'warrior_0_2']);
  });

  it('never reuses an id after a unit dies', async () => {
    const e = await setup();
    (e as any).units = [];
    (e as any).createUnit(0, 'warrior', 5, 5); // warrior_0_0
    (e as any).createUnit(0, 'warrior', 6, 5); // warrior_0_1
    (e as any).createUnit(0, 'warrior', 7, 5); // warrior_0_2

    // Simulate a death: warrior_0_0 leaves the live array.
    (e as any).units = (e as any).units.filter((u: any) => u.id !== 'warrior_0_0');

    // A new unit must NOT inherit a live unit's id (old bug: it became warrior_0_2).
    (e as any).createUnit(0, 'warrior', 8, 5);
    const all = ids(e, 0);
    expect(all).not.toContain('warrior_0_0');
    expect(all).toContain('warrior_0_3'); // monotonic — skipped the reused slot
    expect(new Set(all).size).toBe(all.length); // all unique
  });

  it('keeps ids unique across different unit types', async () => {
    const e = await setup();
    (e as any).units = [];
    (e as any).createUnit(0, 'settler', 5, 5); // settler_0_0
    (e as any).createUnit(0, 'warrior', 6, 5); // warrior_0_0
    (e as any).units = (e as any).units.filter((u: any) => u.id !== 'settler_0_0');
    (e as any).createUnit(0, 'settler', 7, 5); // must be settler_0_1, not settler_0_0
    const all = ids(e, 0);
    expect(all).toContain('warrior_0_0');
    expect(all).toContain('settler_0_1');
    expect(new Set(all).size).toBe(all.length);
  });

  it('removing a unit by id never removes a sibling sharing that id', async () => {
    const e = await setup();
    (e as any).units = [];
    (e as any).createUnit(0, 'warrior', 5, 5);
    (e as any).createUnit(0, 'warrior', 6, 5);
    (e as any).createUnit(0, 'warrior', 7, 5);
    // kill warrior_0_0
    (e as any).units = (e as any).units.filter((u: any) => u.id !== 'warrior_0_0');
    // old scheme would have created a new warrior_0_2 (collision with the live one)
    (e as any).createUnit(0, 'warrior', 8, 5);
    const before = ids(e, 0).length;
    // simulate combat removal of a defeated warrior_0_2
    (e as any).units = (e as any).units.filter((u: any) => u.id !== 'warrior_0_2');
    const after = ids(e, 0).length;
    expect(before - after).toBe(1); // exactly one unit removed
  });
});
