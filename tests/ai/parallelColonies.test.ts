/**
 * Parallel island colonisation: the naval governor spawns settlers to several
 * uninhabited islands at once and builds them up in parallel.
 *
 *  - one mission per island (up to the parallel cap), never two on one rock;
 *  - each mission holds its own settler and hull; ferries are never shared;
 *  - completing one mission leaves its sisters sailing;
 *  - production is told how many colony settlers are still missing;
 *  - waiting settlers gather on the safest beach, not the nearest one.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { City, Unit } from '../../types/game';

const O = 'ocean';
const G = 'grassland';

// Home island (cols 0-2) plus three small islands in the ocean.
const MAP = [
  [G, G, G, O, O, O, O, O, O, O, O, O],
  [G, G, G, O, O, G, G, O, O, O, O, O],
  [G, G, G, O, O, G, G, O, O, G, G, O],
  [G, G, G, O, O, O, O, O, O, G, G, O],
  [G, G, G, O, O, O, O, O, O, O, O, O],
  [G, G, G, O, O, G, G, O, O, O, O, O],
];

function makeEngine() {
  const height = MAP.length;
  const width = MAP[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true;
  e.devMode = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: MAP.flat().map((type, i) => {
      const col = i % width;
      const row = Math.floor(i / width);
      return {
        id: `${col},${row}`,
        col,
        row,
        type,
        terrain: type,
        movement: type === O ? 99 : 1,
        defense: 1,
        resource: null,
        visible: true,
        explored: true,
      };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Islanders', isHuman: false, isAlive: true, technologies: ['sailing'], resources: { gold: 200 } },
    { id: 1, name: 'Rivals', isHuman: false, isAlive: true, technologies: ['sailing'], resources: { gold: 200 } },
  ];
  const enemies = new Map<string, number[]>();
  e.diplomacyManager = {
    getEnemies: (civId: number) => enemies.get(String(civId)) ?? [],
    isAtWar: (a: number, b: number) => (enemies.get(String(a)) ?? []).includes(b),
    declareWar: (a: number, b: number) => {
      const list = enemies.get(String(a)) ?? [];
      if (!list.includes(b)) list.push(b);
      enemies.set(String(a), list);
      const back = enemies.get(String(b)) ?? [];
      if (!back.includes(a)) back.push(a);
      enemies.set(String(b), back);
    },
  };
  e.initializePlayerStorage(0);
  e.initializePlayerStorage(1);
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number) {
  const city = {
    id: `city_${civId}_${name}`,
    name,
    civilizationId: civId,
    col,
    row,
    population: 3,
    buildings: [],
    buildQueue: [],
    currentProduction: null,
    tradeRoutes: [],
  };
  engine.cities.push(city as never);
  return city as City;
}

function addUnit(engine: GameEngine, opts: Partial<Unit> & { id: string; col: number; row: number }) {
  const unit = {
    civilizationId: 0,
    health: 100,
    movesRemaining: 1,
    isDefeated: false,
    attack: 1,
    defense: 1,
    hitPoints: 2,
    maxHitPoints: 2,
    movement: 1,
    maxMoves: 1,
    ...opts,
  };
  engine.units.push(unit as never);
  return unit as Unit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const managerOf = (engine: GameEngine) => engine.aiManager as any;

interface ColonyMissionLike {
  settlerId: string;
  ferryId: string | null;
  targetLandmassId: number;
  landTile: { col: number; row: number };
  waterTile: { col: number; row: number };
  stage: string;
}

const missionsOf = (engine: GameEngine, civId = 0): ColonyMissionLike[] =>
  (engine.getPlayerStorage(civId)?.turnData as { colonyMissions?: ColonyMissionLike[] })?.colonyMissions ?? [];

describe('parallel colony planning', () => {
  it('seeds several islands at once with one settler each', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    addUnit(e, { id: 's1', type: 'settler', col: 1, row: 2 });
    addUnit(e, { id: 's2', type: 'settler', col: 1, row: 3 });
    addUnit(e, { id: 'f1', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    // Three open islands — but only two settlers, so two missions.
    managerOf(e).updateColonyMission(e.civilizations[0], e.getPlayerStorage(0)!);
    const missions = missionsOf(e);
    expect(missions).toHaveLength(2);
    expect(new Set(missions.map((m) => m.settlerId))).toEqual(new Set(['s1', 's2']));
    // Different islands: never two missions on one rock.
    expect(new Set(missions.map((m) => m.targetLandmassId)).size).toBe(2);
  });

  it('caps parallel missions and assigns the hull to the first', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    for (let i = 0; i < 5; i++) addUnit(e, { id: `s${i}`, type: 'settler', col: 1, row: 2 });
    addUnit(e, { id: 'f1', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    managerOf(e).updateColonyMission(e.civilizations[0], e.getPlayerStorage(0)!);
    const missions = missionsOf(e);
    // Three islands open, cap is three — all three seeded.
    expect(missions).toHaveLength(3);
    expect(new Set(missions.map((m) => m.targetLandmassId)).size).toBe(3);
    // One hull: first mission sails it, the rest wait for production hulls.
    const hulled = missions.filter((m) => m.ferryId === 'f1');
    expect(hulled).toHaveLength(1);
    expect(missions.filter((m) => m.ferryId == null)).toHaveLength(2);
  });

  it('completing one mission leaves its sisters sailing', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    addUnit(e, { id: 's1', type: 'settler', col: 1, row: 2 });
    addUnit(e, { id: 's2', type: 'settler', col: 1, row: 3 });
    const f1 = addUnit(e, { id: 'f1', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    managerOf(e).updateColonyMission(e.civilizations[0], e.getPlayerStorage(0)!);
    const before = missionsOf(e);
    expect(before).toHaveLength(2);
    const first = before.find((m) => m.ferryId === 'f1')!;
    const storage = e.getPlayerStorage(0)!;
    // Board and land the first mission's settler.
    const s1 = e.units.find((u) => u.id === first.settlerId)! as Unit;
    s1.col = f1.col;
    s1.row = f1.row;
    expect(managerOf(e).tryColonyFerryAction(f1, first, storage)).toBe(true);
    f1.col = first.waterTile.col;
    f1.row = first.waterTile.row;
    expect(managerOf(e).tryColonyFerryAction(f1, first, storage)).toBe(true);
    const after = missionsOf(e);
    expect(after).toHaveLength(1);
    expect(after[0].settlerId).not.toBe(first.settlerId);
  });

  it('frees a landed settler to found instead of re-reserving it', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    const s1 = addUnit(e, { id: 's1', type: 'settler', col: 2, row: 2 });
    addUnit(e, { id: 'f1', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    const storage = e.getPlayerStorage(0)!;
    managerOf(e).updateColonyMission(e.civilizations[0], storage);
    expect(missionsOf(e)).toHaveLength(1);
    const mission = missionsOf(e)[0];
    // The ferry lands the settler on its island (moves spent unloading).
    s1.col = mission.landTile.col;
    s1.row = mission.landTile.row;
    (s1 as { embarkedOn?: string | null }).embarkedOn = null;
    managerOf(e).updateColonyMission(e.civilizations[0], storage);
    // The mission completes instead of re-abducting the settler for another
    // crossing: it stays ashore and founds on its own next phase.
    expect(missionsOf(e).filter((m) => m.settlerId === 's1')).toHaveLength(0);
  });

  it('migrates the legacy single slot into the parallel array', () => {    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    addUnit(e, { id: 's1', type: 'settler', col: 1, row: 2 });
    const storage = e.getPlayerStorage(0)!;
    (storage.turnData as Record<string, unknown>).colonyMission = {
      settlerId: 's1', ferryId: null, targetLandmassId: 3,
      landTile: { col: 5, row: 1 }, waterTile: { col: 4, row: 1 }, stage: 'gather',
    };
    const found = managerOf(e).getColonyMissionForSettler(storage, 's1');
    expect(found?.settlerId).toBe('s1');
    expect((storage.turnData as Record<string, unknown>).colonyMission).toBeUndefined();
    expect(missionsOf(e)).toHaveLength(1);
  });
});

describe('colony ferry wiring', () => {
  it('finds a ferry mission by hull (the unit-loop boarding path)', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    addUnit(e, { id: 's1', type: 'settler', col: 1, row: 2 });
    addUnit(e, { id: 'f1', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    managerOf(e).updateColonyMission(e.civilizations[0], e.getPlayerStorage(0)!);
    const storage = e.getPlayerStorage(0)!;
    // The ferry's mission resolves by hull id — this is what the unit loop
    // uses to board/unload. (It used to resolve by settler id, so ferries
    // sailed to the island and never embarked anyone.)
    const byFerry = managerOf(e).getColonyMissionForFerry(storage, 'f1');
    expect(byFerry?.ferryId).toBe('f1');
    expect(managerOf(e).getColonyMissionForFerry(storage, 'nope')).toBeNull();
  });

  it('never hands one hull to two missions', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    addUnit(e, { id: 's1', type: 'settler', col: 1, row: 2 });
    addUnit(e, { id: 's2', type: 'settler', col: 1, row: 3 });
    addUnit(e, { id: 'f1', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    managerOf(e).updateColonyMission(e.civilizations[0], e.getPlayerStorage(0)!);
    // f1 is claimed by the first mission: no second idle hull exists.
    expect(managerOf(e).findIdleFerry(0)).toBeNull();
  });
});

describe('colony settler demand', () => {
  it('reports how many settlers still need spawning', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    addUnit(e, { id: 's1', type: 'settler', col: 1, row: 2 });
    addUnit(e, { id: 'f1', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    managerOf(e).updateColonyMission(e.civilizations[0], e.getPlayerStorage(0)!);
    // Three islands, one mission holding s1: two more settlers wanted.
    expect(managerOf(e).colonySettlerShortfall(0)).toBe(2);
  });

  it('is zero when every mission holds its settler', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    // One island only: settle it and the demand is met.
    for (const row of [0, 1, 2, 3, 4, 5]) {
      for (const col of [9, 10]) {
        const t = e.map.tiles.find((x) => x.col === col && x.row === row)!;
        t.type = O;
        (t as { terrain?: string }).terrain = O;
      }
    }
    for (const row of [5]) {
      for (const col of [5, 6]) {
        const t = e.map.tiles.find((x) => x.col === col && x.row === row)!;
        t.type = O;
        (t as { terrain?: string }).terrain = O;
      }
    }
    addUnit(e, { id: 's1', type: 'settler', col: 1, row: 2 });
    managerOf(e).updateColonyMission(e.civilizations[0], e.getPlayerStorage(0)!);
    expect(missionsOf(e)).toHaveLength(1);
    expect(managerOf(e).colonySettlerShortfall(0)).toBe(0);
  });
});

describe('safe rendezvous', () => {
  it('waits on a quiet beach, not the nearest hostile one', () => {
    const e = makeEngine();
    addCity(e, 'Home', 2, 2, 0);
    // Settler deep inland; enemy scout beside the nearest beach at (2,1).
    const settler = addUnit(e, { id: 's1', type: 'settler', col: 0, row: 4 });
    addUnit(e, { id: 'e1', type: 'scout', col: 2, row: 1, civilizationId: 1, attack: 0.5, defense: 1 });
    e.diplomacyManager.declareWar(0, 1);
    const rendezvous = managerOf(e).findColonyRendezvous(settler);
    expect(rendezvous).not.toBeNull();
    expect(rendezvous).not.toEqual({ col: 2, row: 1 });
  });
});
