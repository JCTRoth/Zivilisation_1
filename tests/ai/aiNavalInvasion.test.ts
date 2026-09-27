/**
 * Naval invasion: a combat unit ferried to an enemy city on a landmass the AI
 * cannot walk to.
 *
 * Without this, an AI-vs-AI map whose strait splits the civs is an unwinnable
 * stalemate — nobody can reach anybody, so they trade declarations and upkeep
 * forever. The 465-round run that motivated this had 17 wars, 3 attacks, and
 * two civs that never met. In Civ1 a Ferry carries exactly one land unit, so
 * a mission is one troop and one hull, and the AI repeats it to land an army.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { City, Unit } from '../../types/game';

const O = 'ocean';
const G = 'grassland';

/** Left landmass (civ 0) and right landmass (civ 1), ocean down the middle. */
const TWO_LANKMASSES = [
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
];

function makeEngine() {
  const height = TWO_LANKMASSES.length;
  const width = TWO_LANKMASSES[0].length;
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
    tiles: TWO_LANKMASSES.flat().map((type, i) => {
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
    { id: 1, name: 'Mainlanders', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
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
  return e as GameEngine & { declareWarForTest(a: number, b: number): void };
}

function addCity(engine: ReturnType<typeof makeEngine>, name: string, col: number, row: number, civId: number) {
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

function addUnit(engine: ReturnType<typeof makeEngine>, opts: Partial<Unit> & { id: string; col: number; row: number }) {
  const unit = {
    civilizationId: 0,
    health: 100,
    movesRemaining: 1,
    isDefeated: false,
    // isCombatUnit() reads attack/defense, so a stub warrior needs them.
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
const managerOf = (engine: ReturnType<typeof makeEngine>) => engine.aiManager as any;

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

describe('naval invasion mission', () => {
  it('plans a push against an enemy city across the strait', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    const enemyCity = addCity(engine, 'Mainport', 6, 2, 1);
    addUnit(engine, { id: 'troop', type: 'warrior', col: 2, row: 2 });
    addUnit(engine, { id: 'fer', type: 'ferry', col: 3, row: 2 });

    const storage = engine.getPlayerStorage(0)!;
    // No war yet: nothing to invade.
    managerOf(engine).updateInvasionMission(engine.civilizations[0], storage);
    expect(storage.turnData.invasionMission).toBeUndefined();

    engine.diplomacyManager.declareWar(0, 1);
    managerOf(engine).updateInvasionMission(engine.civilizations[0], storage);

    const mission = storage.turnData.invasionMission as TestMission;
    expect(mission).toBeDefined();
    expect(mission.troopIds).toEqual(['troop']);
    expect(mission.ferryId).toBe('fer');
    expect(mission.targetCityId).toBe(enemyCity.id);
    expect(mission.stage).toBe('gather');
    // The beach is on the enemy's landmass and has water for the ferry…
    expect(engine.getLandmassId(mission.landTile.col, mission.landTile.row)).not.toBe(
      engine.getLandmassId(2, 2),
    );
    expect(engine.findAdjacentOcean(mission.landTile.col, mission.landTile.row)).toBeTruthy();
    // …and the troop does board on our own shore.
    expect(engine.getLandmassId(mission.rendezvous.col, mission.rendezvous.row)).toBe(
      engine.getLandmassId(2, 2),
    );
    expect(engine.findAdjacentOcean(mission.rendezvous.col, mission.rendezvous.row)).toBeTruthy();
  });

  it('runs the whole mission: walk to the coast, board, cross, land, siege', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    const enemyCity = addCity(engine, 'Mainport', 6, 2, 1);
    const troop = addUnit(engine, { id: 'troop', type: 'warrior', col: 2, row: 2 });
    const ferry = addUnit(engine, { id: 'fer', type: 'ferry', col: 3, row: 2 });
    engine.diplomacyManager.declareWar(0, 1);

    const storage = engine.getPlayerStorage(0)!;
    managerOf(engine).updateInvasionMission(engine.civilizations[0], storage);
    const mission = storage.turnData.invasionMission as TestMission;

    // Stage 1 — the troop is told to walk to the boarding beach.
    const gatherTarget = managerOf(engine).chooseAITarget(troop);
    expect(gatherTarget).toEqual(mission.rendezvous);

    // Stage 2 — ferry alongside, board the troop.
    troop.col = mission.rendezvous.col;
    troop.row = mission.rendezvous.row;
    expect(managerOf(engine).tryInvasionFerryAction(ferry, mission, storage)).toBe(true);
    expect(troop.embarkedOn).toBe('fer');
    expect(mission.stage).toBe('sail');
    // While embarked the troop has no land target of its own — the ferry drives.
    expect(managerOf(engine).chooseAITarget(troop)).toBeNull();

    // The ferry's naval target is the far shore, not a patrol route.
    expect(managerOf(engine).chooseNavalTarget(ferry)).toEqual(mission.waterTile);
    expect(engine.getFerryCargo(ferry)).toEqual(['troop']);

    // Stage 3 — cross and unload.
    ferry.col = mission.waterTile.col;
    ferry.row = mission.waterTile.row;
    expect(managerOf(engine).tryInvasionFerryAction(ferry, mission, storage)).toBe(true);
    expect(troop.embarkedOn).toBeNull();
    expect(troop.col).toBe(mission.landTile.col);
    expect(troop.row).toBe(mission.landTile.row);
    expect(mission.stage).toBe('siege');
    // The troop is now on the enemy's continent.
    expect(engine.getLandmassId(troop.col, troop.row)).toBe(engine.getLandmassId(enemyCity.col, enemyCity.row));

    // Stage 4 — ashore, it marches on the city it came for.
    expect(managerOf(engine).chooseAITarget(troop)).toEqual({ col: enemyCity.col, row: enemyCity.row });
  });

  it('abandons the mission when the target city is gone', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    const enemyCity = addCity(engine, 'Mainport', 6, 2, 1);
    addUnit(engine, { id: 'troop', type: 'warrior', col: 2, row: 2 });
    addUnit(engine, { id: 'fer', type: 'ferry', col: 3, row: 2 });
    engine.diplomacyManager.declareWar(0, 1);

    const storage = engine.getPlayerStorage(0)!;
    managerOf(engine).updateInvasionMission(engine.civilizations[0], storage);
    expect(storage.turnData.invasionMission).toBeDefined();

    // The city was captured by someone else — the push has no objective.
    engine.cities = engine.cities.filter((c) => c.id !== enemyCity.id);
    managerOf(engine).updateInvasionMission(engine.civilizations[0], storage);
    expect(storage.turnData.invasionMission).toBeUndefined();
  });

  it('a civ with no hull and no ship tech plans no invasion', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addCity(engine, 'Mainport', 6, 2, 1);
    addUnit(engine, { id: 'troop', type: 'warrior', col: 2, row: 2 });
    engine.diplomacyManager.declareWar(0, 1);
    // No ferry unit, and `sailing` is gone.
    engine.civilizations[0].technologies = [];

    const storage = engine.getPlayerStorage(0)!;
    managerOf(engine).updateInvasionMission(engine.civilizations[0], storage);
    expect(storage.turnData.invasionMission).toBeUndefined();
  });

  it('counts an enemy across the strait as a reachable war target once it can sail', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addCity(engine, 'Mainport', 6, 2, 1);
    const unit = addUnit(engine, { id: 'troop', type: 'warrior', col: 2, row: 2 });
    engine.diplomacyManager.declareWar(0, 1);

    // Nothing land-connected across the water…
    expect(engine.areLandConnected(2, 2, 6, 2)).toBe(false);
    // …but with a hull available the enemy is reachable, so a war is worth it.
    addUnit(engine, { id: 'fer', type: 'ferry', col: 3, row: 2 });
    const reachable = managerOf(engine).hasReachableEnemyTarget.bind(managerOf(engine));
    expect(reachable(0, unit, 1)).toBe(true);

    // Without any way to build or field a ship, it is not.
    const withoutShips = makeEngine();
    withoutShips.civilizations[0].technologies = [];
    addCity(withoutShips, 'Islandport', 2, 2, 0);
    addCity(withoutShips, 'Mainport', 6, 2, 1);
    withoutShips.diplomacyManager.declareWar(0, 1);
    const troop2 = addUnit(withoutShips, { id: 'troop2', type: 'warrior', col: 2, row: 2 });
    const reachable2 = managerOf(withoutShips).hasReachableEnemyTarget.bind(managerOf(withoutShips));
    expect(reachable2(0, troop2, 1)).toBe(false);
  });
});
