/**
 * Nuclear weapons: the engine has to be able to fire one, and the AI has to
 * actually use it.
 *
 * Before this there was a `nuclear` unit type with attack 99 and nothing
 * else — no detonation function, no area damage, no AI branch, no production
 * path. A warhead was just a very expensive unit that fought one melee round
 * and died (defense 0). TODO.txt: "If available to the AI it should use
 * nuclear weapons and target key enemy cities and key enemy military units
 * and then send units on land or water to take over the enemy cities."
 */
import { describe, it, expect } from 'vitest';
import GameEngine, { NUCLEAR_BLAST_RADIUS } from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { DiplomacyManager } from '@/game/engine/DiplomacyManager';
import type { City, Unit } from '../types/game';

const G = 'grassland';

const FLATLAND = [
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G],
];

function makeEngine() {
  const height = FLATLAND.length;
  const width = FLATLAND[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true; // keeps checkAndEndTurnIfNoMoves out of the way
  e.devMode = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: FLATLAND.flat().map((type, i) => {
      const col = i % width;
      const row = Math.floor(i / width);
      return { id: `${col},${row}`, col, row, type, terrain: type, movement: 1, defense: 1 };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Bombards', isHuman: false, isAlive: true, technologies: ['nuclear_power'], resources: { gold: 900 } },
    { id: 1, name: 'Targetia', isHuman: false, isAlive: true, technologies: [], resources: { gold: 900 } },
  ];
  e.diplomacyManager = new DiplomacyManager(e as GameEngine);
  e.diplomacyManager.initialize([0, 1]);
  e.initializePlayerStorage(0);
  e.initializePlayerStorage(1);
  return e as GameEngine;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number, pop = 6, buildings: string[] = []) {
  const city = {
    id: `city_${civId}_${name}`,
    name,
    civilizationId: civId,
    col,
    row,
    population: pop,
    buildings,
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
    isDefeated: false,
    attack: 1,
    defense: 1,
    movesRemaining: 5,
    movement: 1,
    type: 'warrior',
    ...opts,
  };
  engine.units.push(unit as never);
  return unit as Unit;
}

const addNuke = (engine: GameEngine, col: number, row: number, civId = 0) =>
  addUnit(engine, {
    id: 'nuke',
    type: 'nuclear',
    col,
    row,
    civilizationId: civId,
    attack: 99,
    defense: 0,
    movesRemaining: 16,
    movement: 16,
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ai = (engine: GameEngine) => engine.aiManager as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const production = (engine: GameEngine) => engine.autoProduction as any;

const living = (engine: GameEngine, civId: number) =>
  engine.units.filter((u) => u.civilizationId === civId && !u.isDefeated);

describe('nuclear detonation', () => {
  it('kills every foreign unit in the blast and halves the enemy city', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 4, 2);
    addUnit(engine, { id: 'guard', col: 4, row: 3, civilizationId: 1, defense: 4 });
    const outside = addUnit(engine, { id: 'far', col: 8, row: 4, civilizationId: 1, defense: 4 });
    addUnit(engine, { id: 'besieger', col: 1, row: 1, civilizationId: 0 });
    const city = addCity(engine, 'Target', 4, 2, 1, 8, ['city_walls', 'temple']);

    expect(NUCLEAR_BLAST_RADIUS).toBeGreaterThanOrEqual(1);
    expect(engine.detonateNuclear(nuke.id, 4, 2)).toBe(true);

    // Blast = 2 tiles: the guard (adjacent) dies, the far unit lives.
    expect(living(engine, 1)).toEqual([outside]);
    expect(engine.units.find((u) => u.id === 'guard')).toBeUndefined();
    // Own troops are never caught in their own blast.
    expect(engine.units.some((u) => u.id === 'besieger' && !u.isDefeated)).toBe(true);
    // The warhead is spent.
    expect(engine.units.some((u) => u.id === 'nuke')).toBe(false);

    // City: 8 → 4, walls stripped, temple kept.
    expect(city.population).toBe(4);
    expect(city.buildings).toEqual(['temple']);
  });

  it('razes a city driven to zero by the blast', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 4, 2);
    addCity(engine, 'Hamlet', 4, 2, 1, 1);

    expect(engine.detonateNuclear(nuke.id, 4, 2)).toBe(true);
    expect(engine.cities).toHaveLength(0);
  });

  it('declares war the moment the warhead goes off', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 4, 2);
    addUnit(engine, { id: 'guard', col: 4, row: 2, civilizationId: 1 });
    expect(engine.diplomacyManager.isAtWar(0, 1)).toBe(false);

    expect(engine.detonateNuclear(nuke.id, 4, 2)).toBe(true);
    expect(engine.diplomacyManager.isAtWar(0, 1)).toBe(true);
  });

  it('refuses to spend a warhead on empty ground', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 4, 2);
    expect(engine.detonateNuclear(nuke.id, 0, 0)).toBe(false);
    expect(engine.units.some((u) => u.id === 'nuke')).toBe(true);
  });

  it('refuses a warhead that has already moved or is not a nuke', () => {
    const engine = makeEngine();
    const spent = addNuke(engine, 4, 2);
    spent.movesRemaining = 0;
    expect(engine.detonateNuclear(spent.id, 4, 2)).toBe(false);

    const warrior = addUnit(engine, { id: 'w', col: 2, row: 2, civilizationId: 0 });
    expect(engine.detonateNuclear(warrior.id, 4, 2)).toBe(false);
  });

  it('moving a nuclear unit onto hostile ground detonates it', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 3, 2);
    addUnit(engine, { id: 'guard', col: 4, row: 2, civilizationId: 1, defense: 5 });
    addCity(engine, 'Target', 5, 2, 1, 6);

    const result = engine.moveUnit(nuke.id, 4, 2);
    expect(result.combat).toBe(true);
    expect(result.reason).toBe('nuclear_strike');
    expect(engine.units.some((u) => u.id === 'nuke')).toBe(false);
    // The garrison that was standing on the tile is gone.
    expect(engine.units.some((u) => u.id === 'guard')).toBe(false);
  });
});

describe('AI nuclear targeting', () => {
  it('holds the warhead while nobody is at war', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 1, 1);
    addCity(engine, 'Target', 5, 2, 1, 6);
    expect(ai(engine).chooseNuclearStrike(nuke)).toBeNull();
  });

  it('prefers the key enemy city — biggest, capital first', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 1, 1);
    addCity(engine, 'Hamlet', 3, 3, 1, 2);
    addCity(engine, 'Capital', 6, 3, 1, 7);
    engine.diplomacyManager.declareWar(0, 1);

    const strike = ai(engine).chooseNuclearStrike(nuke);
    expect(strike).not.toBeNull();
    expect(strike.reason).toContain('Capital');
    expect(strike.col).toBe(6);
    expect(strike.row).toBe(3);
  });

  it('falls back to a stack of key enemy military units', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 1, 1);
    addUnit(engine, { id: 'e1', col: 7, row: 1, civilizationId: 1, attack: 4, defense: 3 });
    addUnit(engine, { id: 'e2', col: 7, row: 2, civilizationId: 1, attack: 4, defense: 3 });
    addUnit(engine, { id: 'e3', col: 8, row: 1, civilizationId: 1, attack: 4, defense: 3 });
    engine.diplomacyManager.declareWar(0, 1);

    const strike = ai(engine).chooseNuclearStrike(nuke);
    expect(strike).not.toBeNull();
    expect(strike.reason).toContain('enemy stack');
    expect(strike.score).toBeGreaterThan(0);
  });

  it('never fires into its own troops', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 1, 1);
    addCity(engine, 'Target', 5, 2, 1, 6);
    // Our own army is already standing on the objective.
    addUnit(engine, { id: 'ours', col: 5, row: 3, civilizationId: 0 });
    engine.diplomacyManager.declareWar(0, 1);

    expect(ai(engine).chooseNuclearStrike(nuke)).toBeNull();
  });

  it('ignores a lone weak unit — a warhead is not worth one spearman', () => {
    const engine = makeEngine();
    const nuke = addNuke(engine, 1, 1);
    addUnit(engine, { id: 'lone', col: 7, row: 4, civilizationId: 1, attack: 1, defense: 1 });
    engine.diplomacyManager.declareWar(0, 1);

    expect(ai(engine).chooseNuclearStrike(nuke)).toBeNull();
  });
});

describe('AI production of warheads', () => {
  const nukeTech = (engine: GameEngine) => {
    engine.civilizations[0].technologies = ['nuclear_power'];
  };

  it('builds one once the civ can and has a reason to fire', () => {
    const engine = makeEngine();
    const city = addCity(engine, 'Forge', 1, 1, 0, 4);
    city.currentProduction = { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 40 } as never;
    nukeTech(engine);
    engine.diplomacyManager.declareWar(0, 1);

    expect(production(engine).shouldBuildNuclear(city)).toBe(true);
    const item = production(engine).buildNuclearProduction(city);
    expect(item).toEqual({ type: 'unit', itemType: 'nuclear', name: 'Nuclear', cost: 160 });
  });

  it('does not build one without the technology', () => {
    const engine = makeEngine();
    engine.civilizations[0].technologies = [];
    const city = addCity(engine, 'Forge', 1, 1, 0, 4);
    engine.diplomacyManager.declareWar(0, 1);
    expect(production(engine).shouldBuildNuclear(city)).toBe(false);
  });

  it('does not buy warheads out of a treasury that is already in deficit', () => {
    const engine = makeEngine();
    const city = addCity(engine, 'Forge', 1, 1, 0, 4);
    nukeTech(engine);
    engine.diplomacyManager.declareWar(0, 1);
    engine.civilizations[0].resources.gold = -20;

    expect(production(engine).shouldBuildNuclear(city)).toBe(false);
  });

  it('buys one even when the treasury is merely under its reserve target', () => {
    // The reserve target is `upkeep × 2–3`, which a wartime civ is below almost
    // every turn. Gating on that meant a 634-round game reached 2085 AD with
    // 31 techs and never built a warhead.
    const engine = makeEngine();
    const city = addCity(engine, 'Forge', 1, 1, 0, 4);
    nukeTech(engine);
    engine.diplomacyManager.declareWar(0, 1);
    engine.civilizations[0].resources.gold = 1;
    expect(engine.aiEconomicManager!.isUnderEconomicPressure(engine.civilizations[0])).toBe(true);

    expect(production(engine).shouldBuildNuclear(city)).toBe(true);
  });

  it('stops once the stock it wants is already owned or queued', () => {
    const engine = makeEngine();
    const city = addCity(engine, 'Forge', 1, 1, 0, 4);
    nukeTech(engine);
    engine.diplomacyManager.declareWar(0, 1);
    addNuke(engine, 2, 2);

    expect(production(engine).nuclearStock(0)).toBe(1);
    expect(production(engine).shouldBuildNuclear(city)).toBe(false);
  });
});
