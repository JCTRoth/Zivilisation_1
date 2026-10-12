/**
 * AI arithmetic — regression tests for the equations that were computing the
 * wrong thing.
 *
 * Each of these failed before its fix, and each names the number the AI now has
 * to agree with the engine on. They exist because every bug here was a
 * *calculation* bug: individually reasonable rules composed through arithmetic
 * that mixed units (shields with gold, a per-turn rate with a lump sum) or read
 * a stale figure (the 100 %-tax income, the raw tech-table cost). The AI's
 * behaviour looked competent while its books were wrong.
 */
import { describe, it, expect, vi } from 'vitest';
import { AIEconomicManager } from '@/game/engine/AI/AIEconomicManager';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { AIManager } from '@/game/engine/AI/AIManager';
import { AICoordinator } from '@/game/engine/AI/AICoordinator';
import { AIResearch } from '@/game/engine/AI/AIResearch';
import { planCityInfrastructure } from '@/game/engine/AI/InfrastructurePlanner';
import { evaluateBuildingEconomics, NEUTRAL_CITY_ECONOMICS } from '@/game/engine/AI/BuildingEconomics';
import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import type { Civilization } from '../../types/game';

// ── helpers ────────────────────────────────────────────────────────────────

const civ = (over: Record<string, unknown> = {}): Civilization => ({
  id: 1,
  name: 'TestCiv',
  government: 'despotism',
  taxRate: 50,
  scienceRate: 50,
  luxuryRate: 0,
  technologies: [],
  resources: { gold: 100, science: 0, food: 0, production: 0, trade: 0 },
  ...over,
} as unknown as Civilization);

/** A city with the buildings given, at the size given. */
const city = (population: number, buildings: string[] = [], id = 'c1') => ({
  id, name: 'Town', population, col: 0, row: 0,
  buildings, specialists: [], tradeRoutes: [],
  yields: { food: 8, production: 3, trade: 0 },
});

/** The engine surface `AIEconomicManager` reads. Everything else it ignores. */
const stubEcon = (over: Record<string, unknown> = {}) => ({
  maxTaxIncome: () => 10,
  maxSpecialistGold: () => 0,
  buildingUpkeep: () => 0,
  totalUpkeep: () => 3,
  getRates: () => ({ tax: 35, science: 65, luxury: 0 }),
  setRates: vi.fn(),
  specialistYields: () => ({ luxury: 0, gold: 0, science: 0 }),
  martialLaw: () => ({ bonus: 0, max: 4, current: 0 }),
  wonderHappinessForCity: () => 0,
  buildingHappinessForCity: (c: { buildings?: string[] }) =>
    (c.buildings ?? []).reduce((n, b) => n + (BUILDING_PROPERTIES[b]?.effects?.happiness ?? 0), 0),
  cityCommerce: () => 2,
  cityHappiness: () => ({ happiness: 6, unhappiness: 4, disorder: false }),
  ...over,
});

// ── 1. the luxury planner must see the city's temples ───────────────────────

describe('luxuryNeedPct', () => {
  it('counts building happiness — a city held by its temples buys no luxury', () => {
    const templed = city(4, ['temple', 'temple']); // happiness 4 vs unhappiness 4
    const mgr = new AIEconomicManager({ cities: [templed] } as never, stubEcon() as never);
    const need = (mgr as unknown as { luxuryNeedPct: (c: Civilization, cs: unknown[]) => number })
      .luxuryNeedPct(civ(), [templed]);
    expect(need).toBe(0);
  });

  it('still asks for luxury when the city really is short', () => {
    const bare = city(6); // unhappiness 6 vs 2 base contentment
    const mgr = new AIEconomicManager({ cities: [bare] } as never, stubEcon() as never);
    const need = (mgr as unknown as { luxuryNeedPct: (c: Civilization, cs: unknown[]) => number })
      .luxuryNeedPct(civ(), [bare]);
    // 4 points short on 2 commerce = 200%, so the caller's 30% cap binds.
    expect(need).toBeGreaterThan(0);
  });

  it('sizes the rate per city, not from the worst deficit over the poorest city', () => {
    const rich = { ...city(12, [], 'rich'), yields: { food: 10, production: 3, trade: 8 } };
    const poor = { ...city(4, [], 'poor'), yields: { food: 8, production: 1, trade: 0 } };
    const econ = stubEcon({
      cityCommerce: (c: { id: string }) => (c.id === 'rich' ? 8 : 2),
    });
    const mgr = new AIEconomicManager({ cities: [rich, poor] } as never, econ as never);
    const need = (mgr as unknown as { luxuryNeedPct: (c: Civilization, cs: unknown[]) => number })
      .luxuryNeedPct(civ(), [rich, poor]);
    // The rich city is 10 points short on 8 commerce → 125%; the poor city is
    // 2 short on 2 → 100%. The old max/min form took 10 (worst deficit) over
    // 2 (smallest commerce) = 500 % for everybody.
    expect(need).toBe(100);
  });
});

// ── 2. only refunds close a one-off gap ────────────────────────────────────

describe('planBuildingFunding', () => {
  const candidate = (buildingType: string, refund: number, cityEconomics = {}) => ({
    cityId: 'c1', cityName: 'Town', buildingType, refund,
    economics: evaluateBuildingEconomics(buildingType, { ...NEUTRAL_CITY_ECONOMICS, ...cityEconomics }),
  });

  it('does not count a per-turn saving as money raised this turn', () => {
    // Two walls, each refunding 60 and draining 2 g/turn. The old loop stopped
    // after the FIRST sale having raised 60 of 61 gold, because it added the
    // 2 g/turn saving to the refund and compared that with the target.
    const walls = (cityId: string) => ({
      cityId, cityName: cityId, buildingType: 'city_walls', refund: 60,
      economics: evaluateBuildingEconomics('city_walls', { ...NEUTRAL_CITY_ECONOMICS, taxRate: 10 }),
    });
    expect(walls('a').economics.netPerTurn).toBeLessThan(0);
    const plan = AICoordinator.planBuildingFunding({
      demands: [{ kind: 'army', label: 'units', goldNeeded: 61, urgency: 0.4 }],
      budget: 0,
      upkeepPerTurn: 2,
      reserveTurns: 1,
      aggression: 'normal',
      candidates: [walls('a'), walls('b')],
    });
    expect(plan.shortfall).toBe(61);
    expect(plan.sales).toHaveLength(2); // 60 does not close 61
  });

  it('stops as soon as the refunds cover the gap', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [{ kind: 'army', label: 'units', goldNeeded: 25, urgency: 0.4 }],
      budget: 0,
      aggression: 'normal',
      candidates: [candidate('bank', 60, { taxRate: 10 }), candidate('granary', 60, { taxRate: 10 })],
    });
    expect(plan.sales).toHaveLength(1);
  });
});

// ── 3. public works are paid in shields, so they are not a gold demand ─────

describe('planCityInfrastructure', () => {
  it('reports no gold figure — the settler is paid in shields', () => {
    const tiles = Array.from({ length: 16 }, (_, i) => ({
      col: i % 4, row: Math.floor(i / 4), terrain: 'grassland', ownedBy: 0,
    }));
    const plan = planCityInfrastructure(
      { id: 'c1', name: 'Town', population: 13, col: 2, row: 2 }, tiles,
      { civilizationId: 0, technologies: new Set(['the_wheel']), isFoodConstrained: false, isAtWar: false, raidersNearby: 0, underAssault: false },
    );
    expect(plan.settlersNeeded).toBeGreaterThan(0);
    expect('goldNeeded' in plan).toBe(false);
  });
});

// ── 4. research scoring uses the engine's turn estimate ────────────────────

describe('AIResearch cost efficiency', () => {
  const personality = { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 };
  const state = (turnsToResearch?: (id: string) => number) => ({
    currentYear: -3000, roundNumber: 20, numCities: 6, numEnemyCitiesKnown: 0,
    isAtWar: false, hasLibrary: true, totalScience: 15, turnsToResearch,
  }) as never;

  it('penalises a tech the engine says will take 38 turns', () => {
    // The raw table cost (300) over 15 beakers reads as 20 turns — just under
    // the penalty. The effective cost on a 40x40 map is 600, i.e. 38 turns.
    const scored = AIResearch.scoreTechnology('moonshot', personality, 'balanced_growth',
      state(() => 38));
    expect(scored.reason).toMatch(/slow-research/);
  });

  it('rewards a genuinely fast tech', () => {
    const scored = AIResearch.scoreTechnology('pottery', personality, 'balanced_growth',
      state(() => 3));
    expect(scored.reason).toMatch(/quick-research/);
  });

  it('still works when the caller cannot supply the estimate', () => {
    const scored = AIResearch.scoreTechnology('pottery', personality, 'balanced_growth', state());
    expect(scored.score).toBeGreaterThan(0);
  });
});

// ── 5. the affordability preview uses the civ's real rates ─────────────────

describe('AutoProduction.canAffordAnotherUnit', () => {
  it('previews the rates the civ actually runs', () => {
    const previewEconomy = vi.fn().mockReturnValue({ net: 4, tax: 6, upkeep: 2 });
    const engine = {
      civilizations: [null, civ({ taxRate: 80, scienceRate: 20, luxuryRate: 0 })],
      cities: [], units: [],
      economicManager: { previewEconomy, AI_MIN_GOLD_RESERVE: 8 },
    };
    const ap = new AutoProduction(engine as never);
    const afford = (ap as unknown as { canAffordAnotherUnit: (id: number) => boolean })
      .canAffordAnotherUnit(1);
    expect(afford).toBe(true);
    // Not 50/50/50: three rates that sum to 150 % and that `setRates` would
    // never produce, which used to understate this civ's tax income by 37 %.
    expect(previewEconomy).toHaveBeenCalledWith(expect.anything(), {
      tax: 80, science: 20, luxury: 0,
    });
  });

  it('defaults missing rates to zero, never to a healthy 50 %', () => {
    const previewEconomy = vi.fn().mockReturnValue({ net: -2, tax: 0, upkeep: 2 });
    const engine = {
      civilizations: [null, civ({ taxRate: undefined, scienceRate: undefined, luxuryRate: undefined })],
      cities: [], units: [],
      economicManager: { previewEconomy, AI_MIN_GOLD_RESERVE: 8 },
    };
    const ap = new AutoProduction(engine as never);
    (ap as unknown as { canAffordAnotherUnit: (id: number) => boolean }).canAffordAnotherUnit(1);
    expect(previewEconomy).toHaveBeenCalledWith(expect.anything(), {
      tax: 0, science: 0, luxury: 0,
    });
  });
});

// ── 6. one definition of plannable income ────────────────────────────────

describe('AIEconomicManager.planningIncome', () => {
  it('never plans against the 100 %-tax figure', () => {
    const c = civ({ taxRate: 35 });
    const mgr = new AIEconomicManager({ cities: [] } as never, stubEcon({
      maxTaxIncome: () => 10, maxSpecialistGold: () => 2,
    }) as never);
    // The rate controller's ceiling at 0 luxury and a 20 % science floor is 80 %.
    expect(mgr.planningIncome(c)).toBe(10); // floor(10 × 0.8) + 2
    expect(mgr.planningIncome(c)).toBeLessThan(10 + 2);
  });
});

// ── 7. the naval budget plans against income the civ can defend ─────────

describe('AutoProduction.navalDoctrineFor', () => {
  it('receives the planning income, not the 100 %-tax figure', () => {
    // `maxTaxIncome` is what the civ would collect at 100 % tax — a figure the
    // rate controller never lets it run. The doctrine sizes hulls against the
    // surplus, so passing the fantasy income over-budgeted every fleet.
    const getStrategyForCiv = (): string => 'balanced_growth';
    const engine = {
      civilizations: [null, civ({ taxRate: 35 })],
      cities: [{ id: 'c1', civilizationId: 1, col: 0, row: 0, population: 4, buildings: [] }],
      units: [],
      roundManager: { getRoundNumber: () => 10 },
      diplomacyManager: { getEnemies: () => [] },
      aiManager: {},
      economicManager: { maxTaxIncome: () => 40, totalUpkeep: () => 4 },
      aiEconomicManager: { planningIncome: () => 12 },
      getPlayerStorage: () => ({ turnData: {} }),
      getColonizableIslands: () => [],
      isCivAtWar: () => false,
      tileHasNavalAccess: () => false,
      map: {},
    };
    const ap = new AutoProduction(engine as never);
    (ap as unknown as { getStrategyForCiv: (id: number) => string }).getStrategyForCiv = getStrategyForCiv;
    const verdict = (ap as unknown as {
      navalDoctrineFor: (id: number) => { incomePerTurn: number } | null;
    }).navalDoctrineFor(1);
    expect(verdict?.incomePerTurn).toBe(12);
  });
});

// ── 8. the funding planner sees unit upkeep ──────────────────────────────
describe('planFundingForCiv', () => {
  const engineStub = (over: Record<string, unknown> = {}) => ({
    units: [],
    cities: [],
    civilizations: [null, civ({ resources: { gold: 10 } })],
    isCivAtWar: () => false,
    aiEconomicManager: { sustainableUnits: () => 2, isUnderEconomicPressure: () => false },
    economicManager: { totalUpkeep: () => 0 },
    getPlayerStorage: () => ({ turnData: {} }),
    roundManager: { getRoundNumber: () => 50 },
    squareGrid: { squareDistance: () => 9 },
    map: { tiles: [] },
    ...over,
  });

  it('counts unit upkeep when it asks whether the treasury is being drained', () => {
    // Five warriors at 1 gold each, no buildings: the OLD arithmetic summed
    // buildings only, saw 0 upkeep, and declared no crisis while the civ bled
    // 5 gold a turn through its army.
    const engine = engineStub({
      units: [1, 2, 3, 4, 5].map((n) => ({
        id: `u${n}`, type: 'warrior', civilizationId: 1, col: n, row: 0, attack: 1, defense: 1, maintenance: 1,
      })),
      economicManager: { totalUpkeep: () => 5 },
    });
    const mgr = new AIManager(engine as never);
    const plan = (mgr as unknown as {
      planFundingForCiv: (c: Civilization, cs: unknown[], r: unknown, g: unknown, s: unknown) => {
        demands: Array<{ kind: string; goldNeeded: number }>;
      } | null;
    }).planFundingForCiv(civ({ resources: { gold: 10 } }), [], new Map(), [], new Set());
    expect(plan).not.toBeNull();
    expect(plan!.demands.some((d) => d.kind === 'maintenance_crisis')).toBe(true);
  });

  it('prices an extra unit at what it costs to keep, not a flat 4 gold', () => {
    // The civ fields only warriors (1 gold/turn each) and wants three more: the
    // old arithmetic charged a flat `UNIT_MAINTENANCE * 4` = 4 per unit — 12
    // for an army the engine will bill at 3.
    const engine = engineStub({
      units: [1, 2, 3].map((n) => ({
        id: `u${n}`, type: 'warrior', civilizationId: 1, col: n, row: 0, attack: 1, defense: 1, maintenance: 1,
      })),
      aiEconomicManager: { sustainableUnits: () => 6, isUnderEconomicPressure: () => false },
      economicManager: { totalUpkeep: () => 3 },
    });
    const mgr = new AIManager(engine as never);
    const plan = (mgr as unknown as {
      planFundingForCiv: (c: Civilization, cs: unknown[], r: unknown, g: unknown, s: unknown) => {
        demands: Array<{ kind: string; goldNeeded: number }>;
      } | null;
    }).planFundingForCiv(civ({ resources: { gold: 200 } }), [], new Map(), [], new Set());
    const army = plan!.demands.find((d) => d.kind === 'army');
    // 3 units short (6 sustainable − 3 fielded) at 1 gold each.
    expect(army?.goldNeeded).toBe(3);
  });

  it('falls back to building upkeep when the engine cannot answer', () => {
    const engine = engineStub({
      cities: [{ id: 'c1', name: 'Town', civilizationId: 1, col: 0, row: 0, population: 4, buildings: ['temple'] }],
      units: [],
      economicManager: {}, // no totalUpkeep
    });
    const mgr = new AIManager(engine as never);
    const plan = (mgr as unknown as {
      planFundingForCiv: (c: Civilization, cs: unknown[], r: unknown, g: unknown, s: unknown) => {
        demands: Array<{ kind: string }>;
      } | null;
    }).planFundingForCiv(civ({ resources: { gold: 10 } }), [], new Map(), [], new Set());
    // Temple upkeep is 1 g/turn, spendable gold is 2 — not a crisis on its own.
    expect(plan?.demands.some((d) => d.kind === 'maintenance_crisis')).toBe(false);
  });
});
