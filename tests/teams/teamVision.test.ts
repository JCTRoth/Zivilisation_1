import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/** A real 3-civ team game: civs 0 and 1 are locked teammates, 2 is the enemy. */
async function newTeamGame(): Promise<GameEngine> {
  const engine = new GameEngine(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (engine as any).sleep = () => Promise.resolve();
  await engine.initialize({
    numberOfCivilizations: 3,
    mapType: 'NORMAL_SKIRMISH',
    mapWidth: 40,
    mapHeight: 30,
    devMode: false,
    startingGold: 100,
    fixedAlliances: true,
    teamAssignments: [0, 0, 1],
  });
  return engine;
}

describe('shared team vision', () => {
  it('teammates see the sight and explored ground of each other', async () => {
    const engine = await newTeamGame();
    expect(engine.teamManager.enabled).toBe(true);
    expect(engine.teamManager.getTeammates(0)).toEqual([1]);
    expect(engine.teamManager.getTeammates(2)).toEqual([]);

    // A tile only civ 0's starting units can see: adjacent to a civ-0 unit but
    // far from every civ-1 start (starts are scattered at least 12 tiles apart).
    const civ0Unit = engine.units.find((u) => u.civilizationId === 0)!;
    const tile = { col: civ0Unit.col + 1, row: civ0Unit.row };

    // Civ 0 sees its own unit's surroundings…
    expect(engine.isVisibleToPlayer(0, tile.col, tile.row)).toBe(true);
    // …and so does its teammate, through the shared fog…
    expect(engine.isVisibleToPlayer(1, tile.col, tile.row)).toBe(true);
    // …while the enemy does not.
    expect(engine.isVisibleToPlayer(2, tile.col, tile.row)).toBe(false);

    // Explored ground is shared too, so teammates keep the map once seen.
    expect(engine.isExploredByPlayer(0, tile.col, tile.row)).toBe(true);
    expect(engine.isExploredByPlayer(1, tile.col, tile.row)).toBe(true);
    expect(engine.isExploredByPlayer(2, tile.col, tile.row)).toBe(false);
  });

  it('revealArea during play shares to teammates but not to the enemy', async () => {
    const engine = await newTeamGame();

    // Pick a tile nobody sees yet so the assertion can only pass by sharing.
    let target: { col: number; row: number } | null = null;
    for (let row = 0; row < engine.map!.height && !target; row++) {
      for (let col = 0; col < engine.map!.width; col++) {
        const seen = [0, 1, 2].some((id) => engine.isVisibleToPlayer(id, col, row));
        if (!seen) target = { col, row };
      }
    }
    expect(target).not.toBeNull();

    engine.activePlayer = 0;
    engine.revealArea(target!.col, target!.row, 2);

    expect(engine.isVisibleToPlayer(0, target!.col, target!.row)).toBe(true);
    expect(engine.isVisibleToPlayer(1, target!.col, target!.row)).toBe(true);
    expect(engine.isVisibleToPlayer(2, target!.col, target!.row)).toBe(false);
  });

  it('teammates share diplomatic contact', async () => {
    const engine = await newTeamGame();
    const dm = engine.diplomacyManager;

    // Civ 0 has not met the enemy (civ 2) yet.
    expect(dm.hasContacted(0, 2)).toBe(false);
    // Its teammate (civ 1) meets civ 2.
    expect(dm.markContact(1, 2)).toBe(true);
    // Shared intelligence: civ 0 has now met civ 2 too.
    expect(dm.hasContacted(0, 2)).toBe(true);
    // The enemy did not inherit anything (it has no teammates).
    expect(dm.hasContacted(2, 0)).toBe(false);
  });

  it('free-for-all games share nothing (unchanged behaviour)', async () => {
    const engine = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 3,
      mapType: 'NORMAL_SKIRMISH',
      mapWidth: 40,
      mapHeight: 30,
      devMode: false,
      startingGold: 100,
      // no fixedAlliances → free-for-all
    });
    expect(engine.teamManager.enabled).toBe(false);

    const civ0Unit = engine.units.find((u) => u.civilizationId === 0)!;
    const tile = { col: civ0Unit.col + 1, row: civ0Unit.row };

    expect(engine.isVisibleToPlayer(0, tile.col, tile.row)).toBe(true);
    // Another civilization does not inherit civ 0's sight.
    expect(engine.isVisibleToPlayer(1, tile.col, tile.row)).toBe(false);
  });
});
