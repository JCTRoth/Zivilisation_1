/**
 * The AI's naval relevance: a warship fleet is worth something only when
 * there is OPEN SEA to fight over.
 *
 * The three failures this pins, all of them seen on a real map:
 *
 *  1. A LAKE in the middle of a continent split the land into two
 *     "landmasses" by the walking test, the AI read that as an archipelago,
 *     opened the naval research branch and built a warship fleet — for a pond.
 *  2. A WIDE RIVER split the empire, and the AI wanted a boat (correct: a
 *     trireme ferries troops over a river) — but not a FLEET. The river map
 *     has no shore, so the warship ladder must stay shut.
 *  3. A settler waiting for a hull to reach an island is a city that is not
 *     settled yet. The fleet planner used to build gunboats instead of the
 *     ferry, and the islands stayed empty.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { desiredTransports, navalDoctrine, type NavalDoctrineInput } from '@/game/engine/AI/NavalDoctrine';

/** A minimal engine over a hand-written map. */
function makeEngine(rows: string[][]): GameEngine {
  const height = rows.length;
  const width = rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.civilizations = [];
  e.onStateChange = null;
  e.unitTurnQueue = null;
  e.diplomacyManager = null;
  e.isPaused = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: rows.flatMap((row, r) =>
      row.map((type, c) => ({ col: c, row: r, type, terrain: type, visible: true, explored: true })),
    ),
  };
  e.checkAndEndTurnIfNoMoves = () => undefined;
  return e as GameEngine;
}

describe('naval relevance — a fleet needs open sea', () => {
  it('a lake in the middle of the land is not a shore', () => {
    // A lake column down the middle: the two banks cannot walk to each other.
    const e = makeEngine([
      ['plains', 'lake', 'plains'],
      ['plains', 'lake', 'plains'],
      ['plains', 'lake', 'plains'],
    ]);
    // Walking: the lake splits the land in two.
    expect(e.areLandConnected(0, 1, 2, 1)).toBe(false);
    // Sailing: there is no sea at all, so the whole map is ONE shore.
    expect(e.getSeaLandmassCount()).toBe(1);
    expect(e.areSeaConnected(0, 1, 2, 1)).toBe(true);
  });

  it('a lake-split empire needs no navy at all', () => {
    const e = makeEngine([
      ['plains', 'lake', 'plains'],
      ['plains', 'lake', 'plains'],
      ['plains', 'lake', 'plains'],
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{ id: 0, technologies: ['sailing'] }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [
      { id: 'left', name: 'Left', civilizationId: 0, col: 0, row: 1, population: 2, buildings: [], buildQueue: [] },
      { id: 'right', name: 'Right', civilizationId: 0, col: 2, row: 1, population: 2, buildings: [], buildQueue: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).initializePlayerStorage(0);

    // No ship in the game may enter a lake, so no hull can bridge the gap.
    expect(e.areBoatConnected(0, 1, 2, 1)).toBe(false);
    expect(e.civNeedsNavy(0)).toBe(false);
  });

  it('a wide river wants a BOAT, not a fleet', () => {
    const e = makeEngine([
      ['plains', 'plains', 'river', 'river', 'plains', 'plains'],
      ['plains', 'plains', 'river', 'river', 'plains', 'plains'],
      ['plains', 'plains', 'river', 'river', 'plains', 'plains'],
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{ id: 0, technologies: ['sailing'] }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [
      { id: 'left', name: 'Left', civilizationId: 0, col: 1, row: 1, population: 2, buildings: [], buildQueue: [] },
      { id: 'right', name: 'Right', civilizationId: 0, col: 4, row: 1, population: 2, buildings: [], buildQueue: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).initializePlayerStorage(0);

    // The river splits the land, and a hull CAN cross it…
    expect(e.areLandConnected(1, 1, 4, 1)).toBe(false);
    expect(e.areBoatConnected(1, 1, 4, 1)).toBe(true);
    // …so the civ needs a boat…
    expect(e.civNeedsNavy(0)).toBe(true);
    // …but a river is not a shore: there is no open sea, so no FLEET.
    expect(e.getSeaLandmassCount()).toBe(1);
  });

  it('an archipelago has more than one shore', () => {
    const e = makeEngine([
      ['ocean', 'ocean', 'ocean', 'ocean', 'ocean'],
      ['ocean', 'plains', 'ocean', 'plains', 'ocean'],
      ['ocean', 'ocean', 'ocean', 'ocean', 'ocean'],
    ]);
    expect(e.getSeaLandmassCount()).toBe(2);
    expect(e.areSeaConnected(1, 1, 3, 1)).toBe(false);
  });
});

describe('the fleet waits for the settler that is already ashore', () => {
  const baseInput = (): NavalDoctrineInput => ({
    treasury: 500,
    incomePerTurn: 60,
    upkeepPerTurn: 20,
    reservePerTurn: 10,
    ownTransports: 0,
    ownWarships: 0,
    ownCities: 3,
    ownCoastalCities: 2,
    threatenedOwnCoastalCities: 0,
    colonisableIslands: 2,
    seaInvasionTargets: 0,
    troopsAvailable: true,
    atWar: false,
    enemyTransports: 0,
    enemyWarships: 0,
    enemyCoastalCities: 0,
    landmassCount: 3,
    needsNavy: true,
    bestAvailableShip: { type: 'frigate', cost: 180, maintenance: 4, attack: 8, defense: 8, transportCapacity: 0 },
    cheapestAvailableShip: { type: 'sail', cost: 40, maintenance: 1, attack: 1, defense: 1, transportCapacity: 0 },
  });

  it('a settler waiting for a hull adds a hull to the sealift', () => {
    const without = desiredTransports(baseInput());
    const with_ = desiredTransports({ ...baseInput(), pendingColonies: 3 });
    expect(with_).toBeGreaterThan(without);
  });

  it('the doctrine still calls for a fleet on an archipelago', () => {
    const verdict = navalDoctrine(baseInput());
    expect(verdict.wantWarships).toBeGreaterThan(0);
  });
});
