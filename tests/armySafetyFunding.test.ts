/**
 * Emergency sales must not disarm the army.
 *
 * A civ that cannot pay its bills has to sell something, and the passive audit
 * has already said what is not earning its upkeep. What it did not say was that
 * the cheapest building to liquidate is often the one the war is standing on:
 * the walls of the city being besieged, or the barracks of the base the next
 * sortie marches from. The refund is a few hundred gold; the captured city is
 * the game.
 *
 * These tests pin the rule that separates "raise money" from "lose the war":
 * a city the army depends on gives up only what earns nothing, and at war no
 * forward base may be stripped at all.
 */
import { describe, expect, it } from 'vitest';
import {
  AICoordinator,
  type BuildingFundingCandidate,
  type FundingDemand,
} from '@/game/engine/AI/AICoordinator';
import {
  evaluateBuildingEconomics,
  NEUTRAL_CITY_ECONOMICS,
  type BuildingEconomics,
} from '@/game/engine/AI/BuildingEconomics';

type Verdict = BuildingEconomics['verdict'];

const economics = (buildingType: string, verdict: Verdict): BuildingEconomics => ({
  ...NEUTRAL_CITY_ECONOMICS,
  ...evaluateBuildingEconomics(buildingType, NEUTRAL_CITY_ECONOMICS),
  buildingType,
  verdict,
});

const candidate = (buildingType: string, cityId: string, verdict: Verdict): BuildingFundingCandidate => ({
  cityId,
  cityName: `City ${cityId}`,
  buildingType,
  refund: 20,
  economics: economics(buildingType, verdict),
});

/** A demand far larger than the budget, so something has to be sold. */
const SHORTFALL: FundingDemand[] = [
  { kind: 'army', label: 'units', goldNeeded: 500, urgency: 0.9 },
];

const noneProtected = new Set<string>();
const safe = (candidates: BuildingFundingCandidate[], atWar = false) =>
  AICoordinator.filterArmySafeCandidates({
    candidates,
    protectedCityIds: noneProtected,
    atWar,
  });

describe('filterArmySafeCandidates: buildings no treasury may liquidate', () => {
  it('never sells the palace or the walls, whatever the shortage', () => {
    const kept = safe([
      candidate('palace', 'a', 'profitable'),
      candidate('city_walls', 'a', 'break_even'),
      candidate('granary', 'a', 'inert'),
    ], true);
    expect(kept.map(c => c.buildingType)).toEqual(['granary']);
  });

  it('does sell a drain from a city the army does not depend on', () => {
    const kept = safe([candidate('granary', 'frontline', 'draining')], true);
    expect(kept).toHaveLength(1);
  });
});

describe('filterArmySafeCandidates: an army-dependent city', () => {
  const base = new Set(['base']);

  it('keeps a merely unprofitable building, however big the bill', () => {
    const kept = AICoordinator.filterArmySafeCandidates({
      candidates: [
        candidate('granary', 'base', 'draining'),
        candidate('marketplace', 'base', 'break_even'),
        candidate('colosseum', 'base', 'profitable'),
      ],
      protectedCityIds: base,
      atWar: true,
    });
    expect(kept).toHaveLength(0);
  });

  it('gives up only what earns nothing', () => {
    const kept = AICoordinator.filterArmySafeCandidates({
      candidates: [
        candidate('granary', 'base', 'inert'),
        candidate('marketplace', 'base', 'draining'),
      ],
      protectedCityIds: base,
      atWar: true,
    });
    expect(kept.map(c => c.buildingType)).toEqual(['granary']);
  });

  it('will not strip the barracks of a base at war, even though it is inert', () => {
    const kept = AICoordinator.filterArmySafeCandidates({
      candidates: [candidate('barracks', 'base', 'inert')],
      protectedCityIds: base,
      atWar: true,
    });
    expect(kept).toHaveLength(0);
  });

  it('still lets an inactive civ sell an inert barracks it is not using', () => {
    const kept = AICoordinator.filterArmySafeCandidates({
      candidates: [candidate('barracks', 'base', 'inert')],
      protectedCityIds: base,
      atWar: false,
    });
    expect(kept.map(c => c.buildingType)).toEqual(['barracks']);
  });

  it('protects each city on its own merits, not the whole civ', () => {
    const kept = AICoordinator.filterArmySafeCandidates({
      candidates: [
        candidate('granary', 'base', 'inert'),
        candidate('granary', 'backwater', 'inert'),
        candidate('marketplace', 'backwater', 'draining'),
      ],
      protectedCityIds: base,
      atWar: true,
    });
    // The base's inert granary still goes — it earns nothing, so selling it
    // costs nothing. What the base keeps is everything that does earn.
    expect(kept.map(c => `${c.cityId}/${c.buildingType}`)).toEqual([
      'base/granary',
      'backwater/granary',
      'backwater/marketplace',
    ]);
  });
});

describe('armyDependentCities: which cities count as an army base', () => {
  it('collects staging, garrison and threatened cities', () => {
    const ids = AICoordinator.armyDependentCities({
      cityIds: [],
      stagingCityIds: ['riverside'],
      garrisonCityIds: ['pass'],
      underThreatCityIds: ['border'],
    });
    expect([...ids].sort()).toEqual(['border', 'pass', 'riverside']);
  });

  it('treats a bare civ as depending on nothing', () => {
    expect(AICoordinator.armyDependentCities({ cityIds: [] }).size).toBe(0);
  });
});

describe('planBuildingFunding with the army-safe candidate set', () => {
  it('funds the army from the backwater when the base cannot give anything up', () => {
    const protectedIds = AICoordinator.armyDependentCities({
      cityIds: [],
      underThreatCityIds: ['border'],
    });
    const plan = AICoordinator.planBuildingFunding({
      demands: SHORTFALL,
      budget: 0,
      candidates: AICoordinator.filterArmySafeCandidates({
        candidates: [
          candidate('city_walls', 'border', 'break_even'),
          candidate('barracks', 'border', 'inert'),
          candidate('granary', 'backwater', 'inert'),
        ],
        protectedCityIds: protectedIds,
        atWar: true,
      }),
    });
    expect(plan?.sales.map(s => `${s.cityId}/${s.buildingType}`)).toEqual(['backwater/granary']);
    // It still cannot raise 500 from one granary, and says so instead of
    // reaching for the walls.
    expect(plan?.shortfall).toBeGreaterThan(0);
  });
});

describe('aggressive liquidation', () => {
  // A break-even building earns exactly its upkeep, so selling it costs the civ
  // no income at all and still refunds half its cost. It is the cheapest money
  // in the game, and a civ in trouble should reach for it before tearing down
  // something that is actually paying.
  const breakEven = (buildingType: string, cityId: string): BuildingFundingCandidate => {
    const e = evaluateBuildingEconomics(buildingType, NEUTRAL_CITY_ECONOMICS);
    return {
      cityId,
      cityName: `City ${cityId}`,
      buildingType,
      refund: 40,
      economics: { ...e, verdict: 'break_even', netPerTurn: 0 },
    };
  };
  const draining = (buildingType: string, cityId: string): BuildingFundingCandidate => {
    const e = evaluateBuildingEconomics(buildingType, NEUTRAL_CITY_ECONOMICS);
    return {
      cityId,
      cityName: `City ${cityId}`,
      buildingType,
      refund: 40,
      economics: { ...e, verdict: 'draining', netPerTurn: -2 },
    };
  };

  it('leaves break-even buildings alone by default', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: SHORTFALL,
      budget: 0,
      candidates: [breakEven('bank', 'a')],
    });
    expect(plan?.sales).toHaveLength(0);
    expect(plan?.reasons.join(' ')).toMatch(/nothing left to sell/);
  });

  it('sells them when the civ is in real trouble', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: SHORTFALL,
      budget: 0,
      candidates: [breakEven('bank', 'a')],
      aggression: 'aggressive',
    });
    expect(plan?.sales.map(s => s.buildingType)).toEqual(['bank']);
  });

  it('takes the zero-loss buildings before the ones that cost income', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [{ kind: 'army', label: 'units', goldNeeded: 40, urgency: 0.9 }],
      budget: 0,
      candidates: [draining('sdi_defense', 'a'), breakEven('bank', 'a')],
      aggression: 'aggressive',
    });
    // One break-even sale covers the 40 gold bill on its own, so the draining
    // SDI Defense — which is paying 4 gold a turn to do nothing — survives.
    expect(plan?.sales.map(s => s.buildingType)).toEqual(['bank']);
  });

  it('raises the shortfall plus a turn of upkeep when aggressive', () => {
    const need = 100;
    const demands: FundingDemand[] = [
      { kind: 'army', label: 'units', goldNeeded: need, urgency: 0.9 },
    ];
    const normal = AICoordinator.planBuildingFunding({
      demands, budget: 0, candidates: [breakEven('bank', 'a'), breakEven('bank', 'b')],
    });
    const aggressive = AICoordinator.planBuildingFunding({
      demands, budget: 0, candidates: [breakEven('bank', 'a'), breakEven('bank', 'b')],
      aggression: 'aggressive', upkeepPerTurn: 30,
    });
    expect(normal?.sales.length).toBeLessThan(aggressive!.sales.length);
  });

  it('still refuses a profitable building, however aggressive', () => {
    const e = evaluateBuildingEconomics('bank', NEUTRAL_CITY_ECONOMICS);
    const profitable: BuildingFundingCandidate = {
      cityId: 'a', cityName: 'a', buildingType: 'bank', refund: 40,
      economics: { ...e, verdict: 'profitable', netPerTurn: 5 },
    };
    const plan = AICoordinator.planBuildingFunding({
      demands: SHORTFALL, budget: 0, candidates: [profitable], aggression: 'aggressive',
    });
    expect(plan?.sales).toHaveLength(0);
  });
});

describe('reserveTurns', () => {
  // A civ that is not at war and not broke, but holds a few dozen gold across
  // half a dozen cities, still has to pay a building upkeep bill every turn.
  // The reserve knob is what separates bridging this month's bill (1 turn) from
  // rebuilding a treasury the empire can live on.
  const breakEven = (buildingType: string, cityId: string): BuildingFundingCandidate => {
    const e = evaluateBuildingEconomics(buildingType, NEUTRAL_CITY_ECONOMICS);
    return {
      cityId,
      cityName: `City ${cityId}`,
      buildingType,
      refund: 40,
      economics: { ...e, verdict: 'break_even', netPerTurn: 0 },
    };
  };
  const candidates = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => breakEven('bank', id));
  const demands: FundingDemand[] = [
    { kind: 'reserve', label: 'a reserve', goldNeeded: 60, urgency: 0.5 },
  ];

  const plan = (reserveTurns?: number) => AICoordinator.planBuildingFunding({
    demands, budget: 0, candidates, aggression: 'aggressive', upkeepPerTurn: 40, reserveTurns,
  });

  it('defaults to one turn of upkeep, the pre-existing at-war behaviour', () => {
    expect(plan()?.sales).toHaveLength(plan(1)?.sales.length);
  });

  it('liquidates deeper the more turns of reserve it is asked for', () => {
    // Each break-even sale refunds 40 and frees no income. A 60 gold shortfall
    // plus one turn of 40 gold upkeep needs 100 → 3 sales; three turns needs
    // 180 → 5 sales.
    expect(plan(1)?.sales).toHaveLength(3);
    expect(plan(3)?.sales).toHaveLength(5);
  });

  it('never touches a profitable building to build a reserve', () => {
    const e = evaluateBuildingEconomics('bank', NEUTRAL_CITY_ECONOMICS);
    const profitable: BuildingFundingCandidate = {
      cityId: 'a', cityName: 'a', buildingType: 'bank', refund: 40,
      economics: { ...e, verdict: 'profitable', netPerTurn: 5 },
    };
    const result = AICoordinator.planBuildingFunding({
      demands, budget: 0, candidates: [profitable],
      aggression: 'aggressive', upkeepPerTurn: 30, reserveTurns: 3,
    });
    expect(result?.sales).toHaveLength(0);
  });
});
