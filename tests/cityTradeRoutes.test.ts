import { describe, expect, it } from 'vitest';
import { CityUtils } from '@shared/utils/CityUtils';
import { CityModalLogic } from '@/components/ui/gamemodals/CityModalLogic';
import type { City, Civilization, TradeRoute } from '@shared/types/game';

/**
 * The city menu shows the city's permanent trade routes and the per-turn trade
 * they contribute (cityCommerce = tile trade + route trade). These tests pin
 * down (a) the resource math including route income and (b) the modal's route
 * accessors.
 */

const route1: TradeRoute = { cityId: 'dest1', cityName: 'Rome', civilizationId: 1, trade: 2, distance: 5, round: 12 };
const route2: TradeRoute = { cityId: 'dest2', cityName: 'London', civilizationId: 2, trade: 3, distance: 8, round: 20 };

const buildCity = (): City => ({
  id: 'home',
  name: 'Berlin',
  civilizationId: 0,
  col: 10,
  row: 10,
  population: 4,
  yields: { food: 8, production: 5, trade: 4 },
  tradeRoutes: [route1, route2],
  buildings: [],
  buildQueue: [],
  currentProduction: null,
  foodStored: 20,
}) as unknown as City;

const buildCiv = (): Civilization =>
  ({ id: 0, name: 'Germans', taxRate: 50, scienceRate: 50, luxuryRate: 0 }) as unknown as Civilization;

describe('CityUtils.calculateCityResources — trade routes included', () => {
  it('adds per-turn route trade on top of the tile trade', () => {
    const city = buildCity();
    const civ = buildCiv();
    const resources = CityUtils.calculateCityResources(city, civ);

    // Tile trade 4 + Rome 2 + London 3 = 9.
    expect(resources.trade.total).toBe(9);
    expect(resources.trade.routeTrade).toBe(5);
    // No capital set → no corruption, so after-corruption equals total.
    expect(resources.trade.afterCorruption).toBe(9);
  });

  it('reports zero route trade when the city has no routes', () => {
    const city = buildCity();
    city.tradeRoutes = [];
    const civ = buildCiv();
    const resources = CityUtils.calculateCityResources(city, civ);
    expect(resources.trade.total).toBe(4);
    expect(resources.trade.routeTrade).toBe(0);
  });
});

describe('CityModalLogic — trade route accessors', () => {
  it('exposes the city trade routes and the summed per-turn trade', () => {
    const logic = new CityModalLogic(buildCity(), {} as never, {} as never, buildCiv());
    expect(logic.getTradeRoutes()).toHaveLength(2);
    expect(logic.getTradeRoutes()[0].cityName).toBe('Rome');
    expect(logic.getRouteTrade()).toBe(5);
  });

  it('returns an empty list / zero when there are no routes', () => {
    const city = buildCity();
    city.tradeRoutes = [];
    const logic = new CityModalLogic(city, {} as never, {} as never, buildCiv());
    expect(logic.getTradeRoutes()).toEqual([]);
    expect(logic.getRouteTrade()).toBe(0);
  });
});
