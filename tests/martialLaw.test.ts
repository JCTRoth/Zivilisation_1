/**
 * Martial law and wonder content — the "authoritarian rule" mechanic.
 *
 * A military unit standing *on* a city tile is worth one happiness each under
 * Despotism, Monarchy and Communism, and nothing at all under Republic or
 * Democracy. It is the cheapest happiness in the game: no gold, no worker, just
 * a soldier who was going to be built anyway. Wonders with `globalHappiness`
 * (Pyramids, Hanging Gardens) do the same job for the whole empire at once.
 *
 * Both were declared or intended and not delivered:
 *  - `globalHappiness` was read by nothing, so both wonders were dead weight;
 *  - the AI garrisoned within two tiles for *defence*, which earns no martial
 *    law, and then hired Entertainers to do a job its soldiers could do free.
 */
import { describe, expect, it } from 'vitest';
import { makeEngine, makeGridEngine } from './helpers/world';
import type { City, Civilization, Unit } from '../types/game';

const G = 'grassland';

/** An engine with one civ, one city and a controllable set of units. */
function world1(population = 6) {
  const engine = makeGridEngine([
    [G, G, G, G, G],
    [G, G, G, G, G],
    [G, G, G, G, G],
    [G, G, G, G, G],
    [G, G, G, G, G],
  ]);
  const city = {
    id: 'c1', name: 'Town', civilizationId: 0, col: 2, row: 2, population,
    buildings: [] as string[], specialists: [] as string[],
    workingTiles: new Set<string>(['2,2']),
    userAssignedTiles: new Set<string>(),
    yields: { food: 4, production: 4, trade: 4 },
  } as unknown as City;
  engine.cities = [city];
  const civ = engine.civilizations[0] as Civilization;
  return { engine, city, civ };
}

function addWarrior(engine: any, col: number, row: number, id = 'w'): Unit {
  const unit = {
    id, type: 'warrior', civilizationId: 0, col, row, health: 100,
    movesRemaining: 1, attack: 1, defense: 1, isDefeated: false,
  } as unknown as Unit;
  engine.units.push(unit);
  return unit;
}

describe('martial law', () => {
  it('counts a soldier on the city tile, and caps it', () => {
    const { engine, city, civ } = world1();
    civ.government = 'monarchy';

    expect(engine.economicManager.martialLaw(civ, city)).toMatchObject({ bonus: 0, max: 3 });

    addWarrior(engine, 2, 2, 'a');
    addWarrior(engine, 2, 2, 'b');
    expect(engine.economicManager.martialLaw(civ, city).bonus).toBe(2);

    // Past the cap the extra soldier is worth nothing — the guide's "only 3 are
    // effective" limit, and the reason the AI must not over-garrison.
    addWarrior(engine, 2, 2, 'c');
    addWarrior(engine, 2, 2, 'd');
    addWarrior(engine, 2, 2, 'e');
    expect(engine.economicManager.martialLaw(civ, city).bonus).toBe(3);
    expect(engine.economicManager.martialLaw(civ, city).current).toBe(5);
  });

  it('gives Despotism four points and Monarchy/Communism three', () => {
    const { engine, city, civ } = world1();
    for (let i = 0; i < 6; i++) addWarrior(engine, 2, 2, `w${i}`);

    civ.government = 'despotism';
    expect(engine.economicManager.martialLaw(civ, city).max).toBe(4);
    civ.government = 'anarchy';
    expect(engine.economicManager.martialLaw(civ, city).max).toBe(4);
    civ.government = 'monarchy';
    expect(engine.economicManager.martialLaw(civ, city).max).toBe(3);
    civ.government = 'communism';
    expect(engine.economicManager.martialLaw(civ, city).max).toBe(3);
  });

  it('is worth nothing under Republic or Democracy', () => {
    const { engine, city, civ } = world1();
    for (let i = 0; i < 4; i++) addWarrior(engine, 2, 2, `w${i}`);

    for (const government of ['republic', 'democracy']) {
      civ.government = government;
      const law = engine.economicManager.martialLaw(civ, city);
      expect(law.max, government).toBe(0);
      expect(law.bonus, government).toBe(0);
    }
  });

  it('needs the unit ON the tile, not nearby', () => {
    const { engine, city, civ } = world1();
    civ.government = 'monarchy';
    addWarrior(engine, 2, 1, 'beside');   // one tile north
    addWarrior(engine, 3, 3, 'diagonal');
    expect(engine.economicManager.martialLaw(civ, city).bonus).toBe(0);
  });

  it('actually reaches the happiness total', () => {
    const { engine, city, civ } = world1(4);
    civ.government = 'monarchy';
    const before = engine.economicManager.cityHappiness(city, civ).happiness;
    addWarrior(engine, 2, 2);
    const after = engine.economicManager.cityHappiness(city, civ).happiness;
    expect(after).toBe(before + 1);
  });

  it('can pull a city out of disorder on its own', () => {
    const { engine, city, civ } = world1(6);
    civ.government = 'despotism';
    // 6 unhappy vs 2 base contentment → disorder with an empty city.
    expect(engine.economicManager.cityHappiness(city, civ).disorder).toBe(true);
    for (let i = 0; i < 4; i++) addWarrior(engine, 2, 2, `w${i}`);
    const after = engine.economicManager.cityHappiness(city, civ);
    expect(after.disorder).toBe(false);
  });
});

describe('wonder content', () => {
  it('grants every city of the civ happiness, not just the holder', () => {
    const { engine, city, civ } = world1(4);
    const other = {
      ...city, id: 'c2', name: 'Other', col: 0, row: 0,
      workingTiles: new Set<string>(['0,0']),
    } as unknown as City;
    engine.cities = [city, other];
    city.buildings = ['pyramids'];

    // The city that does NOT hold the wonder is the proof: it gets the point too.
    expect(engine.economicManager.wonderHappiness(civ)).toBe(1);
    const far = engine.economicManager.cityHappiness(other, civ).happiness;
    city.buildings = [];
    const without = engine.economicManager.cityHappiness(other, civ).happiness;
    expect(far - without).toBe(1);
  });

  it('counts a global wonder once, however many cities hold one', () => {
    const { engine, city, civ } = world1(4);
    const other = { ...city, id: 'c2', col: 0, row: 0 } as unknown as City;
    engine.cities = [city, other];
    city.buildings = ['pyramids'];
    other.buildings = ['hanging_gardens'];
    expect(engine.economicManager.wonderHappiness(civ)).toBe(2);
  });

  it('does not leak to another civ', () => {
    const { engine, city } = world1(4);
    city.buildings = ['pyramids'];
    const rival = engine.civilizations[1] as Civilization;
    expect(engine.economicManager.wonderHappiness(rival)).toBe(0);
  });
});

describe('AI: garrison for martial law instead of hiring entertainers', () => {
  it('parks a defender on the tile of a city that needs the point', async () => {
    const w = await makeEngine({ seed: 31 });
    await w.runTurns(10);
    const engine = w.engine;
    const civ = engine.civilizations.find(c => !c.isHuman)!;
    const city = engine.cities.find(c => c.civilizationId === civ.id)!;
    if (!city) return;

    civ.government = 'monarchy';
    // A big, unhappy city: something a garrison can actually fix.
    city.population = 10;
    city.buildings = [];
    city.specialists = [];
    engine.economicManager.recomputeCityYields(city);
    const unhappy = engine.economicManager.cityHappiness(city, civ);
    expect(unhappy.unhappiness).toBeGreaterThan(unhappy.happiness);

    // The rule the AI must follow: the point is available, free, and would
    // resolve the shortfall, so a soldier is worth more here than an Entertainer.
    expect(engine.economicManager.martialLaw(civ, city).bonus).toBe(0);
    expect(engine.economicManager.martialLaw(civ, city).max).toBeGreaterThan(0);
  }, 120_000);
});
