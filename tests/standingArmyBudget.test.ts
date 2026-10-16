/**
 * The standing-army budget: one number the builder and the destroyer share.
 *
 * The measured failure this pins (seed 33, civ2, 320 rounds): 53 disbands in
 * four waves, 29 of them in ONE round at r220, all from the one civ whose tax
 * rate swung 54→80→35→69 and whose army had been built to 64 units against an
 * income that fit about half that. The mechanism was a feedback gap:
 *
 *   the builder (`isUnitCapExhausted`) priced only units ALIVE IN THE FIELD —
 *   three cities each saw the same headroom and each queued a rifleman;
 *
 *   the destroyer (`processTurn` when gold < 0) fired a cliff: looped until
 *   `totalUpkeep <= incomeAfterTax`, whatever that took — 29 units at once;
 *
 *   nothing connected them, so there was no state between "solvent, keep
 *   building" and "bankrupt, liquidate now".
 *
 * The concept:
 *   budget   = income(real rates) - buildings - cities - debtService
 *   commit   = unitUpkeep(field)  + queuedUnitUpkeep(queue)
 *   build    queue a maintenance-bearing unit only while commit + price <= budget
 *   drawdown while the treasury is still solvent and field > budget, retire
 *            ONE unit a round through the disbander's own protections — a
 *            slope, not a cliff. The emergency disbander stays for real
 *            deficits only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { EconomicManager } from '@/game/engine/EconomicManager';
import type { City, Civilization, Unit } from '../types/game';

const EM = EconomicManager as unknown as { DEBT_REPAYMENT_PER: number };

const makeCiv = (id: number, over: Partial<Civilization> = {}): Civilization => ({
  id,
  name: `Civ${id}`,
  isHuman: false,
  isAI: true,
  resources: { food: 0, production: 0, trade: 0, science: 0, gold: 200 },
  taxRate: 50,
  scienceRate: 50,
  luxuryRate: 0,
  government: 'monarchy',
  technologies: ['pottery', 'masonry', 'bronze_working'],
  ...over,
} as unknown as Civilization);

const makeCity = (id: string, civId: number, over: Partial<City> = {}): City => ({
  id,
  name: `City${id}`,
  civilizationId: civId,
  col: 10,
  row: 10,
  population: 4,
  buildings: [],
  buildQueue: [],
  currentProduction: null,
  tradeRoutes: [],
  yields: { food: 3, production: 3, trade: 6 },
  ...over,
} as unknown as City);

type EngineDouble = {
  cities: City[];
  units: Unit[];
  civilizations: Civilization[];
  economicManager?: unknown;
  getTileAt?: (col: number, row: number) => unknown;
};

/**
 * A small but structurally complete world: two cities on one civ, a real
 * EconomicManager over an engine double, and units placed so the budget
 * question has something to act on.
 */
const world = (opts: {
  gold?: number;
  debt?: number;
  units?: Array<{ type: string; maintenance: number; col?: number; row?: number }>;
  buildQueue?: Array<{ type: string; itemType: string }>;
  currentProduction?: { type: string; itemType: string } | null;
} = {}) => {
  const civ = makeCiv(1, {
    resources: { food: 0, production: 0, trade: 0, science: 0, gold: opts.gold ?? 200 },
    ...(opts.debt != null ? { debt: opts.debt } : {}),
  });
  const cities = [
    makeCity('a', 1, { currentProduction: opts.currentProduction ?? null }),
    makeCity('b', 1, { col: 12, buildQueue: opts.buildQueue ?? [] }),
  ];
  const units = (opts.units ?? []).map((u, i) => ({
    id: `u${i}`,
    type: u.type,
    civilizationId: 1,
    col: u.col ?? 10,
    row: u.row ?? 10,
    maintenance: u.maintenance,
    health: 100,
    attack: u.type === 'archer' || u.type === 'phalanx' ? 1 : u.type === 'cavalry' ? 3 : 0,
  })) as unknown as Unit[];

  const engine = {
    cities,
    units,
    civilizations: [null, civ] as unknown as Civilization[],
    getTileAt: () => ({ type: 'grassland' }),
    getFerryCargo: () => [],
    getPlayerStorage: () => ({ turnData: {} }),
    onStateChange: undefined as unknown as ((t: string, d?: unknown) => void),
  } as unknown as GameEngine;

  const em = new EconomicManager(engine);
  (engine as unknown as { economicManager: EconomicManager }).economicManager = em;
  return { engine, civ, cities, units, em };
};

describe('the build queue is priced into the army cap', () => {
  it('prices everything the queue will commit once its units arrive', () => {
    // Two queued riflemen at maintenance 1 each, plus an in-progress settler
    // that costs 0: a queued unit's upkeep begins when it lands, and three
    // cities reading the same headroom must not each spend it.
    const w = world({
      currentProduction: { type: 'unit', itemType: 'settler' },
      buildQueue: [
        { type: 'unit', itemType: 'phalanx' },
        { type: 'unit', valueType: undefined, itemType: 'archer' } as never,
      ],
    });
    expect(w.em.queuedUnitUpkeep(1)).toBe(2);
  });

  it('shrinks the headroom by exactly what was queued', () => {
    const plain = world({});
    const queued = world({ buildQueue: [{ type: 'unit', itemType: 'riflemen' }] });
    const plainHeadroom = plain.em.affordableUnitUpkeep(plain.civ);
    const queuedHeadroom = queued.em.affordableUnitUpkeep(queued.civ);
    // A riflemen costs 1 gold a turn in maintenance; queuing one is a credit
    // the treasury will owe the moment it arrives.
    expect(plainHeadroom - queuedHeadroom).toBe(1);
  });
});

describe('the standing-army budget', () => {
  it('is income minus buildings, cities and the debt the treasury already owes', () => {
    const base = world({ gold: 500 });
    const borrower = world({ gold: 500, debt: 300 });
    // Debt 300 earns a service of ceil(300/50) = 6 gold a turn. The budget
    // prices it, because the caps used to price a loan at ZERO: a civ paying
    // 6 of its income into repayment got an army cap as if the 6 were free.
    const expectDiff = base.em.armyBudgetFor(base.civ) - borrower.em.armyBudgetFor(borrower.civ);
    expect(expectDiff).toBe(6);
  });
});

describe('the drawdown — one unit a round, not the whole gap', () => {
  it('retires exactly ONE unit when the army costs more than its budget', () => {
    // A civ whose rates yield no tax at all (tax 0): its budget is 0 gold a
    // turn while four archers cost 4. The old law left both facts unseen until
    // the treasury itself went negative and then liquidated everything at
    // once; the concept retires one and comes back the next round.
    const w = world({
      gold: 50,
      units: Array.from({ length: 4 }, () => ({ type: 'archer', maintenance: 1 })),
    });
    for (const c of w.cities) { c.currentProduction = null; c.buildQueue = []; }
    w.civ.taxRate = 0;
    w.civ.scienceRate = 0;
    w.civ.luxuryRate = 0;

    const result = w.em.processTurn(w.civ);
    expect(result.retired).toBe(1);
    expect((w.engine.units as unknown[]).length).toBe(3);
  });

  it('honours the disbander protections: caravans, free units and sole defenders stand', () => {
    // A caravan in transit (0 upkeep, 50 shields), a settler (free), and a
    // sole city defender garrisoned on the city tile: none of them is ever
    // the reason the civ is overspent, so the one retirement per round must
    // fall on the priced unit that is NOT the city's last defender.
    const w = world({
      gold: 50,
      units: [
        { type: 'caravan', maintenance: 0 },
        { type: 'settler', maintenance: 0 },
        { type: 'phalanx', maintenance: 1, col: 10, row: 10 }, // garrison on city 'a'
        { type: 'archer', maintenance: 1, col: 6, row: 6 },    // surplus, priced
      ],
    });
    for (const c of w.cities) { c.currentProduction = null; c.buildQueue = []; }
    // Zero tax: a budget of 0 against two priced units (the surplus archer on
    // open ground and the phalanx garrisoned as the city's only defender).
    (w.civ as unknown as { taxRate: number }).taxRate = 0;
    (w.civ as unknown as { scienceRate: number }).scienceRate = 0;
    (w.civ as unknown as { luxuryRate: number }).luxuryRate = 0;

    const result = w.em.processTurn(w.civ);
    expect(result.retired).toBe(1);
    const remaining = (w.engine.units as unknown[]).map((u) => (u as { type: string }).type).sort();
    expect(remaining).toContain('caravan');
    expect(remaining).toContain('settler');
    expect(remaining).toContain('phalanx');
    expect(remaining).not.toContain('archer');
  });

  it('stays out of the way when the army fits its budget', () => {
    // Income above upkeep and the treasury solvent: nothing to retire, and
    // this is the invariant that matters most — a healthy civ must not lose
    // a single unit to budget housekeeping.
    const w = world({
      gold: 50,
      units: [{ type: 'phalanx', maintenance: 1 }],
    });
    for (const c of w.cities) { c.currentProduction = null; c.buildQueue = []; }
    const result = w.em.processTurn(w.civ);
    expect(result.retired).toBe(0);
    expect((w.engine.units as unknown[]).length).toBe(1);
  });

  it('does not run while the treasury is in deficit — the disbander owns that turn', () => {
    // A negative treasury is the emergency path; the drawdown must not add an
    // extra unit disposal on top of the disbander's protocol.
    const w = world({
      gold: -30,
      units: Array.from({ length: 3 }, () => ({ type: 'archer', maintenance: 1 })),
    });
    for (const c of w.cities) { c.currentProduction = null; c.buildQueue = []; }
    const result = w.em.processTurn(w.civ);
    expect(result.retired).toBe(0);
  });
});
