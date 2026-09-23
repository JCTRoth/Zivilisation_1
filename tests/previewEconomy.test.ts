import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import type { City, Civilization } from '../types/game';

/**
 * Verify that EconomicManager.previewEconomy() returns correct projected
 * per-turn numbers (Commerce, Tax, Science, Luxury, Upkeep, Net) for the
 * Rates modal. Each test sets up a minimal civ + city with fully controlled
 * yields so the math can be checked by hand.
 *
 * Key constants:
 *   TRADE_GOLD_MULTIPLIER = 2   (tax = floor(commerce × rate%) × 2)
 *   CITY_CENTER_COMMERCE   = 2   (floor on trade yield)
 *   BASE_CONTENTMENT       = 2
 *   Despotism tolerance    = 2   (citizens beyond pop 2 are unhappy)
 *   Despotism martial law  = 4   (garrison units suppress unrest)
 */

describe('previewEconomy — projected per-turn numbers', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
    // Clear all pre-existing cities and units so we have full control.
    (engine as any).cities = [];
    (engine as any).units = [];
  });

  afterEach(() => {
    (engine as any).units = [];
    (engine as any).cities = [];
    (engine as any).civilizations = [];
  });

  /**
   * Create a synthetic city under civ 0 at a fixed position.
   * No real map tiles are involved — yields are set directly.
   */
  const makeCity = (
    tradeYield: number,
    population = 1,
    overrides: Partial<City> = {},
  ): City => {
    const city: City = {
      id: `test_city_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      civilizationId: 0,
      name: 'TestCity',
      col: 40,
      row: 25,
      population,
      yields: { food: 2, production: 1, trade: tradeYield },
      buildings: [],
      specialists: [],
      tradeRoutes: [],
      isCapital: false,
      ...overrides,
    } as City;
    (engine as any).cities.push(city);
    return city;
  };

  const civ = (): Civilization => engine.civilizations[0];
  const econ = () => engine.economicManager!;

  /** Set the first city of civ 0 as capital (corruption = 0). */
  const setCapital = (city: City): void => {
    const c = civ();
    c.capital = city;
    city.isCapital = true;
  };

  // ---------------------------------------------------------------
  // 1. Basic tax calculation
  // ---------------------------------------------------------------
  describe('tax', () => {
    it('Commerce: 5, Tax 100% → tax = 5 × 2 = 10', () => {
      const city = makeCity(5);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.commerce).toBe(5);
      expect(preview.tax).toBe(10); // floor(5 × 1.0) × 2
    });

    it('Commerce: 3, Tax 100% → tax = 3 × 2 = 6', () => {
      const city = makeCity(3);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.commerce).toBe(3);
      expect(preview.tax).toBe(6);
    });

    it('Trade yield below CITY_CENTER_COMMERCE (2) is floored up', () => {
      const city = makeCity(0); // trade=0 → cityCommerce = max(0,2) = 2
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.commerce).toBe(2);
      expect(preview.tax).toBe(4); // floor(2 × 1.0) × 2
    });
  });

  // ---------------------------------------------------------------
  // 2. Rate splits
  // ---------------------------------------------------------------
  describe('rate splits', () => {
    it('Commerce: 10, 50% tax / 50% science → tax=10, science=5', () => {
      const city = makeCity(10);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 50, science: 50, luxury: 0 });
      // tax = floor(10 × 0.5) × 2 = 5 × 2 = 10
      // science = round(10 × 0.5) = 5
      expect(preview.tax).toBe(10);
      expect(preview.science).toBe(5);
      expect(preview.luxury).toBe(0);
    });

    it('Commerce: 7, 100% tax → tax=14, science=0, luxury=0', () => {
      const city = makeCity(7);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.tax).toBe(14); // floor(7 × 1.0) × 2
      expect(preview.science).toBe(0);
      expect(preview.luxury).toBe(0);
    });

    it('Commerce: 6, 33/33/34 split → floors applied per-field', () => {
      const city = makeCity(6);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 33, science: 33, luxury: 34 });
      // tax  = floor(6 × 0.33) × 2 = floor(1.98) × 2 = 1 × 2 = 2
      // sci  = round(6 × 0.33) = round(1.98) = 2
      // lux  = floor(6 × 0.34) = floor(2.04) = 2
      expect(preview.tax).toBe(2);
      expect(preview.science).toBe(2);
      expect(preview.luxury).toBe(2);
    });

    it('Commerce: 9, 100% luxury → luxury=9, tax=0', () => {
      const city = makeCity(9);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 0, science: 0, luxury: 100 });
      expect(preview.tax).toBe(0);
      expect(preview.luxury).toBe(9);
    });
  });

  // ---------------------------------------------------------------
  // 3. Disorder — the critical bug fix
  // ---------------------------------------------------------------
  describe('disorder zeros out tax/science/luxury', () => {
    it('pop 5, 0% luxury, despotism → disorder → tax=0', () => {
      const city = makeCity(10, 5);
      setCapital(city);
      // Despotism tolerance=2, unhappiness = max(0, 5-2) = 3
      // happiness = 0 (luxury) + 0 (spec) + 0 (martial) + 0 (building) + 0 (gov) + 2 (base) = 2
      // 3 > 2 → disorder
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.commerce).toBe(10); // commerce still counted
      expect(preview.tax).toBe(0);      // but tax is zeroed
      expect(preview.science).toBe(0);
      expect(preview.luxury).toBe(0);
      expect(preview.net).toBe(0);
    });

    it('pop 3, 0% luxury, no garrison → not in disorder (1 < 2)', () => {
      const city = makeCity(10, 3);
      setCapital(city);
      // unhappiness = max(0, 3-2) = 1
      // happiness = 0 + 0 + 0 + 0 + 0 + 2 = 2
      // 1 > 2 → false → NOT in disorder
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.tax).toBe(20); // 10 × 2 = 20
    });

    it('pop 5, 50% luxury → luxury prevents disorder', () => {
      const city = makeCity(10, 5);
      setCapital(city);
      // unhappiness = max(0, 5-2) = 3
      // cityLuxury = floor(10 × 0.5) = 5
      // happiness = 5 + 0 + 0 + 0 + 0 + 2 = 7
      // 3 > 7 → false → NOT in disorder
      const preview = econ().previewEconomy(civ(), { tax: 50, science: 0, luxury: 50 });
      expect(preview.tax).toBe(10); // floor(10 × 0.5) × 2 = 10
      expect(preview.luxury).toBe(5);
    });

    it('pop 5, garrison of 3 units → martial law prevents disorder', () => {
      const city = makeCity(10, 5);
      setCapital(city);
      // Place 3 attacking units on the city tile for martial law
      for (let i = 0; i < 3; i++) {
        (engine.units as any[]).push({
          id: `warrior_${i}`,
          type: 'warrior',
          civilizationId: 0,
          col: city.col,
          row: city.row,
          isDefeated: false,
          attack: 1,
          defense: 1,
          health: 100,
        });
      }
      // unhappiness = 3
      // martialLawBonus = min(3, 4) = 3
      // happiness = 0 + 0 + 3 + 0 + 0 + 2 = 5
      // 3 > 5 → false → NOT in disorder
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.tax).toBe(20);
    });
  });

  // ---------------------------------------------------------------
  // 4. Upkeep
  // ---------------------------------------------------------------
  describe('upkeep', () => {
    it('no units, no buildings → upkeep = 0', () => {
      const city = makeCity(5);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.upkeep).toBe(0);
    });

    it('units with maintenance add to upkeep', () => {
      const city = makeCity(10);
      setCapital(city);
      // Add 3 warriors (each costs UNIT_MAINTENANCE = 1 if they have a home city)
      for (let i = 0; i < 3; i++) {
        (engine.units as any[]).push({
          id: `w${i}`,
          type: 'warrior',
          civilizationId: 0,
          col: city.col,
          row: city.row,
          isDefeated: false,
          attack: 1,
          defense: 1,
          health: 100,
          homeCityId: city.id,
          maintenance: 1,
        });
      }
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.upkeep).toBe(3);
      // net = tax − upkeep = 20 − 3 = 17
      expect(preview.net).toBe(17);
    });

    it('NONE units (homeCityId=null) are free', () => {
      const city = makeCity(10);
      setCapital(city);
      (engine.units as any[]).push({
        id: 'none_unit',
        type: 'warrior',
        civilizationId: 0,
        col: city.col,
        row: city.row,
        isDefeated: false,
        attack: 1,
        defense: 1,
        health: 100,
        homeCityId: null, // NONE unit
        isNoneUnit: true,
        maintenance: 1,
      });
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.upkeep).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // 5. Net calculation
  // ---------------------------------------------------------------
  describe('net = tax − upkeep', () => {
    it('tax=20, upkeep=3 → net=17', () => {
      const city = makeCity(10);
      setCapital(city);
      for (let i = 0; i < 3; i++) {
        (engine.units as any[]).push({
          id: `u${i}`,
          type: 'warrior',
          civilizationId: 0,
          col: city.col,
          row: city.row,
          isDefeated: false,
          attack: 1,
          defense: 1,
          health: 100,
          homeCityId: city.id,
          maintenance: 1,
        });
      }
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.net).toBe(preview.tax - preview.upkeep);
      expect(preview.net).toBe(17);
    });

    it('disorder + upkeep → net is negative', () => {
      const city = makeCity(10, 5);
      setCapital(city);
      // Place the unit AWAY from the city so it counts for upkeep
      // but NOT as a garrison (martial law requires col/row match).
      (engine.units as any[]).push({
        id: 'u0',
        type: 'warrior',
        civilizationId: 0,
        col: city.col + 10,
        row: city.row + 10,
        isDefeated: false,
        attack: 1,
        defense: 1,
        health: 100,
        homeCityId: city.id,
        maintenance: 2,
      });
      // pop 5, no luxury → unhappiness = 3, happiness = 0+0+0+0+0+2 = 2 → disorder
      // upkeep=2 → net = 0 − 2 = −2
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.tax).toBe(0);
      expect(preview.net).toBe(-2);
    });
  });

  // ---------------------------------------------------------------
  // 6. Multi-city totals
  // ---------------------------------------------------------------
  describe('multi-city', () => {
    it('two cities contribute additively (no corruption when no capital)', () => {
      makeCity(5); // city1: commerce 5
      makeCity(8); // city2: commerce 8
      // Null the capital so corruption = 0 for both (no capital = no corruption)
      civ().capital = null;

      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      // city1: afterCorruption = floor(5 × 1 - 0) = 5
      // city2: afterCorruption = floor(8 × 1 - 0) = 8
      // commerce = 5 + 8 = 13
      // tax = (5×2) + (8×2) = 10 + 16 = 26
      expect(preview.commerce).toBe(13);
      expect(preview.tax).toBe(26);
    });
  });

  // ---------------------------------------------------------------
  // 7. Edge cases
  // ---------------------------------------------------------------
  describe('edge cases', () => {
    it('no cities → all zeros', () => {
      // No cities pushed — engine.cities is empty
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      expect(preview.commerce).toBe(0);
      expect(preview.tax).toBe(0);
      expect(preview.hasCities).toBe(false);
    });

    it('all rates 0 → everything is 0 (anarchy-style)', () => {
      const city = makeCity(10);
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 0, science: 0, luxury: 0 });
      expect(preview.tax).toBe(0);
      expect(preview.science).toBe(0);
      expect(preview.luxury).toBe(0);
    });

    it('scienceBonus from buildings is added even at 0% science rate', () => {
      const city = makeCity(10, 1, { scienceBonus: 3 });
      setCapital(city);
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      // tax = floor(10 × 1.0) × 2 = 20
      // science = round(10 × 0) + 3 = 3 (scienceBonus still counts)
      expect(preview.tax).toBe(20);
      expect(preview.science).toBe(3);
    });
  });

  // ---------------------------------------------------------------
  // 8. Government effects
  // ---------------------------------------------------------------
  describe('government effects', () => {
    it('communism: 25% commerce penalty reduces effective commerce', () => {
      const city = makeCity(20);
      setCapital(city);
      // Set government to communism (commercePenalty=0.25, corruptionRate=0.1)
      civ().government = 'communism';
      const preview = econ().previewEconomy(civ(), { tax: 100, science: 0, luxury: 0 });
      // effective = 20 × (1 - 0.25) = 15
      // afterCorruption = floor(15) = 15 (capital, no corruption)
      // tax = floor(15 × 1.0) × 2 = 30
      expect(preview.commerce).toBe(15);
      expect(preview.tax).toBe(30);
      // Reset government
      civ().government = 'despotism';
    });
  });
});
