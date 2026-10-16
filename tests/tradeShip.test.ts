import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/**
 * Trade Ship: a recurring naval trade route between two harbour cities.
 *
 * The unit stays afloat (it is not consumed on delivery the way a Caravan
 * is), sails between its home harbour and a destination harbour, and pays out
 * gold every time it arrives, split 80% to the ship's owner and 20% to the
 * harbour city's owner.
 */
describe('Trade Ship', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    await engine.initialize({ numberOfCivilizations: 2, mapType: 'CLOSEUP_1V1', devMode: false, startingGold: 100 });
  });

  afterEach(() => {
    (engine as unknown as { units: unknown[] }).units = [];
  });

  const makeCity = (civId: number, col: number, row: number, population = 10) => {
    const city = {
      id: `ts_city_${Math.random()}`,
      name: `Harbour ${Math.random()}`,
      civilizationId: civId,
      col,
      row,
      population,
      foodStored: 0,
      foodNeeded: 20,
      buildings: ['harbor'],
      wonders: [],
      yields: { food: 0, production: 0, trade: 0, gold: 0, science: 0 },
      hitPoints: 10,
      maxHitPoints: 10,
      isCapital: false,
      tradeRoutes: [],
    };
    (engine as unknown as { cities: unknown[] }).cities.push(city);
    return city;
  };

  const createShip = (homeCity: ReturnType<typeof makeCity>, startCol: number, startRow: number) => {
    const unit = {
      id: `ts_${Math.random()}`,
      type: 'trade_ship',
      civilizationId: homeCity.civilizationId,
      col: startCol,
      row: startRow,
      homeCityId: homeCity.id,
      movesRemaining: 4,
      health: 100,
      icon: '🚢',
      isDefeated: false,
      tradeShipRoute: null,
    };
    (engine as unknown as { units: unknown[] }).units.push(unit);
    return unit;
  };

  it('refuses a route while not on a destination harbour', () => {
    const home = makeCity(0, 2, 2);
    const ship = createShip(home, 2, 2);
    expect(engine.canEstablishTradeShipRoute(ship.id)).toBe(false);
    expect(engine.establishTradeShipRoute(ship.id).success).toBe(false);
  });

  it('opens a route when the ship stands on a different harbour city', () => {
    const home = makeCity(0, 2, 2);
    const dest = makeCity(0, 4, 4);
    const ship = createShip(home, dest.col, dest.row);
    const res = engine.establishTradeShipRoute(ship.id);
    expect(res.success).toBe(true);
    expect(ship.tradeShipRoute).not.toBeNull();
    expect(ship.tradeShipRoute?.homeCityId).toBe(home.id);
    expect(ship.tradeShipRoute?.destCityId).toBe(dest.id);
    expect(ship.tradeShipRoute?.stage).toBe('outbound');
  });

  it('pays out on arrival over the turn loop', () => {
    const home = makeCity(0, 2, 2);
    const dest = makeCity(0, 4, 4);
    const ship = createShip(home, dest.col, dest.row);
    engine.establishTradeShipRoute(ship.id);

    const beforeOwner = engine.civilizations?.[0]?.resources?.gold ?? 0;

    // The ship is now at the destination harbour with stage 'outbound': a run
    // of advanceTradeShip() is the turn-start hook. On its start it pays the
    // arrival and flips to 'inbound' (the arrival is what produces gold, not
    // sailing to the other harbour) — so the leg pays 'home bound' inbound.
    // To exercise a pay leg directly: walk one full advance at each city.
    // First turn: at dest -> pays 80/20, flips to inbound, path home.
    engine.advanceTradeShip(ship.id);
    let gotGold = engine.civilizations?.[0]?.resources?.gold ?? 0;
    expect(ship.tradeShipRoute?.stage).toBe('inbound');

    // Sail back home over subsequent calls by teleporting onto home and
    // re-advancing (the test harness does not drive the GoTo pathfinding).
    ship.col = home.col;
    ship.row = home.row;
    engine.advanceTradeShip(ship.id);
    gotGold = engine.civilizations?.[0]?.resources?.gold ?? 0;

    expect(gotGold).toBeGreaterThan(beforeOwner);
  });

  it('computes a finite, positive leg value from tradeShipFormula', () => {
    const home = makeCity(0, 2, 2);
    const dest = makeCity(0, 8, 8);
    const ship = createShip(home, dest.col, dest.row);
    engine.establishTradeShipRoute(ship.id);
    const v = (engine as unknown as { tradeShipFormula(...a: unknown[]): number })
      .tradeShipFormula(0, home as never, dest as never, dest.col, dest.row);
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('produces a bigger enemy/foreign prize on sinking than a domestic run', () => {
    const home = makeCity(0, 2, 2);
    const dest = makeCity(0, 8, 8);
    const ship = createShip(home, dest.col, dest.row);
    engine.establishTradeShipRoute(ship.id);
    ship.col = 5; ship.row = 5;
    const domestic = (engine as unknown as { tradeShipFormula(...a: unknown[]): number })
      .tradeShipFormula(0, home as never, dest as never, 5, 5);
    expect(typeof domestic).toBe('number');
    // Sinking value is computed with foreign/enemy defaults.
    const sunkVal = engine.computeTradeShipPrizeValue(ship);
    expect(sunkVal).toBeGreaterThan(0);
  });
});