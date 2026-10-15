/**
 * The three gates a Caravan has to pass before it opens a route.
 *
 * A 4-civ × 150-round batch produced 8 caravans and delivered ZERO routes.
 * `scripts/trade_pipeline_sim.py` prices each gate independently; these tests are
 * the permanent version of that table — one describe per gate, each pinned to
 * fail on the old behaviour.
 *
 *   G1  RESEARCH   the `trade` chain is only chosen while the caravan hook is
 *                  live, and the hook needs a city able to host a route.
 *   G2  SURVIVAL   `CombatSystem` makes winChance = A/(A+D), so defense 0 is a
 *                  guaranteed death on the first encounter.
 *   G3  WORK       the works corps must be sized by REACHABLE tiles, not by
 *                  every tile in every radius.
 */
import { describe, it, expect } from 'vitest';
import { UNIT_PROPS } from '@/utils/Constants';
import { CombatSystem } from '@/game/engine/CombatSystem';
import { caravanRelevanceForCiv } from '@/game/engine/AI/CaravanEconomics';
import { SettlerGovernor } from '@/game/engine/AI/SettlerGovernor';
import type { City, Unit } from '../../types/game';
import GameEngine from '@/game/engine/GameEngine';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { SquareGrid } from '@/game/SquareGrid';

// ── G1: research ───────────────────────────────────────────────────────────

describe('G1 — the research hook fires for a young civ', () => {
  const city = (population: number, tradeRoutes: number, civilizationId = 0) => ({
    population, tradeRoutes: Array.from({ length: tradeRoutes }), civilizationId,
  });

  it('a pop-1 city qualifies to host a route', () => {
    // The old rule required population 2, which delayed the hook until the first
    // city had grown — and the hook is what makes the 160-beaker chain
    // (bronze_working 30 → currency 60 → trade 70) get researched at all.
    const cities = [city(1, 0, 0), city(6, 0, 1)];
    expect(caravanRelevanceForCiv(cities, 0, true)).toBe(3);
  });

  it('a civ alone in the world still wants nothing', () => {
    expect(caravanRelevanceForCiv([city(1, 0, 0)], 0, true)).toBe(0);
  });

  it('a civ with every slot full still wants nothing', () => {
    expect(caravanRelevanceForCiv([city(1, 3, 0), city(6, 0, 1)], 0, true)).toBe(0);
  });
});

// ── G2: survival ───────────────────────────────────────────────────────────

describe('G2 — a caravan survives the encounter that used to kill it', () => {
  const attacker = { attack: 1, defense: 0, health: 100 } as Unit;
  const caravan = (defense: number) => ({
    defense, attack: 0, health: 100, col: 0, row: 0,
  }) as unknown as Unit;
  const ground = { type: 'grassland', terrain: 'grassland' };

  it('carries a non-zero defense', () => {
    // UNIT_PROPS is the wired-in table; the production path reads it verbatim.
    expect(UNIT_PROPS.caravan.defense).toBeGreaterThan(0);
  });

  it('is not killed with certainty by one enemy hit', () => {
    const odds = CombatSystem.winChance(
      CombatSystem.attackerStrength(attacker),
      CombatSystem.defenderStrength(caravan(1), {
        defenderTile: ground as never,
        defenderTerrainKey: 'grassland',
      }),
    );
    // Defending strength 1 vs attacking strength 1: a coin flip, not a certainty.
    expect(odds).toBeLessThan(1);
    expect(odds).toBeGreaterThan(0);
    expect(odds).toBeCloseTo(0.5, 5);
  });

  it('does not register as a city defender (it still cannot hold a city)', () => {
    // The production-side garrison test needs defense AND attack; a caravan has
    // no attack, so it must keep being excluded.
    const props = UNIT_PROPS.caravan;
    const isDefenderType = (p: { defense?: number; attack?: number }) =>
      !!p && (p.defense || 0) > 0 && (p.attack || 0) > 0.5;
    expect(isDefenderType(props)).toBe(false);
  });

  it('is not a disband candidate for an upkeep deficit', () => {
    // The disbander's candidate filter requires positive maintenance; a caravan
    // has none, so it is still exempt from being liquidated for deficit.
    expect(UNIT_PROPS.caravan.maintenance).toBe(0);
  });
});

// ── G3: reachable work ─────────────────────────────────────────────────────

describe('G3 — the works corps is sized by reachable tiles', () => {
  /** A mature two-city civ, so the works path (not the expansion path) decides. */
  const cities = () => [
    { id: 'c0', civilizationId: 0, col: 0, row: 0, population: 6 },
    { id: 'c1', civilizationId: 0, col: 3, row: 0, population: 6 },
  ] as unknown as City[];

  /** A governor with nothing assigned and nothing queued. */
  const governor = () => new SettlerGovernor();

  it('sizes the corps from the REACHABLE count when the owner supplies one', () => {
    // 25 outstanding tiles, only 9 of them reachable. WORKS_TILES_PER_SETTLER is
    // 4, so the corps wanted is ceil(9/4) = 3 — exactly MAX_WORKS_CORPS, and the
    // cap is now doing the work instead of asking for settlers nobody can use.
    const gov = governor();
    gov.setOutstandingWorksSource(() => 25);
    gov.setReachableWorksSource(() => 9);
    expect(gov.getRecommendedSettlerCount(cities(), [] as Unit[])).toBe(3);
  });

  it('sizes a smaller corps when the reachable count collapses', () => {
    const gov = governor();
    gov.setOutstandingWorksSource(() => 25);
    gov.setReachableWorksSource(() => 3);
    // ceil(3/4) = 1: one settler for the tiles that remain walkable.
    expect(gov.getRecommendedSettlerCount(cities(), [] as Unit[])).toBe(1);
  });

  it('credits the settlers already working, so the corps is a DELTA the caller adds', () => {
    const gov = governor();
    gov.setOutstandingWorksSource(() => 25);
    gov.setReachableWorksSource(() => 9);
    // Two settler units alive: the governor answers "still needed", so the
    // caller's total becomes 3 (already have) + 1 (recommended) = 4.
    const units = [0, 1].map((n) => ({
      id: `s${n}`, type: 'settler', civilizationId: 0, isDefeated: false,
    })) as unknown as Unit[];
    expect(gov.getRecommendedSettlerCount(cities(), units)).toBe(1);
  });

  it('falls back to the outstanding count when no reachable source exists', () => {
    // Lightweight test doubles and any owner that has not wired the new probe:
    // the previous behaviour, unchanged. (25 tiles also saturates
    // MAX_WORKS_CORPS = 3, which is why this row and the reachable one agree at
    // 3 — see the next test for the pair that actually separates.)
    const gov = governor();
    gov.setOutstandingWorksSource(() => 25);
    expect(gov.getRecommendedSettlerCount(cities(), [] as Unit[])).toBe(3);
  });

  it('separates the two sources when the raw count saturates the corps cap', () => {
    // This is the pair that proves the reachable source is doing the work:
    // each count alone would return 3 (both are at or over the cap), so only a
    // SMALL reachable count can show the difference.
    const gov = governor();
    gov.setOutstandingWorksSource(() => 25);
    gov.setReachableWorksSource(() => 1);
    expect(gov.getRecommendedSettlerCount(cities(), [] as Unit[])).toBe(1);
  });
});

// ── countReachableWorks itself ─────────────────────────────────────────────

describe('countReachableWorks', () => {
  /**
   * A 9×9 all-grass world with a real grid, and a land-bridge cut across the
   * middle so the map has two landmasses.
   */
  function makeManager() {
    const width = 9;
    const height = 9;
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    Object.assign(e, {
      units: [],
      cities: [],
      civilizations: [{ id: 0, isAI: true, technologies: [], resources: { gold: 0 } }],
      activePlayer: 0,
      map: {
        width,
        height,
        tiles: Array.from({ length: width * height }, (_, i) => ({
          col: i % width,
          row: Math.floor(i / width),
          type: 'grassland',
          terrain: 'grassland',
          resource: null,
          improvement: null,
          visible: true,
          explored: true,
        })),
      },
    });
    (e as unknown as { squareGrid: unknown }).squareGrid = new SquareGrid(width, height);
    (e as unknown as { initializePlayerStorage(id: number): void }).initializePlayerStorage(0);
    // The connectivity probe: two landmasses split at row 4.
    (e as unknown as { areLandConnected(a: number, b: number, c: number, d: number): boolean }).areLandConnected =
      (_c1, r1, _c2, r2) => Math.floor(r1 / 5) === Math.floor(r2 / 5);
    const ai = (e as unknown as {
      aiManager: {
        countOutstandingWorks: (id: number) => number;
        countReachableWorks: (id: number) => number;
      };
    }).aiManager;
    const cities = (e as unknown as { cities: City[] }).cities;
    const tiles = (e as unknown as { map: { tiles: Array<{ improvement?: string | null }> } }).map.tiles;
    return { e, ai, cities, tiles, width };
  }

  it('equals the outstanding count when the whole radius is walkable', () => {
    const { ai, cities } = makeManager();
    cities.push({ id: 'c', civilizationId: 0, col: 2, row: 2, population: 6 } as unknown as City);
    // A city at (2,2): its whole radius (cols 0-4, rows 0-4) sits on landmass 0,
    // so every tile in it is walkable and the two counts must agree exactly.
    expect(ai.countReachableWorks(0)).toBe(ai.countOutstandingWorks(0));
    expect(ai.countReachableWorks(0)).toBe(20);
  });

  it('excludes tiles a settler cannot walk to from the city they belong to', () => {
    const { ai, cities } = makeManager();
    // A coastal city whose radius reaches ACROSS the strait: its rows 2-4 tiles
    // are home landmass, its rows 5-6 tiles are across water. `countOutstanding
    // Works` counts all 20; only the 12 on this side are reachable work.
    cities.push({ id: 'c', civilizationId: 0, col: 2, row: 4, population: 6 } as unknown as City);
    expect(ai.countOutstandingWorks(0)).toBe(20);
    expect(ai.countReachableWorks(0)).toBe(12);
  });

  it('excludes tiles no settler could walk to', () => {
    const { ai, cities } = makeManager();
    // A mainland city and an island city: the island's tiles need work but no
    // settler can walk there, so they must not be counted.
    // A strait-straddling city plus a pure island city.
    cities.push({ id: 'coast', civilizationId: 0, col: 2, row: 4, population: 6 } as unknown as City);
    cities.push({ id: 'isle', civilizationId: 0, col: 2, row: 7, population: 6 } as unknown as City);
    const outstanding = ai.countOutstandingWorks(0);
    const reachable = ai.countReachableWorks(0);
    expect(outstanding).toBeGreaterThan(reachable);
    // More than the coast city's 12 reachable tiles — the island's settlers can
    // work the island they stand on — and fewer than the raw count, which also
    // charges for the coast city's far-shore tiles no settler can walk to.
    expect(reachable).toBeGreaterThan(12);
    expect(reachable).toBeLessThan(outstanding);
  });

  it('counts a tile once even when two cities share it', () => {
    const { ai, cities } = makeManager();
    cities.push({ id: 'a', civilizationId: 0, col: 2, row: 2, population: 6 } as unknown as City);
    cities.push({ id: 'b', civilizationId: 0, col: 4, row: 4, population: 6 } as unknown as City);
    const two = ai.countReachableWorks(0);
    cities.length = 1;
    const one = ai.countReachableWorks(0);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThan(one * 2);
  });
});

// ── G2b: production into a threatened city ─────────────────────────────────

describe('G2b — a caravan is not built into a city under threat', () => {
  /**
   * A two-civ world: civ 0 has a city with free route slots, and a hostile unit
   * from civ 1 parked beside it. `shouldBuildCaravan` must refuse.
   */
  function world(enemyNear: boolean, atWar: boolean) {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    Object.assign(e, {
      units: [], cities: [],
      civilizations: [
        { id: 0, name: 'Barbarians', isAlive: false },
        { id: 1, name: 'A', isAI: true, technologies: ['trade'], resources: { gold: 20 } },
        { id: 2, name: 'B', isAI: true, technologies: ['trade'], resources: { gold: 20 } },
      ],
      productionManager: {},
      squareGrid: { squareDistance: (a: number, b: number, c: number, d: number) =>
        Math.max(Math.abs(a - c), Math.abs(b - d)) },
      diplomacyManager: {
        isAtWar: (a: number, b: number) => atWar && a !== b,
        hasContacted: () => true,
      },
      map: { width: 20, height: 20 },
      getTileAt: () => null, getCityAt: () => null, getUnitAt: () => null,
      aiManager: undefined,
    });
    (e as { cities: unknown[] }).cities.push({
      id: 'home', civilizationId: 1, col: 5, row: 5, population: 4,
      buildings: [], tradeRoutes: [], currentProduction: null, buildQueue: [], autoProduction: true,
    });
    (e as { units: unknown[] }).units.push(
      { id: 'g', type: 'warrior', civilizationId: 1, col: 5, row: 5, attack: 1, defense: 1 },
      { id: 'foe', type: 'warrior', civilizationId: 2, col: enemyNear ? 6 : 15, row: 5, attack: 1, defense: 1 },
    );
    return e;
  }

  const wants = (e: unknown) => {
    const ap = new AutoProduction(e as never);
    const civ = (e as { civilizations: Array<Record<string, unknown>> }).civilizations[1];
    const city = (e as { cities: Array<Record<string, unknown>> }).cities[0];
    return (ap as unknown as {
      shouldBuildCaravan: (c: unknown, ci: unknown, p: string[]) => boolean;
    }).shouldBuildCaravan(civ, city, []);
  };

  it('refuses when a hostile sits within one tile of the city', () => {
    expect(wants(world(true, true))).toBe(false);
  });

  it('still allows a caravan when the nearest hostile is far away', () => {
    expect(wants(world(false, true))).toBe(true);
  });

  it('still allows a caravan at peace, even with a neighbour nearby', () => {
    // Peacetime neighbours may wander but do not hunt our caravans; the gate is
    // for a DECLARED war (or the barbarians), not for any foreign unit.
    expect(wants(world(true, false))).toBe(true);
  });
});
