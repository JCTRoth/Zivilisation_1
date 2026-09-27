/**
 * Naval target selection: who a ship is allowed to shoot at, and where it is
 * told to sail.
 *
 * Every regression here came out of a 417-round AI_VS_AI_NAVAL game
 * (game-logs/game-1790459630205.log). The navy was 67% self-destructing —
 * 58 of 86 ships built were destroyed — and 10 of the 129 wars in the game
 * were started by a Ferry ramming somebody else's Ferry at peace, because
 * `chooseNavalTarget` hunted every foreign hull it could see with no
 * `isAtWar` check while `combatUnit` auto-declares war. 224 more turns were
 * burnt on `no_path` because the "blockade" target was the enemy city's LAND
 * square, which no ship can ever path onto.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
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
    { id: 2, name: 'Neutrals', isHuman: false, isAlive: true, technologies: ['sailing'], resources: { gold: 100 } },
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
  e.initializePlayerStorage(2);
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

function addUnit(
  engine: ReturnType<typeof makeEngine>,
  opts: Partial<Unit> & { id: string; col: number; row: number },
) {
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

/** A real Ferry: naval, 3 movement, and 0 attack — it cannot win a sea fight. */
const FERRY = { type: 'ferry', attack: 0, defense: 0, movement: 3, maxMoves: 3 } as const;
/** A Sail: naval with 1 attack, so it may legitimately fight. */
const SAIL = { type: 'sail', attack: 1, defense: 1, movement: 3, maxMoves: 3 } as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const managerOf = (engine: ReturnType<typeof makeEngine>) => engine.aiManager as any;

/** Mark every tile as seen, so the "explore then patrol" fallback is exercised. */
function markAllExplored(engine: ReturnType<typeof makeEngine>, civId: number) {
  const storage = engine.getPlayerStorage(civId)!;
  storage.explored.fill(true);
}

const isWater = (engine: ReturnType<typeof makeEngine>, col: number, row: number) =>
  (engine.getTileAt(col, row) as { type?: string })?.type === O;

describe('naval target selection', () => {
  it('never sends a ferry at a ship it is not at war with', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addUnit(engine, { id: 'fer', ...FERRY, col: 3, row: 2 });
    // A neutral sail from the other island, two tiles away.
    addUnit(engine, { id: 'neutral', ...SAIL, civilizationId: 1, col: 5, row: 2 });

    const target = managerOf(engine).chooseNavalTarget(
      engine.units.find((u) => u.id === 'fer') as Unit,
    );
    expect(target).not.toBeNull();
    // The bug: it returned the neutral sail's own tile, and combatUnit then
    // auto-declared war over it.
    expect(target).not.toEqual({ col: 5, row: 2 });
  });

  it('a warship hunts the nearest ship of a civ it IS at war with', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addUnit(engine, { id: 'hunt', ...SAIL, col: 3, row: 2 });
    // A neutral sail (civ 2) just next to us, a wartime sail (civ 1) nearer
    // in range but on the far side of the channel.
    addUnit(engine, { id: 'neutral', ...SAIL, civilizationId: 2, col: 4, row: 0 });
    addUnit(engine, { id: 'enemy', ...SAIL, civilizationId: 1, col: 5, row: 2 });
    engine.diplomacyManager.declareWar(0, 1);

    const target = managerOf(engine).chooseNavalTarget(
      engine.units.find((u) => u.id === 'hunt') as Unit,
    );
    // The neutral sail is closer and must be ignored; the wartime one is the
    // only legitimate target.
    expect(target).toEqual({ col: 5, row: 2 });
  });

  it('a 0-attack ferry never hunts anyone, even at war', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addUnit(engine, { id: 'fer', ...FERRY, col: 3, row: 2 });
    addUnit(engine, { id: 'enemy', ...SAIL, civilizationId: 1, col: 5, row: 2 });
    engine.diplomacyManager.declareWar(0, 1);

    const target = managerOf(engine).chooseNavalTarget(
      engine.units.find((u) => u.id === 'fer') as Unit,
    );
    expect(target).not.toEqual({ col: 5, row: 2 });
  });

  it('blockades a hostile coastal city from the water, never from the city square', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addUnit(engine, { id: 'fer', ...FERRY, col: 3, row: 2 });
    // Mainport sits on LAND at (6,2); the only water near it is (5,2).
    addCity(engine, 'Mainport', 6, 2, 1);
    engine.diplomacyManager.declareWar(0, 1);
    engine.recordEnemyLocation(0, {
      col: 6,
      row: 2,
      targetType: 'city',
      targetId: 'city_1_Mainport',
      distance: 3,
      priority: 2,
    });

    const target = managerOf(engine).chooseNavalTarget(
      engine.units.find((u) => u.id === 'fer') as Unit,
    );
    expect(target).not.toBeNull();
    // The bug: it returned (6,2) — a grassland square. getMovementCost gives a
    // ship Infinity there, so the ferry burned every turn in `no_path`.
    expect(target).not.toEqual({ col: 6, row: 2 });
    expect(isWater(engine, target!.col, target!.row)).toBe(true);
  });

  it('ignores a coastal city it is at peace with', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addUnit(engine, { id: 'fer', ...FERRY, col: 3, row: 2 });
    addCity(engine, 'Mainport', 6, 2, 1);
    engine.recordEnemyLocation(0, {
      col: 6,
      row: 2,
      targetType: 'city',
      targetId: 'city_1_Mainport',
      distance: 3,
      priority: 2,
    });

    const target = managerOf(engine).chooseNavalTarget(
      engine.units.find((u) => u.id === 'fer') as Unit,
    );
    // A blockade stance is an act of war; at peace the ship patrols instead.
    expect(target).not.toEqual({ col: 5, row: 2 });
  });

  it('always finds water to patrol, even when the whole map is explored', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addUnit(engine, { id: 'fer', ...FERRY, col: 3, row: 2 });
    markAllExplored(engine, 0);

    // The bug: findNavalPatrolTarget only ever accepted UNEXPLORED ocean, so
    // once the local water was mapped every idle ship returned null and sat in
    // the `no_target` stall branch forever.
    const target = managerOf(engine).chooseNavalTarget(
      engine.units.find((u) => u.id === 'fer') as Unit,
    );
    expect(target).not.toBeNull();
    expect(isWater(engine, target!.col, target!.row)).toBe(true);
  });

  it('gives a ship a water step, and a land unit a land step', () => {
    const engine = makeEngine();
    // A ferry on water whose target is the enemy shore across the channel.
    const ferry = addUnit(engine, { id: 'fer', ...FERRY, col: 4, row: 2, movesRemaining: 3 });
    const step = managerOf(engine).findAffordableStep(ferry, { col: 6, row: 2 });
    expect(step).not.toBeNull();
    // The bug: isTilePassable is a LAND test, so it offered the ship the
    // grassland tile at (5,2)... which moveUnit then rejected, leaving the
    // ferry frozen with no step at all.
    expect(isWater(engine, step!.col, step!.row)).toBe(true);

    // A land unit on the shore must still be offered a land step.
    const warrior = addUnit(engine, { id: 'w', type: 'warrior', col: 2, row: 2, movesRemaining: 3 });
    const landStep = managerOf(engine).findAffordableStep(warrior, { col: 6, row: 2 });
    expect(landStep).not.toBeNull();
    expect(isWater(engine, landStep!.col, landStep!.row)).toBe(false);
  });
});

interface TestMission {
  unitId: string;
  ferryId: string | null;
  targetCityId: string;
  landTile: { col: number; row: number };
  waterTile: { col: number; row: number };
  rendezvous: { col: number; row: number };
  stage: string;
}

describe('naval missions', () => {
  it('frees the ferry once the troop is ashore instead of parking it', () => {
    const engine = makeEngine();
    addCity(engine, 'Islandport', 2, 2, 0);
    addCity(engine, 'Mainport', 6, 2, 1);
    const troop = addUnit(engine, { id: 'troop', type: 'warrior', col: 2, row: 2 });
    const ferry = addUnit(engine, { id: 'fer', ...FERRY, col: 3, row: 2 });
    engine.diplomacyManager.declareWar(0, 1);

    const storage = engine.getPlayerStorage(0)!;
    managerOf(engine).updateInvasionMission(engine.civilizations[0], storage);
    const mission = storage.turnData.invasionMission as TestMission;

    // Walk the mission to its end: board, cross, land.
    troop.col = mission.rendezvous.col;
    troop.row = mission.rendezvous.row;
    expect(managerOf(engine).tryInvasionFerryAction(ferry, mission, storage)).toBe(true);
    ferry.col = mission.waterTile.col;
    ferry.row = mission.waterTile.row;
    expect(managerOf(engine).tryInvasionFerryAction(ferry, mission, storage)).toBe(true);
    expect(mission.stage).toBe('siege');
    expect(troop.embarkedOn).toBeNull();

    // The bug: the ferry still matched the mission, sailed to
    // findAdjacentOcean(ownTroop) and then held that tile for the rest of the
    // game (91 "Already at target" holds in one run).
    expect(managerOf(engine).tryInvasionFerryAction(ferry, mission, storage)).toBe(false);
    // And it must not re-board the invasion force that is already ashore.
    expect(troop.embarkedOn).toBeNull();

    const target = managerOf(engine).chooseNavalTarget(ferry);
    expect(target).not.toEqual({ col: troop.col, row: troop.row });
    expect(target === null || isWater(engine, target.col, target.row)).toBe(true);
  });
});
