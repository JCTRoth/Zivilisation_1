/**
 * Multi-unit transport: a Ferry is a landing force, not a ferry for one spear.
 *
 * The engine side is the capacity gate and the pile-onto-one-beach rule; the AI
 * side is boarding a whole force and putting it ashore on the beach the
 * landing-site scoring picked, not the first beach found.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { FERRY_CAPACITY } from '@/data/UnitConstants';
import { UNIT_PROPS } from '@/utils/Constants';
import type { City, Unit } from '../../types/game';

const O = 'ocean';
const G = 'grassland';

/** Left landmass (civ 0) and right landmass (civ 1), ocean down the middle. */
const TWO_LANDMASSES = [
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
];

function makeEngine() {
  const height = TWO_LANDMASSES.length;
  const width = TWO_LANDMASSES[0].length;
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
    tiles: TWO_LANDMASSES.flat().map((type, i) => {
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
    { id: 0, name: 'Islanders', isHuman: false, isAlive: true, technologies: ['sailing'], resources: { gold: 100 } },
    { id: 1, name: 'Mainlanders', isHuman: false, isAlive: true, technologies: ['sailing'], resources: { gold: 100 } },
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

interface TestMission {
  troopIds: string[];
  landedIds: string[];
  ferryId: string | null;
  targetCityId: string;
  landTile: { col: number; row: number };
  waterTile: { col: number; row: number };
  rendezvous: { col: number; row: number };
  stage: string;
}

const missionOf = (engine: GameEngine): TestMission =>
  engine.getPlayerStorage(0)!.turnData.invasionMission as TestMission;

describe('transport capacity', () => {
  it('gives a Ferry room for a landing force, not one unit', () => {
    expect(FERRY_CAPACITY).toBeGreaterThan(1);
    expect(UNIT_PROPS.ferry.transportCapacity).toBe(FERRY_CAPACITY);
    // Warships carry nothing, so `transportCapacity` is a clean marker.
    expect(UNIT_PROPS.battleship.transportCapacity ?? 0).toBe(0);
  });

  it('refuses a passenger once the hull is full', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    for (let i = 0; i < FERRY_CAPACITY; i++) {
      const troop = addUnit(e, { id: `t${i}`, type: 'phalanx', col: 2, row: 2 });
      expect(e.canLoadFerry(ferry.id, troop.id)).toBe(true);
      expect(e.loadFerry(ferry.id, troop.id)).toBe(true);
    }
    expect(e.getFerryCargo(ferry)).toHaveLength(FERRY_CAPACITY);
    // One too many.
    const extra = addUnit(e, { id: 'extra', type: 'phalanx', col: 2, row: 2 });
    expect(e.canLoadFerry(ferry.id, extra.id)).toBe(false);
  });

  it('carries the whole force across the water when it moves', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    const troops = ['a', 'b', 'c'].map((id) =>
      addUnit(e, { id, type: 'phalanx', col: 2, row: 2 }));
    for (const t of troops) e.loadFerry(ferry.id, t.id);

    expect(e.moveUnit(ferry.id, 3, 1).success).toBe(true);
    // Every passenger rides along, not just the first.
    for (const t of troops) {
      expect(t.col).toBe(3);
      expect(t.row).toBe(1);
    }
  });

  it('lets a whole force pile onto the same beach tile', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    // The far city is inland of the beach, so (6,2) is free land a hull can
    // actually unload onto — the far landmass's only coastal column.
    addCity(e, 'Mainport', 8, 2, 1);
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 5, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    const troops = ['a', 'b', 'c'].map((id) =>
      addUnit(e, { id, type: 'phalanx', col: 6, row: 2 }));
    for (const t of troops) e.loadFerry(ferry.id, t.id);

    // An amphibious landing has to be able to stack on the one beach. Land all
    // three, one per turn, on the same tile.
    for (let turn = 0; turn < troops.length; turn++) {
      expect(e.canUnloadFerry(ferry.id, 6, 2)).toBe(true);
      expect(e.unloadFerry(ferry.id, 6, 2)).toBe(true);
    }
    expect(e.getFerryCargo(ferry)).toEqual([]);
    for (const t of troops) {
      expect(t.embarkedOn).toBeNull();
      expect(t.col).toBe(6);
      expect(t.row).toBe(2);
    }
  });

  it('unloads a chosen passenger and leaves the rest aboard', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    addCity(e, 'Mainport', 8, 2, 1);
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 5, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    addUnit(e, { id: 'a', type: 'phalanx', col: 6, row: 2 });
    const keep = addUnit(e, { id: 'b', type: 'archer', col: 6, row: 2 });
    e.loadFerry(ferry.id, 'a');
    e.loadFerry(ferry.id, keep.id);

    expect(e.canUnloadFerry(ferry.id, 6, 2, 'a')).toBe(true);
    expect(e.unloadFerry(ferry.id, 6, 2, 'a')).toBe(true);
    expect(e.getFerryCargo(ferry)).toEqual(['b']);
    expect(keep.embarkedOn).toBe('fer');
  });

  it('takes the whole cargo down with the ship', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    const troops = ['a', 'b', 'c'].map((id) =>
      addUnit(e, { id, type: 'phalanx', col: 2, row: 2 }));
    for (const t of troops) e.loadFerry(ferry.id, t.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).destroyCargoOf(ferry);
    for (const t of troops) expect(t.isDefeated).toBe(true);
  });
});

describe('AI landing force', () => {
  it('boards a whole force, not a single spear', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    addCity(e, 'Mainport', 6, 2, 1);
    addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    for (let i = 0; i < 4; i++) {
      addUnit(e, { id: `t${i}`, type: 'phalanx', col: 2, row: 2, attack: 1, defense: 2 });
    }
    e.diplomacyManager.declareWar(0, 1);

    const storage = e.getPlayerStorage(0)!;
    managerOf(e).updateInvasionMission(e.civilizations[0], storage);
    const mission = missionOf(e);
    // The mission commits as many troops as the hull can lift.
    expect(mission.troopIds).toHaveLength(FERRY_CAPACITY);
    expect(mission.landedIds).toEqual([]);

    // Walk them to the boarding beach and load the hull over several turns.
    const ferry = e.units.find((u) => u.id === 'fer') as Unit;
    for (let turn = 0; turn < FERRY_CAPACITY + 1; turn++) {
      for (const id of mission.troopIds) {
        const t = e.units.find((u) => u.id === id) as Unit;
        if (t.embarkedOn) continue;
        t.col = ferry.col === 3 ? 2 : ferry.col;
        t.row = ferry.row;
      }
      ferry.col = 3;
      ferry.row = 2;
      const acted = managerOf(e).tryInvasionFerryAction(ferry, mission, storage);
      if (e.getFerryCargo(ferry).length >= FERRY_CAPACITY) {
        expect(acted || mission.stage === 'sail').toBe(true);
        break;
      }
    }
    expect(e.getFerryCargo(ferry)).toHaveLength(FERRY_CAPACITY);
    expect(mission.stage).toBe('sail');
  });

  it('lands the whole force, one per turn, on the chosen beach', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    addCity(e, 'Mainport', 6, 2, 1);
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    for (let i = 0; i < 4; i++) {
      addUnit(e, { id: `t${i}`, type: 'phalanx', col: 2, row: 2, attack: 1, defense: 2 });
    }
    e.diplomacyManager.declareWar(0, 1);

    const storage = e.getPlayerStorage(0)!;
    managerOf(e).updateInvasionMission(e.civilizations[0], storage);
    const mission = missionOf(e);

    // Load everyone.
    for (let turn = 0; turn < FERRY_CAPACITY + 1; turn++) {
      for (const id of mission.troopIds) {
        const t = e.units.find((u) => u.id === id) as Unit;
        t.col = 2;
        t.row = 2;
      }
      ferry.col = 3;
      ferry.row = 2;
      managerOf(e).tryInvasionFerryAction(ferry, mission, storage);
      if (e.getFerryCargo(ferry).length >= FERRY_CAPACITY) break;
    }
    expect(e.getFerryCargo(ferry)).toHaveLength(FERRY_CAPACITY);

    // Sail to the beach and put the whole force ashore.
    ferry.col = mission.waterTile.col;
    ferry.row = mission.waterTile.row;
    for (let turn = 0; turn < FERRY_CAPACITY + 1; turn++) {
      managerOf(e).tryInvasionFerryAction(ferry, mission, storage);
      if (e.getFerryCargo(ferry).length === 0) break;
    }
    expect(e.getFerryCargo(ferry)).toEqual([]);
    expect(mission.landedIds).toHaveLength(FERRY_CAPACITY);
    expect(mission.stage).toBe('siege');
    // Every troop is ashore on the beach tile, ready to march on the city.
    for (const id of mission.landedIds) {
      const t = e.units.find((u) => u.id === id) as Unit;
      expect(t.embarkedOn).toBeNull();
      expect(t.col).toBe(mission.landTile.col);
      expect(t.row).toBe(mission.landTile.row);
      // …and each one now targets the enemy city.
      expect(managerOf(e).chooseAITarget(t)).toEqual({ col: 6, row: 2 });
    }
  });

  it('picks the strongest troops it can lift, not the first ones it finds', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    addCity(e, 'Mainport', 6, 2, 1);
    addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    // Weak first, strong second: a naive "first N found" would take the warriors.
    addUnit(e, { id: 'weak', type: 'warrior', col: 2, row: 2, attack: 1, defense: 1 });
    addUnit(e, { id: 'mid', type: 'archer', col: 2, row: 2, attack: 3, defense: 2 });
    addUnit(e, { id: 'strong', type: 'riflemen', col: 2, row: 2, attack: 3, defense: 5 });
    addUnit(e, { id: 'other', type: 'warrior', col: 2, row: 2, attack: 1, defense: 1 });
    e.diplomacyManager.declareWar(0, 1);

    const storage = e.getPlayerStorage(0)!;
    managerOf(e).updateInvasionMission(e.civilizations[0], storage);
    const mission = missionOf(e);
    // The three strongest, weakest left behind — never a hull full of spears.
    expect(mission.troopIds).toEqual(['strong', 'mid', 'weak']);
  });

  it('avoids beaching next to a city its force cannot take', () => {
    const e = makeEngine();
    addCity(e, 'Islandport', 2, 2, 0);
    addCity(e, 'Mainport', 6, 2, 1);
    addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 2, movement: 3, maxMoves: 3, attack: 0, defense: 0 });
    // Two landmasses, a landing force of 2, and a big enemy garrison on the
    // only beach next to Mainport. The planner must not pick that beach.
    addUnit(e, { id: 'a', type: 'warrior', col: 2, row: 2, attack: 1, defense: 1 });
    addUnit(e, { id: 'b', type: 'warrior', col: 2, row: 2, attack: 1, defense: 1 });
    for (let i = 0; i < 4; i++) {
      addUnit(e, { id: `g${i}`, type: 'phalanx', col: 6, row: 2, civilizationId: 1, attack: 1, defense: 2 });
    }
    e.diplomacyManager.declareWar(0, 1);

    const storage = e.getPlayerStorage(0)!;
    managerOf(e).updateInvasionMission(e.civilizations[0], storage);
    const mission = missionOf(e);
    if (!mission) return; // no plan at all is an acceptable outcome
    // The beach is never the tile hard against the garrison, and the AI has a
    // water tile next to it to unload on.
    expect(e.findAdjacentOcean(mission.landTile.col, mission.landTile.row)).toBeTruthy();
    const landingPower = mission.troopIds.reduce((sum: number, id: string) => {
      const u = e.units.find((x) => x.id === id);
      return sum + (u ? (u.attack ?? 0) * 2 + (u.defense ?? 0) : 0);
    }, 0);
    const garrison = e.units
      .filter((u) => u.civilizationId === 1 && !u.isDefeated)
      .reduce((s, u) => s + (u.attack ?? 0) + (u.defense ?? 0), 0);
    // 2 warriors lift 4 power against a garrison of 12: hopeless.
    if (garrison > landingPower * 1.5) {
      expect(e.getUnitAt(mission.landTile.col, mission.landTile.row)).toBeNull();
    }
  });
});
