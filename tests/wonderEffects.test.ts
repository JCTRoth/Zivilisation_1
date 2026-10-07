/**
 * Wonder effects — one test per effect the WonderEffects engine applies.
 *
 * Scope rules are exercised alongside the values: city-only effects must not
 * leak to sibling cities, continent effects must stay on the landmass, and
 * civilization effects must reach every city of the OWNER and nobody else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { world as wrapWorld, makeGridEngine, type TestWorld } from './helpers/world';
import GameEngine from '@/game/engine/GameEngine';
import {
  computeNuclearAllowed,
  computeSeesAllCities,
  computeSpaceshipEnabled,
  computeVisionRangeBonus,
} from '@/game/engine/WonderEffects';
import type { City } from '../types/game';

describe('wonder effects', () => {
  let engine: GameEngine;
  let w: TestWorld;
  let city: City;       // the wonder-holding city (civ 0)
  let sibling: City;    // another city of civ 0
  let rivalCity: City;  // a city of civ 1

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    engine.onStateChange = null;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
      mapSeed: 1234,
    });
    w = wrapWorld(engine);
    city = w.settle('WonderCity', 4, 4, 0, 4);
    // The sibling must sit on the SAME landmass — continent-scoped effects
    // (Hoover Dam, AI Supercluster) key off the wonder city's landmass.
    const siblingSpot = w.landNear(city.col, city.row, 4);
    sibling = w.settle('SiblingCity', siblingSpot.col, siblingSpot.row, 0, 3);
    rivalCity = w.settle('RivalCity', 8, 8, 1, 3);
    // Commerce for science/trade assertions (settle only works the centre tile).
    for (const c of [city, sibling, rivalCity]) {
      c.yields = { food: 6, production: 4, trade: 10 };
    }
  });

  afterEach(() => {
    engine.onStateChange = null;
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  const scienceOf = (c: City) =>
    engine.economicManager.cityOutputs(c, engine.civilizations[c.civilizationId]).science;

  // ── Science ─────────────────────────────────────────────────────────────

  it('SETI Program: +30% science in ALL cities of the owner only', () => {
    const base = { city: scienceOf(city), sibling: scienceOf(sibling), rival: scienceOf(rivalCity) };
    city.buildings = ['seti_program'];

    expect(scienceOf(city)).toBe(Math.round(base.city * 1.3));
    expect(scienceOf(sibling)).toBe(Math.round(base.sibling * 1.3));
    expect(scienceOf(rivalCity)).toBe(base.rival);
  });

  it("Copernicus' Observatory: doubles science in the wonder city ONLY", () => {
    const base = { city: scienceOf(city), sibling: scienceOf(sibling) };
    city.buildings = ['copernicus_observatory'];

    expect(scienceOf(city)).toBe(base.city * 2);
    expect(scienceOf(sibling)).toBe(base.sibling); // city-scope: sibling untouched
  });

  it('wonder science percentages stack (SETI +30% and ISS +20% = ×1.5)', () => {
    const base = scienceOf(city);
    city.buildings = ['seti_program', 'international_space_station'];
    expect(engine.wonderEffects?.scienceMultiplierForCity(city)).toBeCloseTo(1.5);
    expect(scienceOf(city)).toBe(Math.round(base * 1.5));
  });

  it("Isaac Newton's College doubles Library/University science in all owner cities", () => {
    sibling.buildings = ['library'];  // science: 1
    rivalCity.buildings = ['library'];
    city.buildings = ['isaac_newtons_college'];

    // The bonus lands through buildingBonuses → city.scienceBonus.
    engine.economicManager.recomputeCityYields(sibling);
    engine.economicManager.recomputeCityYields(rivalCity);
    expect(sibling.scienceBonus).toBe(2);    // 1 × 2 — owner's library doubled
    expect(rivalCity.scienceBonus).toBe(1);  // rival keeps the plain library
  });

  // ── Trade ───────────────────────────────────────────────────────────────

  // Colossus / Statue of Liberty work per WORKED TILE with trade — they need
  // an exact terrain fixture (see the trade describe block at the bottom).

  // ── Production ──────────────────────────────────────────────────────────

  it('Hoover Dam: +1 production on the continent, but NOT for cities with a power plant', () => {
    city.buildings = ['hoover_dam'];
    sibling.buildings = [];
    expect(engine.wonderEffects?.productionBonusForCity(sibling)).toEqual({ flat: 1, percent: 0 });

    sibling.buildings = ['power_plant'];
    expect(engine.wonderEffects?.productionBonusForCity(sibling)).toEqual({ flat: 0, percent: 0 });
  });

  it('Colossus (AI Supercluster): +10% science AND production on the continent', () => {
    const scienceBase = scienceOf(city);
    expect(scienceBase).toBeGreaterThan(3);
    city.buildings = ['ai_supercluster'];
    expect(engine.wonderEffects?.scienceMultiplierForCity(city)).toBeCloseTo(1.1);
    expect(scienceOf(city)).toBe(Math.round(scienceBase * 1.1));

    // Production comes from the tiles — recompute with and without the wonder.
    city.buildings = ['ai_supercluster'];
    engine.economicManager.recomputeCityYields(city);
    const withWonder = city.yields!.production;
    city.buildings = [];
    engine.economicManager.recomputeCityYields(city);
    const without = city.yields!.production;
    expect(withWonder).toBe(Math.round(without * 1.1));

    // Sibling sits on the same landmass in this fixture → continent effects reach it.
    city.buildings = ['ai_supercluster'];
    expect(engine.wonderEffects?.productionBonusForCity(sibling).percent).toBe(10);
  });

  // ── Happiness ───────────────────────────────────────────────────────────

  it('Human Genome Project: +1 happy in every city of the owner, none for rivals', () => {
    city.buildings = ['human_genome_project'];
    expect(engine.economicManager.wonderHappinessForCity(city)).toBe(1);
    expect(engine.economicManager.wonderHappinessForCity(sibling)).toBe(1);
    expect(engine.economicManager.wonderHappinessForCity(rivalCity)).toBe(0);
  });

  it('Hanging Gardens: +1 happy in the wonder city and owner cities on its continent', () => {
    city.buildings = ['hanging_gardens'];
    expect(engine.economicManager.wonderHappinessForCity(city)).toBe(1);
    expect(engine.economicManager.wonderHappinessForCity(sibling)).toBe(1);
    expect(engine.economicManager.wonderHappinessForCity(rivalCity)).toBe(0);
  });

  it("Shakespeare's Theatre: 4 unhappy → content in the wonder city only", () => {
    // Pop 4 → 4 unhappy; the theatre absorbs ALL of them.
    expect(engine.economicManager.wonderUnhappyToContentForCity(city)).toBe(0);
    city.buildings = ['shakespeare_theatre'];
    expect(engine.economicManager.wonderUnhappyToContentForCity(city)).toBe(4);
    expect(engine.economicManager.wonderUnhappyToContentForCity(sibling)).toBe(0);

    const result = engine.economicManager.cityHappiness(city, engine.civilizations[0]);
    expect(result.unhappiness).toBe(0); // 4 − 4, clamped at 0
    expect(result.disorder).toBe(false);
  });

  it("J.S. Bach's Cathedral: 1 unhappy → content per continent city", () => {
    city.buildings = ['js_bachs_cathedral'];
    expect(engine.economicManager.wonderUnhappyToContentForCity(city)).toBe(1);
    expect(engine.economicManager.wonderUnhappyToContentForCity(sibling)).toBe(1);
    expect(engine.economicManager.wonderUnhappyToContentForCity(rivalCity)).toBe(0);
  });

  it('Oracle doubles Temple happiness; Michelangelo boosts Cathedrals by 50%', () => {
    // Oracle lives in `city` but reaches every city of the owner.
    city.buildings = ['oracle'];
    sibling.buildings = ['temple'];
    expect(engine.wonderEffects?.buildingHappinessMultiplier(sibling, 'temple')).toBe(2);
    expect(engine.wonderEffects?.buildingHappinessMultiplier(rivalCity, 'temple')).toBe(1);

    // Michelangelo: cathedral 3 → 4.5 (per-building multiplier).
    city.buildings = ['michelangelos_chapel'];
    expect(engine.wonderEffects?.buildingHappinessMultiplier(sibling, 'cathedral')).toBe(1.5);
    expect(engine.wonderEffects?.buildingHappinessMultiplier(sibling, 'temple')).toBe(1);
  });

  // ── Movement / vision / government ──────────────────────────────────────

  it('Lighthouse and Magellan each add +1 ship movement (stacking)', () => {
    expect(engine.wonderEffects?.navalMoveBonus(0)).toBe(0);
    city.buildings = ['lighthouse'];
    expect(engine.wonderEffects?.navalMoveBonus(0)).toBe(1);
    city.buildings = ['lighthouse', 'magellans_expedition'];
    expect(engine.wonderEffects?.navalMoveBonus(0)).toBe(2);
    expect(engine.wonderEffects?.navalMoveBonus(1)).toBe(0); // rival gets nothing
  });

  it('a sea unit actually resets with the bonus (Lighthouse)', async () => {
    const spot = w.landNear(city.col, city.row, 4);
    const ship = w.spawnUnit({ id: 'ship1', col: spot.col, row: spot.row, type: 'sail', civilizationId: 0 });
    city.buildings = ['lighthouse'];
    const base = (engine.constructor as typeof GameEngine).UNIT_PROPS.sail.movement;
    expect(ship.maxMoves).toBe(base); // bonus applies from the next turn reset

    await w.runTurns(1);

    expect(ship.maxMoves).toBe(base + 1);
    expect(ship.movesRemaining).toBe(base + 1);
  });

  it('Silk Road: +1 vision range for the owner\'s units and cities', () => {
    expect(engine.wonderEffects?.visionBonus(0)).toBe(0);
    expect(computeVisionRangeBonus(engine.cities, engine.civilizations, 0)).toBe(0);
    city.buildings = ['silk_road'];
    expect(engine.wonderEffects?.visionBonus(0)).toBe(1);
    expect(computeVisionRangeBonus(engine.cities, engine.civilizations, 0)).toBe(1);
    expect(engine.wonderEffects?.visionBonus(1)).toBe(0);
  });

  it('Pyramids: a revolution lasts 1 turn instead of 3', () => {
    const civ0 = engine.civilizations[0];
    const civ1 = engine.civilizations[1];
    for (const c of [civ0, civ1]) (c.technologies as string[]).push('monarchy');

    expect(engine.governmentManager.anarchyTurnsFor(civ0.id)).toBe(3);
    city.buildings = ['pyramids'];
    expect(engine.governmentManager.anarchyTurnsFor(civ0.id)).toBe(1);
    expect(engine.governmentManager.anarchyTurnsFor(civ1.id)).toBe(3);

    expect(engine.governmentManager.startRevolution(civ0.id, 'monarchy')).toBe(true);
    expect(civ0.revolutionTurns).toBe(1);
    expect(civ0.government).toBe('anarchy');
  });

  // ── Global gates ────────────────────────────────────────────────────────

  it('Manhattan Project gates nuclear weapons for everyone (global scope)', () => {
    expect(computeNuclearAllowed(engine.cities, engine.civilizations)).toBe(false);
    city.buildings = ['manhattan_project'];
    expect(computeNuclearAllowed(engine.cities, engine.civilizations)).toBe(true);
    // Even a RIVAL completing it opens the gate for all civs with the tech.
    expect(engine.wonderEffects?.nuclearAllowed()).toBe(true);
  });

  it('ISS reveals every city to its owner and opens the space race', () => {
    expect(computeSeesAllCities(engine.cities, engine.civilizations, 0)).toBe(false);
    expect(computeSpaceshipEnabled(engine.cities, engine.civilizations)).toBe(false);

    city.buildings = ['international_space_station'];

    expect(computeSeesAllCities(engine.cities, engine.civilizations, 0)).toBe(true);
    expect(computeSeesAllCities(engine.cities, engine.civilizations, 1)).toBe(false);
    expect(engine.wonderEffects?.seesAllCities(0)).toBe(true);
    expect(computeSpaceshipEnabled(engine.cities, engine.civilizations)).toBe(true);

    // Moonshot: gated by the ISS through updateTechnologyAvailability.
    const moonshot = engine.technologies.find((t) => t.id === 'moonshot');
    expect(moonshot).toBeDefined();
    (engine.civilizations[0].technologies as string[]).push('space_flight');
    engine.updateTechnologyAvailability();
    expect(moonshot?.available, 'space race opens with the ISS').toBe(true);
  });

  it('the Moonshot stays closed while the ISS does not exist', () => {
    (engine.civilizations[0].technologies as string[]).push('space_flight');
    engine.updateTechnologyAvailability();
    const moonshot = engine.technologies.find((t) => t.id === 'moonshot');
    expect(moonshot?.available, 'no ISS → no space race').toBe(false);
  });

  // ── Leonardo ────────────────────────────────────────────────────────────

  it("Leonardo's Workshop auto-upgrades obsolete units when the replacement tech is known", async () => {
    city.buildings = ['leonardos_workshop'];
    (engine.civilizations[0].technologies as string[]).push('gunpowder');
    const warrior = w.spawnUnit({ id: 'old_warrior', col: 2, row: 2, type: 'warrior', civilizationId: 0 });
    expect(warrior.type).toBe('warrior');

    await w.runTurns(1);

    expect(warrior.type, 'warrior → musketeer with Gunpowder').toBe('musketeer');
    expect(warrior.attack).toBeGreaterThan(0);
    // Rival units are untouched.
    const rivalUnit = w.spawnUnit({ id: 'rival_warrior', col: 6, row: 6, type: 'warrior', civilizationId: 1 });
    await w.runTurns(1);
    expect(rivalUnit.type).toBe('warrior');
  });

  it('without Leonardo, obsolete units stay as they are', async () => {
    (engine.civilizations[0].technologies as string[]).push('gunpowder');
    const warrior = w.spawnUnit({ id: 'plain_warrior', col: 2, row: 2, type: 'warrior', civilizationId: 0 });

    await w.runTurns(1);

    expect(warrior.type).toBe('warrior');
  });
});

// ---------------------------------------------------------------------------
// Trade-square effects need an exact terrain fixture: the CITY_CENTER_COMMERCE
// floor (2) masks small bonuses on a normal map, so these tests use a hand-
// built grid with known River tiles (trade 1 each) pinned as worked tiles.
// ---------------------------------------------------------------------------

describe('wonder trade-square effects (exact terrain fixture)', () => {
  const G = 'grassland';
  const R = 'river';

  let engine: GameEngine;
  let w: TestWorld;
  let city: City;
  let sibling: City;
  let rivalCity: City;

  /** Pin a city to work exactly `tiles` (in addition to its centre). */
  const pinTiles = (c: City, tiles: Array<[number, number]>) => {
    const keys = tiles.map(([col, row]) => `${col},${row}`);
    c.userAssignedTiles = new Set(keys);
    c.workingTiles = new Set([`${c.col},${c.row}`, ...keys]);
    c.specialists = [];
    engine.economicManager.recomputeCityYields(c);
  };

  beforeEach(() => {
    engine = makeGridEngine([
      [G, G, G, G, G, G, G, G],
      [R, R, G, G, G, G, G, G], // rivers for the sibling city (0,0)
      [G, G, G, G, G, G, G, G],
      [G, G, G, R, G, R, G, G], // rivers for the wonder city (4,3)
      [G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G],
      [G, G, G, G, G, G, G, G],
    ]);
    engine.onStateChange = null;
    w = wrapWorld(engine);
    city = w.settle('WonderCity', 4, 3, 0, 3);
    sibling = w.settle('SiblingCity', 0, 0, 0, 3);
    rivalCity = w.settle('RivalCity', 7, 7, 1, 3);
    // Each city works its two river neighbours (trade 1 each) + centre.
    pinTiles(city, [[3, 3], [5, 3]]);
    pinTiles(sibling, [[0, 1], [1, 1]]);
    // Rival city: pin whatever it can work (grass only — no rivers nearby).
    rivalCity.userAssignedTiles = new Set(['1,7', '2,7']);
    rivalCity.workingTiles = new Set(['7,7', '1,7', '2,7']);
    engine.economicManager.recomputeCityYields(rivalCity);
  });

  afterEach(() => {
    engine.onStateChange = null;
    (engine as unknown as { units: unknown[] }).units = [];
    (engine as unknown as { cities: unknown[] }).cities = [];
    (engine as unknown as { civilizations: unknown[] }).civilizations = [];
  });

  it('fixture sanity: the pinned cities work three trade squares (centre + 2 rivers)', () => {
    engine.economicManager.recomputeCityYields(city);
    // Centre min trade 1 + two rivers à 1 = 3 (the CITY_CENTER_COMMERCE floor
    // of 2 sits below that, so every point is visible).
    expect(city.yields!.trade).toBe(3);
  });

  it('Colossus: +1 on every trade square of the wonder city only', () => {
    engine.economicManager.recomputeCityYields(city);
    engine.economicManager.recomputeCityYields(sibling);
    const base = { city: city.yields!.trade, sibling: sibling.yields!.trade };

    city.buildings = ['colossus'];
    engine.economicManager.recomputeCityYields(city);
    engine.economicManager.recomputeCityYields(sibling);

    // 3 trade squares × +1 → exactly three points above the base.
    expect(city.yields!.trade).toBe(base.city + 3);
    expect(sibling.yields!.trade).toBe(base.sibling); // city-scope: sibling unchanged
  });

  it('Statue of Liberty: +1 on every trade square in ALL cities of the owner', () => {
    engine.economicManager.recomputeCityYields(city);
    engine.economicManager.recomputeCityYields(sibling);
    engine.economicManager.recomputeCityYields(rivalCity);
    const base = { city: city.yields!.trade, sibling: sibling.yields!.trade, rival: rivalCity.yields!.trade };

    sibling.buildings = ['statue_of_liberty'];
    engine.economicManager.recomputeCityYields(city);
    engine.economicManager.recomputeCityYields(sibling);
    engine.economicManager.recomputeCityYields(rivalCity);

    expect(city.yields!.trade).toBe(base.city + 3);
    expect(sibling.yields!.trade).toBe(base.sibling + 3);
    expect(rivalCity.yields!.trade).toBe(base.rival); // rival cities untouched
  });
});
