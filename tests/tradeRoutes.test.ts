import { describe, it, expect, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { MAX_TRADE_ROUTES } from '@/game/engine/GameEngine';
import { EconomicManager } from '@/game/engine/EconomicManager';

/**
 * Civ1 Trade Routes: a Caravan (Trade tech) delivers to a city — lump-sum
 * Gold + Science scaled by population & distance (foreign ×2, intercontinental
 * ×2), and a permanent per-turn trade route between both cities (max 3,
 * weakest replaced).
 */
describe('Civ1 trade routes', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as any).units = [];
      (engine as any).cities = [];
      (engine as any).civilizations = [];
      engine = null;
    }
  });

  async function setup(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as any).sleep = () => Promise.resolve();
    (e as any).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  function addCity(e: GameEngine, id: string, civ: number, name: string, col: number, row: number, population = 3): any {
    const city = {
      id, name, civilizationId: civ, col, row, population,
      production: 0, food: 0, gold: 0, science: 0,
      buildings: [], buildQueue: [], currentProduction: null, tradeRoutes: [],
    };
    (e as any).cities.push(city);
    return city;
  }

  function addCaravan(e: GameEngine, id: string, civ: number, col: number, row: number, homeCityId: string): any {
    const unit = {
      id, type: 'caravan', civilizationId: civ, col, row,
      movesRemaining: 1, maxMoves: 1, health: 100, homeCityId,
      attack: 0, defense: 0, isDefeated: false,
    };
    (e as any).units.push(unit);
    return unit;
  }

  /** First N real land tiles (cities must sit on passable land). */
  function findLandTiles(e: GameEngine, count: number): Array<{ col: number; row: number }> {
    const map = (e as any).map;
    const result: Array<{ col: number; row: number }> = [];
    for (let row = 0; row < map.height && result.length < count; row++) {
      for (let col = 0; col < map.width && result.length < count; col++) {
        const t = e.getTileAt(col, row);
        if (t && !(e as any).isWaterTerrain(t) && !(e as any).getCityAt(col, row)) {
          result.push({ col, row });
        }
      }
    }
    return result;
  }

  it('canEstablishTradeRoute: only a caravan on a different city', async () => {
    const e = await setup();
    addCity(e, 'c0', 0, 'Home', 5, 5);
    addCity(e, 'c1', 1, 'Dest', 15, 5);
    const caravan = addCaravan(e, 'car1', 0, 15, 5, 'c0');

    expect(e.canEstablishTradeRoute(caravan.id)).toBe(true);

    // On its own home city → no route.
    caravan.col = 5; caravan.row = 5;
    expect(e.canEstablishTradeRoute(caravan.id)).toBe(false);

    // Not on a city tile → no route.
    caravan.col = 10; caravan.row = 5;
    expect(e.canEstablishTradeRoute(caravan.id)).toBe(false);

    // Not a caravan → no route.
    expect(e.canEstablishTradeRoute('missing')).toBe(false);
  });

  it('delivers: lump-sum gold + science, both cities get routes, caravan consumed', async () => {
    const e = await setup();
    const home = addCity(e, 'c0', 0, 'Home', 5, 5);
    const dest = addCity(e, 'c1', 1, 'Dest', 15, 5);
    const caravan = addCaravan(e, 'car1', 0, 15, 5, 'c0');
    const civ = e.civilizations[0];
    const goldBefore = civ.resources.gold;
    const scienceBefore = civ.resources.science;

    const result = e.establishTradeRoute(caravan.id);
    expect(result.success).toBe(true);
    expect((result.gold ?? 0)).toBeGreaterThan(0);
    expect(civ.resources.gold).toBe(goldBefore + result.gold!);
    expect(civ.resources.science).toBe(scienceBefore + result.science!);
    expect(e.units.some(u => u.id === 'car1')).toBe(false); // consumed
    expect(home.tradeRoutes.length).toBe(1);
    expect(dest.tradeRoutes.length).toBe(1);
    expect(home.tradeRoutes[0].cityId).toBe('c1');
    expect(dest.tradeRoutes[0].cityId).toBe('c0');
  });

  it('a foreign destination pays a higher lump sum than a domestic one', async () => {
    const e = await setup();
    // Carve the corridors to land: a randomly generated ocean tile on the
    // domestic line would grant it the intercontinental ×2 bonus and flip the
    // comparison (map-randomness flake).
    const carve = (fromCol: number, row: number, toCol: number): void => {
      for (let col = Math.min(fromCol, toCol); col <= Math.max(fromCol, toCol); col++) {
        for (let r = row - 1; r <= row + 1; r++) {
          const tile = e.getTileAt(col, r) as unknown as { type: string; terrain?: string } | null;
          if (!tile) continue;
          tile.type = 'grassland';
          tile.terrain = 'grassland';
        }
      }
    };
    carve(5, 5, 15);
    carve(5, 10, 15);

    // Domestic route (both civ 0).
    addCity(e, 'a0', 0, 'A', 5, 5);
    addCity(e, 'a1', 0, 'A1', 15, 5);
    const carA = addCaravan(e, 'carA', 0, 15, 5, 'a0');
    const rA = e.establishTradeRoute(carA.id);

    // Foreign route (dest civ 1), same population & distance.
    addCity(e, 'b0', 0, 'B', 5, 10);
    addCity(e, 'b1', 1, 'B1', 15, 10);
    const carB = addCaravan(e, 'carB', 0, 15, 10, 'b0');
    const rB = e.establishTradeRoute(carB.id);

    expect(rA.success).toBe(true);
    expect(rB.success).toBe(true);
    expect(rB.gold!).toBeGreaterThan(rA.gold!);
  });

  it('caps a city at MAX_TRADE_ROUTES routes', async () => {
    const e = await setup();
    const home = addCity(e, 'c0', 0, 'Home', 5, 5);
    for (let i = 1; i <= 5; i++) {
      addCity(e, `d${i}`, 1, `Dest${i}`, 10 + i, 5, 1 + i);
      const car = addCaravan(e, `car${i}`, 0, 10 + i, 5, 'c0');
      e.establishTradeRoute(car.id);
    }
    expect(home.tradeRoutes.length).toBe(MAX_TRADE_ROUTES);
  });

  it('routeTrade adds per-turn trade to the city commerce', async () => {
    const e = await setup();
    const home = addCity(e, 'c0', 0, 'Home', 5, 5, 2);
    addCity(e, 'c1', 1, 'Dest', 15, 5, 4);
    addCaravan(e, 'car1', 0, 15, 5, 'c0');
    e.establishTradeRoute('car1');

    const econ = new EconomicManager(e);
    expect(econ.routeTrade(home)).toBeGreaterThan(0);
    // cityCommerce = max(yields.trade, 2) + routeTrade
    expect(econ.cityCommerce(home)).toBeGreaterThanOrEqual(econ.routeTrade(home) + 2);
  });

  it('a caravan moving onto an enemy city tile delivers automatically', async () => {
    const e = await setup();
    const [homePos, destPos] = findLandTiles(e, 2);
    addCity(e, 'c0', 0, 'Home', homePos.col, homePos.row);
    const dest = addCity(e, 'c1', 1, 'Dest', destPos.col, destPos.row);
    const car = addCaravan(e, 'car1', 0, homePos.col, homePos.row, 'c0');
    car.movesRemaining = 2;

    const move = e.moveUnit(car.id, dest.col, dest.row);
    // The caravan should have been allowed to enter the city and delivered.
    expect(e.units.some(u => u.id === 'car1')).toBe(false);
    expect(dest.tradeRoutes.length).toBe(1);
    expect(move.success).toBe(true);
  });
});
