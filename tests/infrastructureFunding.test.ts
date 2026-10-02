/**
 * Infrastructure planning and forced liquidation — the two halves of "sell a
 * building to fund something".
 *
 * Public works are paid in worker-turns, and only a settler can spend them, so
 * a city's infrastructure demand reaches the treasury as settler cost. The size
 * thresholds are the rule: nothing over size 6, partial coverage in between,
 * and every buildable tile at size 12 — with the whole plan suspended while the
 * city is being raided, because a settler standing in the open is a target
 * rather than a construction crew.
 */
import { describe, expect, it } from 'vitest';
import {
  planCityInfrastructure,
  requiredImprovementTiles,
  SETTLER_BUILD_COST,
  INFRASTRUCTURE_POP_THRESHOLD,
  INFRASTRUCTURE_FULL_COVERAGE_POP,
  type InfrastructureContext,
  type InfrastructureTile,
} from '@/game/engine/AI/InfrastructurePlanner';
import { IMPROVEMENT_TYPES } from '@/data/TileImprovementConstants';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import { AICoordinator, type BuildingFundingCandidate, type FundingDemand } from '@/game/engine/AI/AICoordinator';
import { evaluateBuildingEconomics, NEUTRAL_CITY_ECONOMICS } from '@/game/engine/AI/BuildingEconomics';

const city = (overrides: Partial<{ id: string; name: string; population: number; col: number; row: number }> = {}) => ({
  id: 'town', name: 'Town', population: 8, col: 10, row: 10, ...overrides,
});

const ctx = (overrides: Partial<InfrastructureContext> = {}): InfrastructureContext => ({
  civilizationId: 0,
  technologies: new Set<string>(),
  isFoodConstrained: true,
  isAtWar: false,
  raidersNearby: 0,
  underAssault: false,
  ...overrides,
});

/** A ring of plain tiles around (10,10) that can all take a road. */
function ring(count: number, terrain: string = TERRAIN_TYPES.GRASSLAND): InfrastructureTile[] {
  const tiles: InfrastructureTile[] = [];
  let placed = 0;
  for (let dc = -2; dc <= 2 && placed < count; dc++) {
    for (let dr = -2; dr <= 2 && placed < count; dr++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) !== 2) continue; // ring only
      tiles.push({ col: 10 + dc, row: 10 + dr, terrain, ownedBy: 0 });
      placed++;
    }
  }
  return tiles;
}

describe('infrastructure size thresholds', () => {
  it('needs no public works at or below size 6', () => {
    expect(requiredImprovementTiles(6, 20)).toBe(0);
    expect(requiredImprovementTiles(4, 20)).toBe(0);
    expect(INFRASTRUCTURE_POP_THRESHOLD).toBe(6);
  });

  it('asks for partial coverage between size 6 and 12', () => {
    const required = requiredImprovementTiles(9, 20);
    expect(required).toBeGreaterThan(0);
    expect(required).toBeLessThan(20);
  });

  it('asks for every buildable tile at size 12', () => {
    expect(requiredImprovementTiles(12, 20)).toBe(20);
    expect(requiredImprovementTiles(20, 20)).toBe(20);
    expect(INFRASTRUCTURE_FULL_COVERAGE_POP).toBe(12);
  });

  it('never asks for more tiles than exist', () => {
    expect(requiredImprovementTiles(12, 0)).toBe(0);
  });
});

describe('planCityInfrastructure', () => {
  it('prices a big city through the settlers that would dig it', () => {
    const tiles = ring(20);
    const plan = planCityInfrastructure(city({ population: 13 }), tiles, ctx());

    // A Chebyshev ring of radius 2 around a city is 16 tiles.
    expect(plan.buildableTiles).toBe(tiles.length);
    expect(plan.requiredTiles).toBe(tiles.length);
    expect(plan.deficit).toBe(tiles.length);
    expect(plan.settlersNeeded).toBeGreaterThan(0);
    expect(plan.goldNeeded).toBe(plan.settlersNeeded * SETTLER_BUILD_COST);
    expect(plan.workerTurnsNeeded).toBeGreaterThan(0);
    expect(plan.wantsInfrastructure).toBe(true);
    expect(plan.targets.length).toBeGreaterThan(0);
  });

  it('leaves a small city alone', () => {
    const plan = planCityInfrastructure(city({ population: 5 }), ring(20), ctx());
    expect(plan.deficit).toBe(0);
    expect(plan.settlersNeeded).toBe(0);
    expect(plan.goldNeeded).toBe(0);
    expect(plan.wantsInfrastructure).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/no public works needed/);
  });

  it('does not count water or another civ’s land', () => {
    const tiles: InfrastructureTile[] = [
      { col: 12, row: 10, terrain: TERRAIN_TYPES.GRASSLAND, ownedBy: 0 },
      { col: 11, row: 10, terrain: TERRAIN_TYPES.OCEAN, ownedBy: 0 },
      { col: 10, row: 12, terrain: TERRAIN_TYPES.GRASSLAND, ownedBy: 3 },
    ];
    const plan = planCityInfrastructure(city({ population: 14 }), tiles, ctx());
    expect(plan.buildableTiles).toBe(1);
  });

  it('ignores tiles beyond the city ring', () => {
    const tiles: InfrastructureTile[] = [
      { col: 14, row: 10, terrain: TERRAIN_TYPES.GRASSLAND, ownedBy: 0 },
    ];
    const plan = planCityInfrastructure(city({ population: 14 }), tiles, ctx());
    expect(plan.buildableTiles).toBe(0);
  });

  it('counts an already-improved tile as covered', () => {
    const tiles = ring(20).map(t => ({ ...t, improvement: IMPROVEMENT_TYPES.ROAD }));
    const plan = planCityInfrastructure(city({ population: 13 }), tiles, ctx());
    expect(plan.currentTiles).toBe(tiles.length);
    expect(plan.deficit).toBe(0);
    expect(plan.wantsInfrastructure).toBe(false);
  });

  it('irrigates fertile land, which is the improvement that grows a city', () => {
    const tiles = ring(20, TERRAIN_TYPES.GRASSLAND);
    const plan = planCityInfrastructure(city({ population: 13 }), tiles, ctx({ isFoodConstrained: true }));
    expect(plan.targets[0].improvement).toBe(IMPROVEMENT_TYPES.IRRIGATION);
  });

  it('prefers mines at war, because +3 production is the fastest shield income', () => {
    const tiles = ring(20, TERRAIN_TYPES.HILLS);
    const war = planCityInfrastructure(city({ population: 13 }), tiles, ctx({
      isAtWar: true, isFoodConstrained: false,
    }));
    expect(war.targets[0].improvement).toBe(IMPROVEMENT_TYPES.MINES);
  });

  it('upgrades a road to a railroad once the tech exists', () => {
    // Desert: irrigation and mining do not transform it, so a roaded desert
    // tile can only ever be finished by the rail upgrade.
    const tiles: InfrastructureTile[] = [
      { col: 12, row: 10, terrain: TERRAIN_TYPES.DESERT, improvement: IMPROVEMENT_TYPES.ROAD, ownedBy: 0 },
    ];
    const without = planCityInfrastructure(city({ population: 13 }), tiles, ctx({ isFoodConstrained: false }));
    expect(without.targets[0]).toBeUndefined();

    const with_ = planCityInfrastructure(city({ population: 13 }), tiles, ctx({
      isFoodConstrained: false, technologies: new Set(['railroad']),
    }));
    expect(with_.targets[0].improvement).toBe(IMPROVEMENT_TYPES.RAILROAD);
  });

  it('allows mining over a road, because mining transforms the terrain', () => {
    // The engine permits a terrain transformation on an improved tile, so a
    // roaded grassland tile is still worth mining.
    const tiles: InfrastructureTile[] = [
      { col: 12, row: 10, terrain: TERRAIN_TYPES.GRASSLAND, improvement: IMPROVEMENT_TYPES.ROAD, ownedBy: 0 },
    ];
    const plan = planCityInfrastructure(city({ population: 13 }), tiles, ctx({
      isAtWar: true, isFoodConstrained: false,
    }));
    expect(plan.targets[0].improvement).toBe(IMPROVEMENT_TYPES.MINES);
  });
});

describe('infrastructure and attack', () => {
  it('suspends the plan while raiders are nearby — settlers are targets', () => {
    const plan = planCityInfrastructure(city({ population: 14 }), ring(20), ctx({ raidersNearby: 2 }));
    expect(plan.deficit).toBeGreaterThan(0);
    expect(plan.threat).toBe('raiders');
    expect(plan.wantsInfrastructure).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/settlers are targets/);
  });

  it('suspends the plan entirely when the city is under assault', () => {
    const plan = planCityInfrastructure(city({ population: 14 }), ring(20), ctx({ underAssault: true }));
    expect(plan.threat).toBe('besieged');
    expect(plan.wantsInfrastructure).toBe(false);
    expect(plan.reasons.join(' ')).toMatch(/buy defence first/);
  });
});

// ---------------------------------------------------------------------------
// Forced liquidation
// ---------------------------------------------------------------------------

const candidate = (
  buildingType: string,
  refund: number,
  city: CityEconomicsOverrides = {},
): BuildingFundingCandidate => ({
  cityId: 'town',
  cityName: 'Town',
  buildingType,
  refund,
  economics: evaluateBuildingEconomics(buildingType, { ...NEUTRAL_CITY_ECONOMICS, ...city }),
});

type CityEconomicsOverrides = Partial<typeof NEUTRAL_CITY_ECONOMICS>;

const demand = (kind: FundingDemand['kind'], goldNeeded: number, urgency = 0.5): FundingDemand => ({
  kind, label: kind, goldNeeded, urgency,
});

describe('AICoordinator.planBuildingFunding', () => {
  it('does nothing when there is no spending demand', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [], budget: 100, candidates: [candidate('sdi_defense', 100)],
    });
    expect(plan.sales).toEqual([]);
    expect(plan.reasons.join(' ')).toMatch(/no spending demand/);
  });

  it('does nothing when the treasury already covers the plan', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [demand('infrastructure', 40)],
      budget: 200,
      candidates: [candidate('sdi_defense', 100)],
    });
    expect(plan.shortfall).toBe(0);
    expect(plan.sales).toEqual([]);
  });

  it('sells to cover a shortfall, cheapest loss first', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [demand('infrastructure', 200)],
      budget: 0,
      candidates: [
        candidate('stock_exchange', 80, { taxRate: 10 }),  // net −1.4
        candidate('sdi_defense', 100),                     // net −4
      ],
    });
    expect(plan.shortfall).toBe(200);
    // The smaller drain goes first — same gap closed for less income lost.
    expect(plan.sales[0].buildingType).toBe('stock_exchange');
  });

  it('never sells a building that pays for itself', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [demand('army', 500)],
      budget: 0,
      candidates: [
        candidate('stock_exchange', 80, { taxRate: 60 }), // net +1.6
        candidate('bank', 60, { taxRate: 60 }),           // net +3
      ],
    });
    expect(plan.sales).toEqual([]);
    expect(plan.reasons.join(' ')).toMatch(/nothing left to sell/);
  });

  it('stops as soon as the gap is closed rather than liquidating everything', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [demand('infrastructure', 50)],
      budget: 0,
      candidates: [
        candidate('marketplace', 40, { taxRate: 10 }),
        candidate('bank', 60, { taxRate: 10 }),
        candidate('sdi_defense', 100),
      ],
    });
    expect(plan.sales).toHaveLength(1);
  });

  it('honours urgency when several plans compete for the same money', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [demand('infrastructure', 300, 0.2), demand('army', 300, 0.9)],
      budget: 0,
      candidates: [candidate('sdi_defense', 100)],
    });
    expect(plan.demands[0].kind).toBe('army');
  });

  it('counts the refund as money raised as well as the upkeep saved', () => {
    const plan = AICoordinator.planBuildingFunding({
      demands: [demand('bribe', 40)],
      budget: 0,
      candidates: [candidate('sdi_defense', 100)],
    });
    expect(plan.sales).toHaveLength(1);
    expect(plan.sales[0].refund).toBe(100);
    expect(plan.sales[0].verdict).toBe('inert');
  });
});
