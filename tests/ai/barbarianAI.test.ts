import { describe, expect, it } from 'vitest';
import { BarbarianManager } from '@/game/engine/BarbarianManager';

/**
 * Barbarian AI regression tests. Barbarians start as the phantom civ (−1):
 * they raid cities, and the moment they hold a city they become a real
 * faction whose cities run AutoProduction restricted to MILITARY units only
 * (raiders). No GameEngine is needed — the manager only talks to the public
 * engine surface (units/cities, squareGrid, moveUnit, combatUnit,
 * spawnBarbarianUnit, autoProduction, ensureBarbarianCivilization).
 */
const createMockEngine = () => {
  const units: any[] = [];
  const cities: any[] = [];
  const moveCalls: Array<{ id: string; col: number; row: number }> = [];
  const combatCalls: Array<{ a: any; d: any }> = [];
  const spawned: string[] = [];

  const engine: any = {
    units,
    cities,
    squareGrid: {
      squareDistance: (c1: number, r1: number, c2: number, r2: number) =>
        Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
      getNeighbors: (c: number, r: number) => [
        { col: c + 1, row: r }, { col: c - 1, row: r },
        { col: c, row: r + 1 }, { col: c, row: r - 1 },
      ],
      // path[1] == target, so a unit "steps" straight onto its target.
      findPath: (_c: number, _r: number, tc: number, tr: number) => [
        { col: tc, row: tr }, { col: tc, row: tr },
      ],
    },
    getTileAt: () => ({ type: 'grassland', movement: 1, passable: true }),
    getUnitAt: (c: number, r: number) =>
      units.find((u) => u.col === c && u.row === r && u.civilizationId !== -1) ?? null,
    getCityAt: (c: number, r: number) => cities.find((ci) => ci.col === c && ci.row === r) ?? null,
    getPassabilityFilter: () => () => true,
    moveUnit: (id: string, col: number, row: number) => {
      moveCalls.push({ id, col, row });
      const u = units.find((x) => x.id === id);
      if (u) { u.col = col; u.row = row; u.movesRemaining = 0; }
      return { success: true };
    },
    combatUnit: (a: any, d: any) => { combatCalls.push({ a, d }); a.movesRemaining = 0; },
    spawnBarbarianUnit: (type: string, col: number, row: number) => {
      spawned.push(`${type}@${col},${row}`);
    },
    // Barbarians become a faction the moment they hold a city.
    ensureBarbarianCivilization: () => ({ id: -1 }),
    // Simplified stand-in for AutoProduction: barbarian cities produce a
    // military raider (chariot) — the real engine routes through
    // AutoProduction.buildBarbarianMilitaryProduction.
    autoProduction: {
      processAutoProductionForCivilization: (civId: number) => {
        cities
          .filter((c: any) => c.civilizationId === civId && c.autoProduction)
          .forEach((c: any) => {
            if (!c.currentProduction) {
              c.currentProduction = { type: 'unit', itemType: 'chariot', name: 'Chariot', cost: 40 };
            }
          });
      },
    },
  };

  return { engine, units, cities, moveCalls, combatCalls, spawned };
};

const barb = (id: string, col: number, row: number, type = 'legion') => ({
  id, type, civilizationId: -1, col, row, movesRemaining: 1, maxMoves: 1, health: 100,
  attack: 3, defense: 1,
});

describe('Barbarian AI — aggression', () => {
  it('with more than 3 units and a weaker target, ALL troops converge on the weakest city', () => {
    const { engine, units, cities, moveCalls } = createMockEngine();
    units.push(barb('b1', 10, 10), barb('b2', 10, 11), barb('b3', 11, 10), barb('b4', 11, 11));
    // A strong city (pop 8 + walls) and a weak city (pop 2, no walls).
    cities.push({ id: 'cA', civilizationId: 0, col: 30, row: 30, population: 8, buildings: ['city_walls'], name: 'A' });
    cities.push({ id: 'cB', civilizationId: 1, col: 2, row: 2, population: 2, buildings: [], name: 'B' });

    new BarbarianManager(engine).processBarbarians();

    expect(moveCalls.length).toBeGreaterThan(0);
    for (const call of moveCalls) {
      // Much aggression → every unit marches at the WEAKEST city (B), not A.
      expect(call).toMatchObject({ col: 2, row: 2 });
    }
  });

  it('with a small horde each unit raids its NEAREST city instead of the weakest', () => {
    const { engine, units, cities, moveCalls } = createMockEngine();
    units.push(barb('b1', 10, 10));
    cities.push({ id: 'cA', civilizationId: 0, col: 12, row: 10, population: 8, buildings: [], name: 'A' }); // nearest
    cities.push({ id: 'cB', civilizationId: 1, col: 2, row: 2, population: 2, buildings: [], name: 'B' }); // weakest but far

    new BarbarianManager(engine).processBarbarians();

    expect(moveCalls.length).toBe(1);
    expect(moveCalls[0]).toMatchObject({ col: 12, row: 10 });
  });

  it('attacks an adjacent enemy unit before moving', () => {
    const { engine, units, combatCalls } = createMockEngine();
    units.push(barb('b1', 5, 5));
    units.push({ id: 'e1', type: 'warrior', civilizationId: 0, col: 6, row: 5, movesRemaining: 1, health: 100, attack: 1, defense: 1 });

    new BarbarianManager(engine).processBarbarians();

    expect(combatCalls.length).toBe(1);
    expect(combatCalls[0].d.id).toBe('e1');
  });

  it('never attacks the nomads (-2) — they are friends of the horde', () => {
    const { engine, units, combatCalls, moveCalls } = createMockEngine();
    units.push(barb('b1', 5, 5));
    // A nomad camp unit stands right beside the raider, and there is no
    // city anywhere: with nothing else to do, the old filter would have
    // made the barbarian attack the one unit it must never touch.
    units.push({
      id: 'nomad', type: 'warriors', civilizationId: -2,
      col: 6, row: 5, movesRemaining: 1, health: 100, attack: 2, defense: 2,
    });

    new BarbarianManager(engine).processBarbarians();

    expect(combatCalls).toHaveLength(0);
    expect(moveCalls).toHaveLength(0);
  });

  it('does not assault a city the nomads own (-2)', () => {
    const { engine, units, cities, moveCalls } = createMockEngine();
    units.push(barb('b1', 5, 5));
    cities.push({
      id: 'nomadCity', civilizationId: -2, col: 6, row: 5,
      population: 3, buildings: [], name: 'Bought',
    });

    new BarbarianManager(engine).processBarbarians();

    // The assault step (step 2) must skip it — and with no positive-civ
    // city on the map there is no target to march on either.
    expect(moveCalls).toHaveLength(0);
  });
});

describe('Barbarian AI — captured cities', () => {
  it('captured cities sell everything and pump MILITARY units only (raiders)', () => {
    const { engine, cities, spawned } = createMockEngine();
    cities.push({
      id: 'cap', civilizationId: -1, col: 5, row: 5, population: 4, name: 'Captured',
      buildings: ['granary', 'marketplace'], yields: { production: 40 },
      currentProduction: null, productionStored: 0,
      autoProduction: true,
    });

    const manager = new BarbarianManager(engine);

    // Round 1: buildings sold; auto-production picks a chariot raider
    // (military only) which completes at 40 shields/turn.
    manager.processBarbarians();
    expect(cities[0].buildings).toEqual([]);
    expect(spawned[0]).toBe('chariot@5,5');
    expect(cities[0].barbarianScoutBuilt).toBeUndefined(); // no scout path

    // Round 2: keeps pumping raiders.
    manager.processBarbarians();
    expect(spawned[1]).toBe('chariot@5,5');
  });

  it('a slow captured city keeps a raider queued until it is produced', () => {
    const { engine, cities, spawned } = createMockEngine();
    cities.push({
      id: 'cap', civilizationId: -1, col: 5, row: 5, population: 4, name: 'Captured',
      buildings: [], yields: { production: 5 },
      currentProduction: null, productionStored: 0,
      autoProduction: true,
    });

    const manager = new BarbarianManager(engine);

    manager.processBarbarians(); // starts chariot, 5/40 shields
    expect(spawned).toEqual([]);
    expect(cities[0].currentProduction.itemType).toBe('chariot');
    expect(cities[0].productionStored).toBe(5);

    manager.processBarbarians(); // 10/40
    manager.processBarbarians(); // 15/40
    expect(spawned).toEqual([]);
    expect(cities[0].currentProduction.itemType).toBe('chariot');
    expect(cities[0].productionStored).toBe(15);
  });
});

describe('Barbarian AI — Forge of War read-out (dev overlay)', () => {
  it('records the assault: target, defense, horde strength and an objective per raider', () => {
    const { engine, units, cities } = createMockEngine();
    units.push(barb('b1', 10, 10), barb('b2', 10, 11), barb('b3', 11, 10), barb('b4', 11, 11));
    cities.push({ id: 'cA', civilizationId: 0, col: 30, row: 30, population: 8, buildings: ['city_walls'], name: 'A' });
    cities.push({ id: 'cB', civilizationId: 1, col: 2, row: 2, population: 2, buildings: [], name: 'B' });

    const manager = new BarbarianManager(engine);
    manager.processBarbarians();

    expect(manager.plan.mode).toBe('assault');
    expect(manager.plan.target).toMatchObject({ col: 2, row: 2, name: 'B' });
    expect(manager.plan.defense).toBeGreaterThan(0);
    expect(manager.plan.hordeStrength).toBeGreaterThan(0);
    // No roundManager in this mock: the plan falls back to round 0.
    expect(manager.plan.round).toBe(0);
    expect(manager.plan.objectives).toHaveLength(4);
    for (const objective of manager.plan.objectives) {
      expect(objective).toMatchObject({ col: 2, row: 2 });
    }
  });

  it('records the scouting routes while the horde is too weak to assault', () => {
    const { engine, units, cities } = createMockEngine();
    units.push(barb('b1', 10, 10));
    cities.push({ id: 'cA', civilizationId: 0, col: 12, row: 10, population: 8, buildings: [], name: 'A' });
    cities.push({ id: 'cB', civilizationId: 1, col: 2, row: 2, population: 2, buildings: [], name: 'B' });

    const manager = new BarbarianManager(engine);
    manager.processBarbarians();

    expect(manager.plan.mode).toBe('scout');
    expect(manager.plan.target).toBeNull();
    // One objective per raider, pointing at its own nearest target.
    expect(manager.plan.objectives).toEqual([{ unitId: 'b1', col: 12, row: 10 }]);
  });

  it('goes idle again once the horde is wiped off the map', () => {
    const { engine, units, cities } = createMockEngine();
    units.push(barb('b1', 10, 10));
    cities.push({ id: 'cA', civilizationId: 0, col: 12, row: 10, population: 8, buildings: [], name: 'A' });

    const manager = new BarbarianManager(engine);
    manager.processBarbarians();
    expect(manager.plan.mode).toBe('scout');

    units.length = 0;
    cities.length = 0;
    manager.processBarbarians();

    expect(manager.plan.mode).toBe('idle');
    expect(manager.plan.target).toBeNull();
    expect(manager.plan.objectives).toEqual([]);
  });
});
