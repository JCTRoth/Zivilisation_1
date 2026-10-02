/**
 * Final war: "when no enemy is left on the map anymore the AI declares active
 * war on other civilizations and starts to attack them; if the AI is not able
 * to do so it should start to build a navy and send it to the other civs to
 * attack them."
 *
 * The trigger is a civ that has nobody left to fight but HAS fought before —
 * a game that simply starts at peace must not turn into a world war the first
 * time two scouts meet. The target is the weakest reachable opponent; a target
 * that can only be reached across water still gets declared on, and that is the
 * half that switches the civ over to the navy pipeline.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import {
  chooseFinalWarTarget,
  shouldDeclareFinalWar,
  type FinalWarCandidate,
} from '@/game/engine/AI/AIFinalWar';
import type { City, Unit } from '../../types/game';

const O = 'ocean';
const G = 'grassland';

const FLATLAND = [
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
];

/** Left landmass (civ 0) and right landmass (civ 1), ocean down the middle. */
const TWO_LANDMASSES = [
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
];

function makeEngine(layout: string[][], civs: Array<{ id: number; name: string; tech?: string[] }>) {
  const height = layout.length;
  const width = layout[0].length;
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
    tiles: layout.flat().map((type, i) => {
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
  e.civilizations = civs.map((c) => ({
    id: c.id,
    name: c.name,
    isHuman: false,
    isAlive: true,
    technologies: c.tech ?? [],
    resources: { gold: 100 },
    personality: { aggression: 5 },
  }));
  e.diplomacyManager = new DiplomacyManager(e as GameEngine);
  e.diplomacyManager.initialize(civs.map((c) => c.id));
  for (const c of civs) e.initializePlayerStorage(c.id);
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

function addUnit(
  engine: GameEngine,
  opts: Partial<Unit> & { id: string; col: number; row: number; civilizationId: number },
) {
  const unit = {
    health: 100,
    movesRemaining: 1,
    isDefeated: false,
    attack: 1,
    defense: 1,
    hitPoints: 2,
    maxHitPoints: 2,
    movement: 1,
    maxMoves: 1,
    type: 'warrior',
    ...opts,
  };
  engine.units.push(unit as never);
  return unit as Unit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const managerOf = (engine: GameEngine) => engine.aiManager as any;

/** Run the final-war decision for a civ the way the AI turn does. */
function runFinalWar(engine: GameEngine, civId: number) {
  const storage = engine.getPlayerStorage(civId)!;
  managerOf(engine).maybeDeclareFinalWar(
    engine.civilizations[civId],
    storage,
    engine.roundManager?.getRoundNumber?.() ?? 1,
  );
  return storage;
}

const candidates = (list: FinalWarCandidate[]) => list;

describe('final war trigger (pure)', () => {
  it('fires only when nobody is at war, the civ has fought, and someone is reachable', () => {
    expect(shouldDeclareFinalWar({ enemyCount: 0, candidateCount: 1, everFought: true })).toBe(true);
    // Still enemies on the map — nothing is "left".
    expect(shouldDeclareFinalWar({ enemyCount: 1, candidateCount: 1, everFought: true })).toBe(false);
    // Never fought: nothing has been destroyed, so nothing is "left".
    expect(shouldDeclareFinalWar({ enemyCount: 0, candidateCount: 1, everFought: false })).toBe(false);
    // Nobody left to turn on (last civ standing wins the game instead).
    expect(shouldDeclareFinalWar({ enemyCount: 0, candidateCount: 0, everFought: true })).toBe(false);
  });

  it('picks the weakest reachable civ', () => {
    const decision = chooseFinalWarTarget(candidates([
      { civId: 1, strength: 30, reachableBy: 'land' },
      { civId: 2, strength: 8, reachableBy: 'land' },
      { civId: 3, strength: 3, reachableBy: 'land' },
    ]));
    expect(decision).toEqual({ targetCivId: 3, reachableBy: 'land' });
  });

  it('prefers a walkable target over a weaker overseas one', () => {
    const decision = chooseFinalWarTarget(candidates([
      { civId: 1, strength: 40, reachableBy: 'land' },
      { civId: 2, strength: 2, reachableBy: 'sea' },
    ]));
    // Marching beats building a navy first, even against a softer target.
    expect(decision).toEqual({ targetCivId: 1, reachableBy: 'land' });
  });

  it('falls back to the sea when nothing is walkable', () => {
    const decision = chooseFinalWarTarget(candidates([
      { civId: 1, strength: 40, reachableBy: 'sea' },
      { civId: 2, strength: 2, reachableBy: 'sea' },
    ]));
    expect(decision).toEqual({ targetCivId: 2, reachableBy: 'sea' });
  });

  it('declares nothing when no candidate can be reached at all', () => {
    expect(chooseFinalWarTarget([])).toBeNull();
  });
});

describe('AI declares a final war', () => {
  it('turns on the weakest met neighbour once its own wars are over', () => {
    const engine = makeEngine(FLATLAND, [
      { id: 0, name: 'Conquerors' },
      { id: 1, name: 'Weakland' },
      { id: 2, name: 'Strongland' },
    ]);
    addCity(engine, 'Capital', 1, 2, 0);
    addCity(engine, 'Weak Town', 4, 2, 1);
    addCity(engine, 'Strong Town', 7, 2, 2);
    addUnit(engine, { id: 's1', col: 7, row: 2, civilizationId: 2 });
    addUnit(engine, { id: 's2', col: 7, row: 3, civilizationId: 2 });
    addUnit(engine, { id: 's3', col: 6, row: 2, civilizationId: 2 });
    const dm = engine.diplomacyManager;
    dm.markContact(0, 1);
    dm.markContact(0, 2);

    const storage = engine.getPlayerStorage(0)!;
    // A civ that has never fought does not spontaneously start a world war.
    runFinalWar(engine, 0);
    expect(dm.isAtWar(0, 1)).toBe(false);
    expect(dm.isAtWar(0, 2)).toBe(false);

    // It fought once and that enemy is gone — now nothing is left to fight.
    dm.declareWar(0, 2);
    dm.makePeace(0, 2);

    runFinalWar(engine, 0);
    expect(storage.turnData.everAtWar).toBe(true);
    expect(dm.isAtWar(0, 1)).toBe(true);
    expect(dm.isAtWar(0, 2)).toBe(false); // weakest reachable first
    const record = storage.turnData.finalWar as { targetCivId: number; reachableBy: string };
    expect(record.targetCivId).toBe(1);
    expect(record.reachableBy).toBe('land');
    // …and the war comes with a march objective, so it produces attacks and
    // not just upkeep.
    expect(storage.enemyLocations.get(1)?.some((l) => l.type === 'city')).toBe(true);

    // A second pass while the war runs does not pile another declaration on top.
    runFinalWar(engine, 0);
    expect(dm.getEnemies(0)).toEqual([1]);
  });

  it('declares nothing while an enemy is still on the map', () => {
    const engine = makeEngine(FLATLAND, [
      { id: 0, name: 'Conquerors' },
      { id: 1, name: 'Weakland' },
    ]);
    addCity(engine, 'Capital', 1, 2, 0);
    addCity(engine, 'Weak Town', 6, 2, 1);
    const dm = engine.diplomacyManager;
    dm.markContact(0, 1);
    dm.declareWar(0, 1);

    const storage = runFinalWar(engine, 0);
    expect(storage.turnData.everAtWar).toBe(true);
    expect(storage.turnData.finalWar).toBeUndefined();
    expect(dm.isAtWar(0, 1)).toBe(true);
  });

  it('never declares on an unmet or allied civ', () => {
    const engine = makeEngine(FLATLAND, [
      { id: 0, name: 'Conquerors' },
      { id: 1, name: 'Stranger' },
      { id: 2, name: 'Ally' },
    ]);
    addCity(engine, 'Capital', 1, 2, 0);
    addCity(engine, 'Stranger Town', 4, 2, 1);
    addCity(engine, 'Ally Town', 7, 2, 2);
    const dm = engine.diplomacyManager;
    dm.markContact(0, 2);
    dm.formAlliance(0, 2);
    const storage = engine.getPlayerStorage(0)!;
    storage.turnData.everAtWar = true;

    runFinalWar(engine, 0);
    expect(dm.isAtWar(0, 1)).toBe(false); // never met
    expect(dm.isAtWar(0, 2)).toBe(false); // allied
    expect(storage.turnData.finalWar).toBeUndefined();
  });
});

describe('final war across water builds the navy half', () => {
  function makeOverseasEngine() {
    const engine = makeEngine(TWO_LANDMASSES, [
      { id: 0, name: 'Islanders', tech: ['sailing'] },
      { id: 1, name: 'Mainlanders' },
    ]);
    addCity(engine, 'Islandport', 2, 2, 0);
    addCity(engine, 'Mainport', 6, 2, 1);
    addUnit(engine, { id: 'troop', col: 2, row: 2, civilizationId: 0 });
    const dm = engine.diplomacyManager;
    dm.markContact(0, 1);
    return { engine, dm };
  }

  it('declares the war even though no army can march there', () => {
    const { engine, dm } = makeOverseasEngine();
    const storage = engine.getPlayerStorage(0)!;
    storage.turnData.everAtWar = true;
    dm.declareWar(0, 1);
    dm.makePeace(0, 1);

    runFinalWar(engine, 0);

    expect(dm.isAtWar(0, 1)).toBe(true);
    const record = storage.turnData.finalWar as { targetCivId: number; reachableBy: string };
    expect(record.reachableBy).toBe('sea');
    // Which is what switches production over to ships: the doctrine now has a
    // concrete sea target to want a transport for.
    expect(managerOf(engine).hasSeaInvasionTarget(0)).toBe(true);
  });

  it('refuses the war when the civ cannot put a hull in the water', () => {
    const { engine, dm } = makeOverseasEngine();
    engine.civilizations[0].technologies = [];
    const storage = engine.getPlayerStorage(0)!;
    storage.turnData.everAtWar = true;
    dm.declareWar(0, 1);
    dm.makePeace(0, 1);

    runFinalWar(engine, 0);
    // Nothing to declare: no land route AND no way to ever build a navy.
    expect(dm.isAtWar(0, 1)).toBe(false);
    expect(storage.turnData.finalWar).toBeUndefined();
  });

  it('marks the war as needing a navy for production', () => {
    const { engine, dm } = makeOverseasEngine();
    // The private gate the production ladder uses to put hulls before soldiers.
    const production = engine.autoProduction as unknown as {
      needsNavyForWar?: (id: number) => boolean;
    };
    expect(typeof production.needsNavyForWar).toBe('function');
    expect(production.needsNavyForWar!(0)).toBe(false); // peace: no war, no navy

    dm.declareWar(0, 1);
    expect(production.needsNavyForWar!(0)).toBe(true);
  });
});
