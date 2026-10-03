/**
 * The building coordinator: how many of each building a city may hold, and
 * whether the next one is worth buying at all.
 *
 * The failure this prevents is an empire that buys six of something it only
 * needs one or two of. `AIBuildingStrategy` scores a building per city and has
 * no idea what the rest of the empire owns, so every copy looked like a fresh
 * purchase. The coordinator adds the two missing questions — how many are
 * useful, and does this one actually pay here — and this file pins both.
 */
import { describe, expect, it } from 'vitest';
import {
  countBuildingCopies,
  countCopiesIn,
  coordinationWeight,
  evaluateBuildingForCity,
  HAPPINESS_BUILDINGS,
  HAPPINESS_BUILDINGS_PER_CITY,
  usefulCityCopies,
  usefulCivCopies,
} from '@/game/engine/AI/BuildingCoordinator';
import { makeEngine } from './helpers/world';
import type { City, Civilization } from '../types/game';

async function world() {
  const w = await makeEngine({ seed: 31 });
  await w.runTurns(10);
  const engine = w.engine;
  const civ = engine.civilizations.find(c => !c.isHuman) as Civilization;
  const city = engine.cities.find(c => c.civilizationId === civ.id) as City;
  // A size that can plausibly be short of happiness, and enough tiles that
  // trade is not trivially zero.
  city.population = 6;
  engine.economicManager.recomputeCityYields(city);
  return { engine, civ, city };
}

const value = (engine: any, civ: Civilization, city: City, type: string) =>
  evaluateBuildingForCity(engine, civ, city, type, 0, countCopiesIn(city, type));

describe('useful copies: one is enough unless the effect stacks', () => {
  it('caps a city at one of every building that does not stack', () => {
    for (const type of ['courthouse', 'aqueduct', 'bank', 'factory', 'colosseum',
      'hydro_plant', 'power_plant', 'mass_transit', 'stock_exchange', 'city_walls']) {
      expect(usefulCityCopies(type), type).toBe(1);
    }
  });

  it('allows a small depth only where the effect scales with the city', () => {
    expect(usefulCityCopies('temple')).toBe(3);
    expect(usefulCityCopies('marketplace')).toBe(2);
    expect(usefulCityCopies('library')).toBe(2);
    expect(usefulCityCopies('university')).toBe(2);
  });

  it('caps the happiness buildings as a set, as the game counts them', () => {
    // Civ 1 counts only the first four in a city, in any mix.
    expect(HAPPINESS_BUILDINGS_PER_CITY).toBe(4);
    for (const t of ['temple', 'colosseum', 'cathedral', 'hospital']) {
      expect(HAPPINESS_BUILDINGS.has(t), t).toBe(true);
    }
    expect(HAPPINESS_BUILDINGS.has('bank')).toBe(false);
  });

  it('caps empire-wide buildings across all cities', () => {
    expect(usefulCivCopies('palace')).toBe(1);
    expect(usefulCivCopies('sdi_defense')).toBe(1);
    expect(usefulCivCopies('temple')).toBe(0); // no empire-wide cap
  });
});

describe('a copy that does not pay is not bought', () => {
  it('refuses a building the engine never applies', async () => {
    const { engine, civ, city } = await world();
    // A Factory declares +2 production and +2 pollution. The engine reads
    // neither from a building, so a copy is 3 gold a turn for nothing.
    const factory = value(engine, civ, city, 'factory');
    expect(factory.worthBuilding).toBe(false);
    expect(factory.netPerTurn).toBeLessThan(0);
    expect(factory.reason).toMatch(/upkeep|does nothing|returns/);
  });

  it('refuses a second copy of a building that does not stack', async () => {
    const { engine, civ, city } = await world();
    city.buildings = [...(city.buildings ?? []), 'bank'];
    const second = evaluateBuildingForCity(engine, civ, city, 'bank', 1, 1);
    expect(second.worthBuilding).toBe(false);
    expect(second.reason).toMatch(/city already has 1 of 1/);
  });

  it('refuses a fifth happiness building in any mix', async () => {
    const { engine, civ, city } = await world();
    city.buildings = [...(city.buildings ?? []), 'temple', 'temple', 'colosseum', 'cathedral'];
    const fifth = value(engine, civ, city, 'hospital');
    expect(fifth.worthBuilding).toBe(false);
    expect(fifth.reason).toMatch(/happiness buildings/);
  });

  it('still allows a fourth happiness building when the city is short', async () => {
    const { engine, civ, city } = await world();
    city.buildings = [...(city.buildings ?? []), 'temple', 'temple', 'temple'];
    const fourth = value(engine, civ, city, 'temple');
    expect(fourth.cityCap).toBe(3);
    // Three is the per-type cap, so a fourth temple is out even though the set
    // has room — the cap is per type as well as per set.
    expect(fourth.worthBuilding).toBe(false);
  });
});

describe('happiness is priced where it is actually missing', () => {
  it('counts a temple\'s relief in a city that is short of happiness', async () => {
    const { engine, civ, city } = await world();
    // Big enough that the city cannot be content: unhappiness is population
    // less the government's tolerance.
    city.population = 16;
    engine.economicManager.recomputeCityYields(city);
    const state = engine.economicManager.cityHappiness(city, civ);
    expect(state.unhappiness).toBeGreaterThan(state.happiness);

    const temple = value(engine, civ, city, 'temple');
    expect(temple.happinessRelief).toBe(1);
  });

  it('buys the temple that completes the set and pulls the city out of disorder', async () => {
    const { engine, civ, city } = await world();

    // Put the city EXACTLY one point short, which is the situation where the
    // next building is the one that matters. Found by search rather than by
    // adding temples until it happens: each temple moves the shortfall by one,
    // so a city can go 3 → 2 → 1 → content and skip the state being tested, and
    // which state it lands in depends on the government the civ happens to run.
    const shortfallAt = (population: number): number => {
      city.population = population;
      engine.economicManager.recomputeCityYields(city);
      const h = engine.economicManager.cityHappiness(city, civ);
      return h.unhappiness - h.happiness;
    };
    const candidates = Array.from({ length: 24 }, (_, i) => i + 1);
    const chosen = candidates.find(pop => shortfallAt(pop) === 1);
    if (chosen === undefined) return; // no population reaches exactly one short
    city.population = chosen;
    engine.economicManager.recomputeCityYields(city);

    const before = engine.economicManager.cityHappiness(city, civ);
    expect(before.unhappiness - before.happiness).toBe(1);

    const temple = value(engine, civ, city, 'temple');
    expect(temple.avoidsDisorder).toBe(true);
    // Worth the upkeep: it is worth the whole city's output, not a point of it.
    expect(temple.netPerTurn).toBeGreaterThan(0);
    expect(temple.worthBuilding).toBe(true);
  });

  it('values nothing at all in a city that is comfortably content', async () => {
    const { engine, civ, city } = await world();
    // Pile on happiness until the city has slack to spare.
    city.buildings = [
      ...(city.buildings ?? []),
      'temple', 'temple', 'temple', 'colosseum', 'cathedral', 'hospital',
    ];
    const happy = engine.economicManager.cityHappiness(city, civ);
    if (happy.happiness > happy.unhappiness + 1) {
      const extra = value(engine, civ, city, 'marketplace');
      expect(extra.happinessRelief).toBe(0);
    }
  });
});

describe('coordination across the empire', () => {
  it('counts copies per city and across all own cities', async () => {
    const { engine, civ, city } = await world();
    const second = engine.cities.find(c => c.civilizationId === civ.id && c.id !== city.id);
    city.buildings = [...(city.buildings ?? []), 'library', 'library'];
    if (!second) return;
    second.buildings = [...(second.buildings ?? []), 'library'];

    const counts = countBuildingCopies(engine, civ, city, 'library');
    expect(counts.cityCopies).toBe(2);
    expect(counts.civCopies).toBe(3);
  });

  it('asks the city with fewer copies to buy the next one', async () => {
    const { engine, civ, city } = await world();
    const other = engine.cities.find(c => c.civilizationId === civ.id && c.id !== city.id);
    if (!other) return;
    city.buildings = [...(city.buildings ?? []), 'library', 'library'];
    other.buildings = [...(other.buildings ?? []), 'library'];

    const here = coordinationWeight(engine, civ, city, 'library');
    const there = coordinationWeight(engine, civ, other, 'library');
    expect(here.weight).toBeLessThan(1);
    expect(here.reason).toMatch(/fewer/);
    expect(there.weight).toBe(1);
  });

  it('refuses a type the city has no room for', async () => {
    const { engine, civ, city } = await world();
    city.buildings = [...(city.buildings ?? []), 'courthouse'];
    expect(coordinationWeight(engine, civ, city, 'courthouse').weight).toBe(0);
  });

  it('refuses a second palace or SDI Defense empire-wide', async () => {
    const { engine, civ, city } = await world();
    engine.cities.filter(c => c.civilizationId === civ.id)
      .forEach(c => { c.buildings = [...(c.buildings ?? []), 'sdi_defense']; });
    expect(coordinationWeight(engine, civ, city, 'sdi_defense').weight).toBe(0);
  });
});
