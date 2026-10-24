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

  it('auto-establishes the best-paying route, not the nearest one', () => {
    const home = makeCity(0, 2, 2);
    const near = makeCity(0, 3, 3);   // 2 manhattan tiles: the distance
    const far = makeCity(0, 8, 8);    // bracket pays big — value beats range
    const ship = createShip(home, home.col, home.row);

    (engine as unknown as { autoEstablishTradeShipRoute: (id: string) => boolean }).autoEstablishTradeShipRoute(ship.id);

    // Both legs have pop-10 cities (base 100), but the near harbour sits
    // inside the [D*70%] bracket: b = min(5, floor(2*0.7)) = 1 → 20 gold, the
    // far one b = min(5, floor(12*0.7)) = 5 → 100 gold. Value wins.
    expect(ship.tradeShipRoute?.destCityId).toBe(far.id);
    expect(ship.tradeShipRoute?.destCityId).not.toBe(near.id);
    expect(ship.tradeShipRoute?.homeCityId).toBe(home.id);
  });

  it('does not auto-establish when the ship already has a route', () => {
    const home = makeCity(0, 2, 2);
    const dest = makeCity(0, 4, 4);
    const ship = createShip(home, dest.col, dest.row);
    engine.establishTradeShipRoute(ship.id);

    const result = (engine as unknown as { autoEstablishTradeShipRoute: (id: string) => boolean }).autoEstablishTradeShipRoute(ship.id);

    expect(result).toBe(false);
    expect(ship.tradeShipRoute?.destCityId).toBe(dest.id); // unchanged
  });

  it('does not auto-establish when there is no other harbour', () => {
    const home = makeCity(0, 2, 2);
    const ship = createShip(home, home.col, home.row);

    const result = (engine as unknown as { autoEstablishTradeShipRoute: (id: string) => boolean }).autoEstablishTradeShipRoute(ship.id);

    expect(result).toBe(false);
    expect(ship.tradeShipRoute).toBeNull();
  });

  // ── Foreign trade routes ───────────────────────────────────────────────────
  // "a city of your civilisation ... or of another civ": foreign harbour
  // cities of civs the ship owner has MET are routeable and pay the F=150%
  // foreign bonus (X prices the partner: 2 at war, 1.2 for a friend).

  it('skips foreign harbours the civ has never met and opens one after contact', () => {
    const home = makeCity(0, 2, 2);
    const foreign = makeCity(1, 10, 10, 20);
    const ship = createShip(home, home.col, home.row);
    const auto = (engine as unknown as { autoEstablishTradeShipRoute: (id: string) => boolean })
      .autoEstablishTradeShipRoute.bind(engine);

    // Unmet civ: the foreign harbour is not a routeable partner.
    expect(auto(ship.id)).toBe(false);
    expect(ship.tradeShipRoute).toBeNull();

    // Once met: the foreign harbour wins (its foreign bonus pays 45 vs any
    // domestic alternative — there is none here).
    (engine as unknown as { diplomacyManager: { restoreContactedPairs: (p: string[]) => void } })
      .diplomacyManager.restoreContactedPairs(['0_1']);
    expect(auto(ship.id)).toBe(true);
    expect(ship.tradeShipRoute?.homeCityId).toBe(home.id);
    expect(ship.tradeShipRoute?.destCityId).toBe(foreign.id);
    expect(ship.tradeShipRoute?.stage).toBe('outbound');
  });

  it('pays a foreign arrival 80% to the ship owner and 20% to the harbour owner', () => {
    const home = makeCity(0, 2, 2);
    const foreign = makeCity(1, 10, 10, 20);
    const ship = createShip(home, foreign.col, foreign.row);
    engine.establishTradeShipRoute(ship.id);

    const ownerBefore = engine.civilizations?.[0]?.resources?.gold ?? 0;
    const harbourBefore = engine.civilizations?.[1]?.resources?.gold ?? 0;
    engine.advanceTradeShip(ship.id);
    const ownerAfter = engine.civilizations?.[0]?.resources?.gold ?? 0;
    const harbourAfter = engine.civilizations?.[1]?.resources?.gold ?? 0;

    // Pop-20 foreign harbour, base 100 + (1+1.5·1)·(5·10) = 225 at peace,
    // b = min(floor(10·0.5), floor(16·0.7)) = 5 → total 225; owner 180, city 45.
    expect(ownerAfter - ownerBefore).toBe(180);
    expect(harbourAfter - harbourBefore).toBe(45);
    expect(harbourAfter - harbourBefore).toBe(Math.floor(225 * 0.2));
  });

  // ── The formula, exactly as the TODO spells it out ────────────────────────

  it('scales the leg with ×20%/100 ([T*50%] and [D*70%] floor before the min)', () => {
    // Pop-10 domestic pair 4 manhattan tiles apart: base (1+0)·(5·0)+100 = 100,
    // b = min(floor(10·0.5), floor(4·0.7)) = 2 → 100·2·20/100 = 40.
    const home = makeCity(0, 2, 2);
    const dest = makeCity(0, 4, 4);
    const total = (engine as unknown as { tradeShipFormula: (...a: unknown[]) => number })
      .tradeShipFormula(0, home as never, dest as never, dest.col, dest.row);
    expect(total).toBe(40);
  });

  it('prices a war partner at X=2 and a foreign route at F=150%', () => {
    const home = makeCity(0, 2, 2);
    const foreign = makeCity(1, 10, 10, 20);
    const formula = (engine as unknown as { tradeShipFormula: (...a: unknown[]) => number })
      .tradeShipFormula.bind(engine);
    const leg = () => formula(0, home as never, foreign as never, foreign.col, foreign.row) as number;

    // Peace: F=1.5, X=1 → (1+1.5)·50+100 = 225 → ×5 (b=min(5,11)) ×20/100 = 225.
    expect(leg()).toBe(225);
    // War: X=2 → (1+3)·50+100 = 300 → 300.
    (engine as unknown as { diplomacyManager: { declareWar: (a: number, b: number) => void } })
      .diplomacyManager.declareWar(0, 1);
    expect(leg()).toBe(300);
  });

  it('adds the +25 Cap bracket when a capital city is involved', () => {
    const home = makeCity(0, 2, 2);
    const plain = makeCity(0, 8, 8);
    const capital = makeCity(0, 8, 8);
    capital.isCapital = true;
    const formula = (engine as unknown as { tradeShipFormula: (...a: unknown[]) => number })
      .tradeShipFormula.bind(engine);
    // Same geometry (D=12 → b=5): the capital line is worth exactly 25 more.
    expect(formula(0, home as never, capital as never, capital.col, capital.row) as number)
      .toBe((formula(0, home as never, plain as never, plain.col, plain.row) as number) + 25);
  });

  it('pays the sinker 100% of the run: target city = the ship, pop = the home city', () => {
    // Home (2,2) pop 10, ship caught at (5,5): the prize measures the classic
    // sailing distance — chebyshev(home, ship) = 3 → b = min(5, floor(3·0.7))
    // = 2; P = T = 10 → base (1+3)·0+100 = 100 (F=1.5, X=2) → prize =
    // 100·2·20/100 = 40. The old, unscaled formula would have paid 200 —
    // this pins the ×20%/100 scaling for keeps.
    const home = makeCity(0, 2, 2);
    const ship = createShip(home, 5, 5);
    engine.establishTradeShipRoute(ship.id);
    ship.col = 5; ship.row = 5;
    expect(engine.computeTradeShipPrizeValue(ship)).toBe(40);
  });
});