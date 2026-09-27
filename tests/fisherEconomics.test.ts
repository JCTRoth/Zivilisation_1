/**
 * Fisher Boat economics — the equation the AI uses to decide whether a boat
 * makes economic sense.
 *
 *   cycleTurns(d)  = STORAGE + 2 * ceil(d / movement)
 *   catchValue(d)  = STORAGE * fisherFoodPerFish(d)
 *   foodPerTurn(d) = catchValue(d) / cycleTurns(d)
 *   valuePerTurn   = (foodPerTurn + netTileFood) * FOOD_VALUE
 *   upkeepPerTurn  = maintenance + cost / PAYBACK_TURNS
 *   worthwhile     = valuePerTurn - upkeepPerTurn > 0
 */
import { describe, expect, it } from 'vitest';
import {
  FISHER_FOOD_VALUE,
  FISHER_NET_TILE_FOOD,
  FISHER_PAYBACK_TURNS,
  bestFishingGround,
  evaluateFishingGrounds,
  fisherEconomics,
  fisherFoodPerTurn,
  fishingRelevanceForCiv,
  isTileWorkable,
  netTileFoodFor,
  type FisherGroundEngine,
  type FisherRelevanceEngine,
} from '@/game/engine/FisherEconomics';
import { FISHER_BOAT_STORAGE, UNIT_PROPERTIES } from '@/data/UnitConstants';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

const O = TERRAIN_TYPES.OCEAN;
const G = TERRAIN_TYPES.GRASSLAND;

/** Tiny map harness: `rows` of terrain, `fish` tiles marked by [col,row]. */
function makeEngine(rows: string[][], fish: Array<[number, number]> = []): FisherGroundEngine & {
  isExploredByPlayer: (civ: number, col: number, row: number) => boolean;
} {
  const width = rows[0].length;
  const height = rows.length;
  const grid = {
    width,
    height,
    chebyshevDistance: (c1: number, r1: number, c2: number, r2: number) =>
      Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
  };
  const fishSet = new Set(fish.map(([c, r]) => `${c},${r}`));
  let explored = true;
  return {
    squareGrid: grid,
    getTileAt: (col: number, row: number) =>
      rows[row]?.[col] === undefined
        ? null
        : {
            type: rows[row][col],
            terrain: rows[row][col],
            resource: fishSet.has(`${col},${row}`) ? 'fish' : null,
          },
    isExploredByPlayer: () => explored,
    setExplored(value: boolean) { explored = value; },
  } as FisherGroundEngine & { isExploredByPlayer: (c: number, col: number, row: number) => boolean };
}

describe('Fisher Boat cycle and food rate', () => {
  it('derives the cycle from hold + both trip legs', () => {
    const props = UNIT_PROPERTIES.fisher_boat;
    expect(FISHER_BOAT_STORAGE).toBe(6);
    expect(props.movement).toBe(2);
    // d=2 → 1 turn out + 1 turn back + 6 fishing = 8
    expect(fisherEconomics(2).cycleTurns).toBe(8);
    // d=4 → 2+2+6 = 10 (the next per-fish tier just unlocked)
    expect(fisherEconomics(4).cycleTurns).toBe(10);
    // d=8 → 4+4+6 = 14
    expect(fisherEconomics(8).cycleTurns).toBe(14);
  });

  it('prices far grounds per fish so they can beat nearer poor ones', () => {
    // 6 food / 8 turns vs 12 food / 10 turns vs 18 food / 14 turns.
    expect(fisherFoodPerTurn(2)).toBeCloseTo(6 / 8, 5);
    expect(fisherFoodPerTurn(4)).toBeCloseTo(12 / 10, 5);
    expect(fisherFoodPerTurn(8)).toBeCloseTo(18 / 14, 5);
    // Non-monotonic by design: the 4-tile ground is richer per turn than the
    // 3-tile one (a new food-per-fish tier at d=4).
    expect(fisherFoodPerTurn(4)).toBeGreaterThan(fisherFoodPerTurn(3));
  });
});

describe('Fisher Boat net value', () => {
  it('is worth it when the city can work the netted tile', () => {
    const near = fisherEconomics(2, { netTileFoodPerTurn: FISHER_NET_TILE_FOOD });
    expect(near.foodPerTurn).toBeCloseTo(0.75, 5);
    // (0.75 + 1) * 2 = 3.5 value vs 1 upkeep + 20/20 build = 2 → +1.5
    expect(near.upkeepPerTurn).toBeCloseTo(2, 5);
    expect(near.netValuePerTurn).toBeCloseTo(1.5, 5);
    expect(near.worthwhile).toBe(true);
  });

  it('is not worth it when the trip cannot pay for the boat', () => {
    // 3 tiles out, no city can work the tile: 6 food / 10 turns = 0.6/turn →
    // 1.2 value vs 2.0 upkeep.
    const poor = fisherEconomics(3);
    expect(poor.netValuePerTurn).toBeCloseTo(1.2 - 2, 5);
    expect(poor.worthwhile).toBe(false);
  });

  it('lets a rich far ground pay for the longer trip', () => {
    // 8 tiles out: 18 food / 14 turns ≈ 1.29/turn → 2.57 value > 2.0 upkeep.
    const rich = fisherEconomics(8);
    expect(rich.netValuePerTurn).toBeGreaterThan(0);
    expect(rich.worthwhile).toBe(true);
    // Past ~16 tiles even the 3-food fish cannot cover the round trip.
    const tooFar = fisherEconomics(16);
    expect(tooFar.worthwhile).toBe(false);
  });

  it('uses the documented constants', () => {
    expect(FISHER_FOOD_VALUE).toBe(2);
    expect(FISHER_PAYBACK_TURNS).toBe(20);
    expect(FISHER_NET_TILE_FOOD).toBe(1);
  });

  it('knows which tiles a city can work (radius 2, no corners)', () => {
    expect(isTileWorkable(2, 1)).toBe(true);
    expect(isTileWorkable(2, 2)).toBe(false);
    expect(isTileWorkable(3, 0)).toBe(false);
    expect(netTileFoodFor({ col: 0, row: 0 }, { col: 2, row: 1 })).toBe(1);
    expect(netTileFoodFor({ col: 0, row: 0 }, { col: 3, row: 0 })).toBe(0);
  });
});

describe('Fishing ground selection', () => {
  it('picks the best net value, not the nearest tile', () => {
    // City (0,0). Fish at d=3 (0.6 food/turn, nothing works the tile) and at
    // d=8 (1.29 food/turn, rich tier) — the far ground wins.
    const engine = makeEngine(
      [
        [G, G, G, G, G, G, G, G, G],
        [G, O, O, O, O, O, O, O, O],
        [G, O, O, O, O, O, O, O, O],
      ],
      [[3, 2], [8, 2]],
    );
    const city = { col: 0, row: 0, civilizationId: 0 };
    const grounds = evaluateFishingGrounds(engine, city);
    expect(grounds[0].col).toBe(8);
    expect(grounds[0].worthwhile).toBe(true);
    expect(grounds[1].col).toBe(3);
    expect(grounds[1].worthwhile).toBe(false);
    expect(bestFishingGround(engine, city)?.col).toBe(8);
  });

  it('prefers a workable ground when its net bonus makes it better', () => {
    // d=2 tile is workable (+1 food/turn → 1.75 food value) vs the far rich
    // ground (1.29) — the near one wins.
    const engine = makeEngine(
      [
        [G, G, G, G, G, G, G, G, G],
        [G, O, O, O, O, O, O, O, O],
        [G, O, O, O, O, O, O, O, O],
      ],
      [[2, 1], [8, 2]],
    );
    const city = { col: 0, row: 0, civilizationId: 0 };
    const best = bestFishingGround(engine, city);
    expect(best?.col).toBe(2);
    expect(best?.netTileFoodPerTurn).toBe(1);
    expect(best?.worthwhile).toBe(true);
  });

  it('returns null with no known fish and ignores unexplored grounds', () => {
    const none = makeEngine([[G, O]], []);
    expect(bestFishingGround(none, { col: 0, row: 0, civilizationId: 0 })).toBeNull();

    const hidden = makeEngine([[G, O]], [[1, 0]]);
    (hidden as unknown as { setExplored(value: boolean): void }).setExplored(false);
    expect(bestFishingGround(hidden, { col: 0, row: 0, civilizationId: 0 })).toBeNull();
  });
});


describe('fishing relevance for a civilization', () => {
  const city = (col: number, row: number, overrides: Record<string, unknown> = {}) => ({
    id: `c${col}${row}`,
    col,
    row,
    civilizationId: 0,
    buildings: [] as string[],
    ...overrides,
  });

  const mapRows = [
    [G, G, G, G, G, G, G, G, G],
    [G, O, O, O, O, O, O, O, O],
    [G, O, O, O, O, O, O, O, O],
  ];

  function engineWith(fish: Array<[number, number]>, cities: ReturnType<typeof city>[]): FisherRelevanceEngine {
    const engine = makeEngine(mapRows, fish) as FisherRelevanceEngine;
    engine.cities = cities;
    return engine;
  }

  it('is 2 for a clearly worthwhile ground and 1 for a marginal one', () => {
    // Workable ground (net +1.5) → 2.
    expect(fishingRelevanceForCiv(engineWith([[2, 1]], [city(0, 0)]), 0)).toBe(2);
    // Far ground at d=4 (net +0.4) → 1.
    expect(fishingRelevanceForCiv(engineWith([[4, 2]], [city(0, 0)]), 0)).toBe(1);
    // d=3 pays less than upkeep → nothing to unlock.
    expect(fishingRelevanceForCiv(engineWith([[3, 2]], [city(0, 0)]), 0)).toBe(0);
  });

  it('drops to 0 once the city already owns a Harbor', () => {
    const engine = engineWith([[2, 1]], [city(0, 0, { buildings: ['harbor'] })]);
    expect(fishingRelevanceForCiv(engine, 0)).toBe(0);
  });

  it('is 0 for an inland city and for other civilizations', () => {
    // An all-land map has no coastal city, however good the fish tile is.
    const inland = makeEngine(
      [
        [G, G, G, G, G],
        [G, G, G, G, G],
        [G, G, G, G, G],
      ],
      [[4, 2]],
    ) as FisherRelevanceEngine;
    inland.cities = [city(2, 2)];
    expect(fishingRelevanceForCiv(inland, 0)).toBe(0);

    // Another civ's coastal city does not make us research the Harbor.
    expect(fishingRelevanceForCiv(engineWith([[2, 1]], [city(0, 0, { civilizationId: 1 })]), 0)).toBe(0);
  });
});
