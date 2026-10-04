/**
 * Garrison duty: the minimum guard every city keeps, and the happiness it buys.
 *
 * The rule has three parts, and each was a separate defect:
 *
 *  1. Nothing *assigned* a garrison. Units garrisoned only when they had nothing
 *     else to do, so an empire that spent its soldiers on armies ended up with
 *     undefended cities.
 *  2. Only units standing on the city tile counted. A soldier who fortified
 *     beside the walls — the normal way to garrison, and the one that gets the
 *     +50% defense bonus — contributed nothing.
 *  3. Republic and Democracy got a flat zero, which made garrisoning pointless
 *     for exactly the governments most likely to be busy fighting a war.
 */
import { describe, expect, it } from 'vitest';
import { EconomicManager } from '../src/game/engine/EconomicManager';
import type { Civilization, City, Unit } from '../types/game';
import { makeEngine, useSeededRandom } from './helpers/world';
import { BARBARIAN_CIV_ID } from '../src/data/VillageConstants';

function civ(id: number, government: string): Civilization {
  return { id, name: `C${id}`, government, technologies: [], resources: { gold: 0 } } as unknown as Civilization;
}

function city(id: string, col: number, row: number, civId = 0): City {
  return {
    id, name: id, civilizationId: civId, col, row, population: 4,
    buildings: [], specialists: [], workingTiles: new Set<string>(), buildQueue: [],
  } as unknown as City;
}

function combat(id: string, col: number, row: number, over: Partial<Unit> = {}): Unit {
  return {
    id, type: 'phalanx', civilizationId: 0, col, row, attack: 10, defense: 5,
    isDefeated: false, movementPoints: 0, ...over,
  } as unknown as Unit;
}

/** An EconomicManager over a fixed set of units. */
function econWith(units: Unit[]): EconomicManager {
  const engine = { units, cities: [] } as unknown as ConstructorParameters<typeof EconomicManager>[0];
  return new EconomicManager(engine);
}

describe('garrison counting', () => {
  it('counts a unit standing on the city tile', () => {
    const m = econWith([combat('a', 5, 5)]);
    expect(m.garrisonOnCityTile(civ(0, 'monarchy'), city('c', 5, 5))).toBe(1);
  });

  it('counts a FORTIFIED unit beside the city — the case that paid nothing', () => {
    const m = econWith([combat('a', 6, 5, { isFortified: true })]);
    // One tile away, dug in: defending the city and drawing the defense bonus.
    expect(m.garrisonOnCityTile(civ(0, 'monarchy'), city('c', 5, 5))).toBe(1);
  });

  it('does not count an unfortified unit merely passing through', () => {
    const m = econWith([combat('a', 6, 5)]);
    expect(m.garrisonOnCityTile(civ(0, 'monarchy'), city('c', 5, 5))).toBe(0);
  });

  it('does not count a fortified unit two tiles away', () => {
    const m = econWith([combat('a', 7, 5, { isFortified: true })]);
    expect(m.garrisonOnCityTile(civ(0, 'monarchy'), city('c', 5, 5))).toBe(0);
  });

  it('ignores dead units, non-combat units and other civs', () => {
    const m = econWith([
      combat('dead', 5, 5, { isDefeated: true }),
      combat('settler', 5, 5, { type: 'settler', attack: 0 }),
      combat('other', 5, 5, { civilizationId: 1 }),
      combat('mine', 5, 5),
    ]);
    expect(m.garrisonOnCityTile(civ(0, 'monarchy'), city('c', 5, 5))).toBe(1);
  });
});

describe('martial law by government', () => {
  const cases: Array<[string, number]> = [
    ['despotism', 4],
    ['anarchy', 4],
    ['monarchy', 3],
    ['communism', 3],
    ['republic', 1],
    ['democracy', 1],
  ];

  for (const [government, max] of cases) {
    it(`${government} allows ${max} garrisoned unit(s) of happiness`, () => {
      const m = econWith([]);
      const c = civ(0, government);
      expect(m.martialLaw(c, city('c', 5, 5), 0).max).toBe(max);
      // More units than the cap is worth nothing extra.
      expect(m.martialLaw(c, city('c', 5, 5), 99).bonus).toBe(max);
    });
  }

  it('a republic garrison converts directly into happiness', () => {
    const m = econWith([combat('a', 5, 5)]);
    const c = civ(0, 'republic');
    // The whole point of the change: one defender is worth one content citizen.
    expect(m.martialLaw(c, city('c', 5, 5)).bonus).toBe(1);
  });

  it('counts a fortified unit beside the city toward martial law', () => {
    const m = econWith([combat('a', 5, 5), combat('b', 4, 5, { isFortified: true })]);
    expect(m.martialLaw(civ(0, 'monarchy'), city('c', 5, 5)).bonus).toBe(2);
  });
});

describe('AI garrison duty', () => {
  it('leaves every AI city with at least one guard', async () => {
    useSeededRandom(4242);
    const world = await makeEngine({ mapType: 'AI_VS_AI', numberOfCivilizations: 4, seed: 777 });
    const engine = world.engine as any;

    for (let t = 1; t <= 60; t++) await world.runTurns(1);

    const econ = (engine.economicManager ?? new EconomicManager(engine)) as EconomicManager;
    const unguarded: string[] = [];
    for (const c of engine.cities ?? []) {
      const civ = (engine.civilizations ?? []).find((x: any) => x.id === c.civilizationId);
      if (!civ || civ.isHuman) continue;
      // Barbarians run on BarbarianManager, not the civ AI, and have no
      // government or tax rate — martial law buys them nothing, so a captured
      // city in barbarian hands is looted rather than garrisoned.
      if (civ.id === BARBARIAN_CIV_ID) continue;
      // A civ with no army at all cannot be blamed for an empty wall.
      const army = (engine.units ?? []).filter(
        (u: any) => u.civilizationId === c.civilizationId && (u.attack ?? 0) > 0 && !u.isDefeated,
      );
      if (army.length === 0) continue;
      if (econ.garrisonOnCityTile(civ, c) < 1) unguarded.push(`${civ.name}/${c.name}`);
    }
    expect(unguarded, `cities with an army but no garrison: ${unguarded.join(', ')}`).toEqual([]);
  }, 900_000);
});
