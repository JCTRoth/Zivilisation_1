/**
 * Late-game economics, measured over a whole AI game rather than one turn.
 *
 * Three things were wrong at once, and only a long game shows them:
 *
 *  1. **Cities bought copies of buildings they did not need.** One city held
 *     six Marketplaces and a Temple per citizen, because the chooser scores a
 *     building per city and never asks how many the empire already has — and
 *     because most of the building table's effects are not read by the engine
 *     at all, so the copies bought nothing.
 *  2. **Cities starved of happiness.** Pricing a Temple only by whether it
 *     rescued the city on its own meant a city five points short bought none,
 *     and stayed in disorder — losing all tax, all science and all growth — for
 *     the rest of the game.
 *  3. **The civs stopped growing.** Follows from the two above: every shield
 *     went into buildings that did nothing, and the ones that mattered were
 *     never bought.
 *
 * The budgets here are deliberately loose. They are not a balance pass; they
 * are tripwires for the shape of the late game, so a regression shows up as a
 * failed assertion rather than as a subtly worse empire.
 */
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { makeEngine, useSeededRandom } from './helpers/world';
import { usefulCityCopies, HAPPINESS_BUILDINGS, HAPPINESS_BUILDINGS_PER_CITY } from '@/game/engine/AI/BuildingCoordinator';
import type { City, Civilization } from '../types/game';

const TURNS = 150;

const buildingId = (b: unknown): string =>
  typeof b === 'string' ? b : (b as { id?: string; type?: string })?.id ?? (b as { type?: string })?.type ?? '';

function copiesIn(city: City, type: string): number {
  return (city.buildings ?? []).filter(b => buildingId(b) === type).length;
}

describe(`late game after ${TURNS} turns`, () => {
  it('never lets a city hoard copies of a building that does not stack', async () => {
    useSeededRandom(4242);
    const world = await makeEngine({ mapType: 'AI_VS_AI', numberOfCivilizations: 4, seed: 777 });
    const engine = world.engine;

    for (let turn = 1; turn <= TURNS; turn++) {
      await world.runTurns(1);

      for (const city of engine.cities) {
        for (const type of ['courthouse', 'aqueduct', 'bank', 'factory', 'colosseum',
          'stock_exchange', 'hydro_plant', 'power_plant', 'mass_transit',
          'recycling_center', 'city_walls', 'marketplace', 'library', 'university']) {
          const held = copiesIn(city, type);
          expect(held, `${type} x${held} in ${city.name} on turn ${turn}`)
            .toBeLessThanOrEqual(usefulCityCopies(type));
        }
        const happinessBuildings = (city.buildings ?? [])
          .filter(b => HAPPINESS_BUILDINGS.has(buildingId(b))).length;
        expect(happinessBuildings, `happiness buildings in ${city.name} on turn ${turn}`)
          .toBeLessThanOrEqual(HAPPINESS_BUILDINGS_PER_CITY);
      }
    }
  }, 900_000);

  it('keeps the civs alive and solvent', async () => {
    // Seeded RNG: combat and several AI decisions use Math.random, so without
    // this this file's own trajectory changed between runs of the same map.
    useSeededRandom(4242);
    const world = await makeEngine({ mapType: 'AI_VS_AI', numberOfCivilizations: 4, seed: 777 });
    const engine = world.engine;

    await world.runTurns(TURNS);

    // A note on what is and is not asserted here. The map is pinned, but the
    // game is not: combat and several AI decisions use Math.random, so two runs
    // of this file diverge into different wars. Assertions that depend on
    // *who won* are therefore flaky by construction, and only the invariants
    // that must hold on every trajectory are checked. The building caps above
    // are the strict ones; these are the shape-of-the-empire ones.
    const civs = engine.civilizations.filter(c => !c.isHuman) as Civilization[];
    const withCities = civs.filter(c => engine.cities.some(x => x.civilizationId === c.id));

    // Somebody is still playing with cities. An empire that cannot hold its own
    // cities is not an economy, it is a collapse.
    expect(withCities.length).toBeGreaterThanOrEqual(1);

    // Cities are worth more than the two the civs started with.
    const cityCount = engine.cities.length;
    expect(cityCount).toBeGreaterThan(2);

    // Disorder is a total loss of tax, science and growth. A map that is mostly
    // in disorder is a map collecting nothing — this is the assertion that
    // caught the happiness economy being priced one building at a time.
    const disorderFraction
      = engine.cities.filter(c => c.disorder).length / Math.max(1, engine.cities.length);
    expect(disorderFraction).toBeLessThan(0.5);

    // Somebody is earning, and the numbers must be real (no NaN from a division
    // by a city with no tiles).
    const goldPerTurn = withCities.reduce((sum, c) => sum
      + engine.cities.filter(x => x.civilizationId === c.id).reduce((s, x) => s + (x.tax ?? 0), 0), 0);
    expect(Number.isFinite(goldPerTurn)).toBe(true);
    expect(goldPerTurn).toBeGreaterThan(0);
  }, 900_000);
});

describe('no tolerance, and the AI climbs to communism', () => {
  it('counts every citizen as unhappy, whatever the government', async () => {
    const world = await makeEngine({ seed: 31 });
    await world.runTurns(10);
    const engine = world.engine;
    const civ = engine.civilizations.find(c => !c.isHuman)!;
    const city = engine.cities.find(c => c.civilizationId === civ.id)!;
    const em = engine.economicManager;

    for (const government of ['despotism', 'monarchy', 'communism', 'republic', 'democracy']) {
      civ.government = government;
      const h = em.cityHappiness(city, civ);
      // No government absorbs any of the crowd any more.
      expect(h.unhappiness, government).toBe(city.population);
    }
  });

  it('reaches communism and keeps it, never ruling under republic', async () => {
    // Seeded RNG: combat and several AI decisions use Math.random, so without
    // this the civ that gets there — or whether any does — varies per run.
    useSeededRandom(4242);
    const world = await makeEngine({ mapType: 'AI_VS_AI', numberOfCivilizations: 4, seed: 777 });
    const engine = world.engine;

    // 320 turns, not 180: with tolerance gone every citizen is unhappy, so
    // civs spend real income on contentment (entertainers, luxury, martial law)
    // and research slower. Measured on the pinned seed, the first civ reaches
    // communism around turn 250-320. Shortening this would assert a balance the
    // game no longer has rather than the policy the user asked for.
    const seen = new Set<string>();
    for (let turn = 1; turn <= 320; turn++) {
      await world.runTurns(1);
      for (const civ of engine.civilizations.filter(c => !c.isHuman)) {
        seen.add(civ.government ?? '');
      }
    }

    // Republic is never adopted, by anyone, at any point.
    expect([...seen]).not.toContain('republic');
    // And the ladder's destination is actually reached.
    expect([...seen]).toContain('communism');
    // Anarchy is the cost of switching, never a destination: it must not be the
    // state a civ is left sitting in.
    const stuckInAnarchy = engine.civilizations
      .filter(c => !c.isHuman)
      .some(c => (c.government ?? '') === 'anarchy' && (c.revolutionTurns ?? 0) > 0);
    expect(stuckInAnarchy).toBe(false);
    vi.restoreAllMocks();
  }, 900_000);
});
