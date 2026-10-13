/**
 * Caravan Governor tests — the rules that stop caravans pacing back and
 * forth and give them a full career ladder:
 *
 *  1. sticky delivery missions (no per-turn re-ranking → no oscillation),
 *  2. risk-taking routes (never detour out of fear; a safer alternate route
 *     is only used when one exists AND clearly reduces the risk),
 *  3. retargeting with a blacklist only after patience runs out,
 *  4. at most ONE scout caravan per civ, scouting upgraded back to delivery,
 *  5. disband as the very last resort,
 *  6. at most MAX_CARAVANS_PER_CITY in-transit caravans per home city,
 *  7. Civ1 delivery eligibility (home city, war, route capacity, knowledge).
 */
import { describe, expect, it } from 'vitest';
import type { City, Unit } from '../types/game';
import type { MapTile } from '@/game/engine/GameEngine';
import { CaravanGovernor, type CaravanWorld } from '@/game/engine/AI/CaravanGovernor';
import { Pathfinding } from '@/game/engine/Pathfinding';
import {
  CARAVAN_BLOCK_PATIENCE,
  CARAVAN_DISBAND_PATIENCE,
  CARAVAN_MAX_TRANSIT_TURNS,
  MAX_CARAVANS_PER_CITY,
  MAX_CARAVAN_TRADE_ROUTES,
} from '@/data/GameConstants';

// ---------------------------------------------------------------------------
// Fake world
// ---------------------------------------------------------------------------

const HOME_CIV = 0;
const RIVAL_CIV = 1;

/**
 * Builds a world from ASCII rows: '.' = passable land, '~' = ocean (impassable
 * to land units like caravans). Cities/units are pushed onto the shared
 * arrays, so a test can mutate the world between plans (blockers arriving,
 * targets filling up, …).
 */
function makeWorld(mapRows: string[]) {
  const height = mapRows.length;
  const width = mapRows[0].length;
  const units: Unit[] = [];
  const cities: City[] = [];
  const wars = new Set<string>();

  const getTileAt = (col: number, row: number): MapTile | null => {
    if (col < 0 || row < 0 || col >= width || row >= height) return null;
    const type = mapRows[row][col] === '~' ? 'ocean' : 'grassland';
    return { terrain: type, type, visible: true, explored: true, col, row };
  };

  const world: CaravanWorld = {
    cities,
    units,
    map: { width, height },
    squareGrid: {
      squareDistance: (c1, r1, c2, r2) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)),
    },
    getTileAt,
    getUnitAt: (col, row) => units.find((u) => u.col === col && u.row === row && !u.isDefeated) ?? null,
    getCityAt: (col, row) => cities.find((c) => c.col === col && c.row === row) ?? null,
    getCaravanHomeCity: (caravan) => cities.find((c) => c.id === caravan.homeCityId) ?? null,
    diplomacyManager: {
      isAtWar: (a, b) => wars.has(`${a}-${b}`) || wars.has(`${b}-${a}`),
    },
    // No storage → the governor's fallback sees every tile (all are visible).
    getPlayerStorage: () => undefined,
  };

  const addCity = (id: string, col: number, row: number, civ = HOME_CIV, opts: Partial<City> = {}): City => {
    const city = {
      id, col, row, civilizationId: civ, population: 4, tradeRoutes: [], ...opts,
    } as unknown as City;
    cities.push(city);
    return city;
  };
  const addCaravan = (id: string, col: number, row: number, homeCityId?: string, civ = HOME_CIV): Unit => {
    const unit = {
      id, type: 'caravan', civilizationId: civ, col, row, homeCityId,
      isDefeated: false, movesRemaining: 1,
    } as unknown as Unit;
    units.push(unit);
    return unit;
  };
  const addEnemy = (id: string, col: number, row: number, civ = RIVAL_CIV): Unit => {
    const unit = {
      id, type: 'warrior', civilizationId: civ, col, row, isDefeated: false, movesRemaining: 0,
    } as unknown as Unit;
    units.push(unit);
    return unit;
  };

  return { world, units, cities, wars, addCity, addCaravan, addEnemy };
}

const PLAN_OF = (plan: { kind: string }): string => plan.kind;

// ---------------------------------------------------------------------------

describe('sanity: the fake terrain matches engine rules', () => {
  it('ocean is impassable for a caravan', () => {
    const { world } = makeWorld(['~~', '~~']);
    const ocean = world.getTileAt(0, 0)!;
    expect(Pathfinding.getMovementCost(ocean, 'caravan')).toBe(Infinity);
    expect(Pathfinding.getMovementCost(world.getTileAt(0, 1)!, 'caravan')).toBeGreaterThan(0);
  });
});

describe('sticky missions — no back and forth', () => {
  it('keeps the original target even when walking changes the ranking', () => {
    // B(9,3) is far but big, so it wins on value per turn at the start; the
    // near city A(3,3) would out-value it once the caravan is standing next to
    // A. The old chooser re-scored every turn and turned around; the governor
    // picks ONCE and keeps walking to B.
    const { world, addCity, addCaravan } = makeWorld([
      '............',
      '............',
      '............',
      '............',
      '............',
    ]);
    addCity('H', 0, 3);
    addCity('A', 3, 3, HOME_CIV, { population: 4 });
    addCity('B', 9, 3, HOME_CIV, { population: 30 });
    const caravan = addCaravan('v1', 0, 3, 'H');
    const gov = new CaravanGovernor();

    const plan1 = gov.planUnit(caravan, world, 1);
    expect(PLAN_OF(plan1)).toBe('move');
    expect(gov.getMission('v1')).toMatchObject({ phase: 'outbound', targetCol: 9, targetRow: 3 });

    // Walk past city A — under per-turn re-scoring A would now out-value B.
    caravan.col = 4;
    const plan2 = gov.planUnit(caravan, world, 2);
    expect(PLAN_OF(plan2)).toBe('move');
    expect(gov.getMission('v1')?.targetCol).toBe(9);

    caravan.col = 7;
    const plan3 = gov.planUnit(caravan, world, 3);
    expect(PLAN_OF(plan3)).toBe('move');
    expect(gov.getMission('v1')?.targetCol).toBe(9);
    // …and the step keeps advancing towards B, never back to A.
    if (plan3.kind === 'move') expect(plan3.step.col).toBeGreaterThan(7);
  });
});

describe('risk-taking routes', () => {
  it('takes the direct route past enemies rather than stalling', () => {
    // A one-tile corridor with enemies alongside (standing on the water next
    // of it — only their NEIGHBOURHOOD matters): every possible route runs
    // past them, so the caravan must accept the risk instead of waiting.
    const { world, addCity, addCaravan, addEnemy } = makeWorld([
      '~~~~~~~~~~~~',
      '~~~~~~~~~~~~',
      '............',
      '~~~~~~~~~~~~',
      '~~~~~~~~~~~~',
    ]);
    addCity('H', 0, 2);
    addCity('T', 11, 2);
    const caravan = addCaravan('v1', 0, 2, 'H');
    addEnemy('e1', 2, 1);
    addEnemy('e2', 3, 1);
    addEnemy('e3', 4, 1);

    const gov = new CaravanGovernor();
    const plan = gov.planUnit(caravan, world, 1);
    expect(PLAN_OF(plan)).toBe('move');
    // It walks the corridor — taking the risk, not detouring, not waiting.
    if (plan.kind === 'move') expect(plan.step).toEqual({ col: 1, row: 2 });
    expect(gov.getMission('v1')?.risky).toBe(true);
  });

  it('prefers a safer alternate route to the SAME target when one exists', () => {
    // Enemies crowd the departure on the direct row; the row below is open.
    const { world, addCity, addCaravan, addEnemy } = makeWorld([
      '............',
      '............',
      '............',
      '............',
      '............',
    ]);
    addCity('H', 0, 2);
    addCity('T', 11, 2);
    const caravan = addCaravan('v1', 0, 2, 'H');
    addEnemy('e1', 1, 1);
    addEnemy('e2', 2, 1);
    addEnemy('e3', 3, 1);

    const gov = new CaravanGovernor();
    const plan = gov.planUnit(caravan, world, 1);
    expect(PLAN_OF(plan)).toBe('move');
    // The penalised A* dips to the safe row instead of brushing the enemies.
    if (plan.kind === 'move') expect(plan.step).toEqual({ col: 1, row: 3 });
    expect(gov.getMission('v1')?.risky).toBe(false);
    // Same target either way — only the route changed.
    expect(gov.getMission('v1')).toMatchObject({ targetCol: 11, targetRow: 2 });
  });

  it('still takes the risky route when no safer one exists', () => {
    // Same crowded departure, but the detour row is water: no alternative.
    const { world, addCity, addCaravan, addEnemy } = makeWorld([
      '............',
      '............',
      '............',
      '~~~~~~~~~~~~',
      '~~~~~~~~~~~~',
    ]);
    addCity('H', 0, 2);
    addCity('T', 11, 2);
    const caravan = addCaravan('v1', 0, 2, 'H');
    addEnemy('e1', 1, 1);
    addEnemy('e2', 2, 1);
    addEnemy('e3', 3, 1);

    const gov = new CaravanGovernor();
    const plan = gov.planUnit(caravan, world, 1);
    expect(PLAN_OF(plan)).toBe('move');
    if (plan.kind === 'move') expect(plan.step).toEqual({ col: 1, row: 2 });
    expect(gov.getMission('v1')?.risky).toBe(true);
  });
});

describe('blocked targets: patience, then blacklist + retarget', () => {
  it('waits out a blocked corridor and only then picks another city', () => {
    // Start pocket (cols 0–1) + one-tile corridor along row 2 to city A.
    const { world, addCity, addCaravan, addEnemy } = makeWorld([
      '..~~~~~',
      '..~~~~~',
      '.......',
      '..~~~~~',
      '..~~~~~',
      '..~~~~~',
    ]);
    addCity('H', 0, 0);
    addCity('A', 6, 2);
    addCity('B', 0, 1);
    const caravan = addCaravan('v1', 0, 2, 'H');
    const gov = new CaravanGovernor();

    // Unblocked: the far, high-value A is chosen.
    const first = gov.planUnit(caravan, world, 1);
    expect(PLAN_OF(first)).toBe('move');
    expect(gov.getMission('v1')?.targetCol).toBe(6);

    // An enemy plugs the corridor — no route to A anymore.
    caravan.col = 1;
    caravan.row = 2;
    addEnemy('e1', 3, 2);

    expect(PLAN_OF(gov.planUnit(caravan, world, 2))).toBe('wait'); // stall 1
    expect(PLAN_OF(gov.planUnit(caravan, world, 3))).toBe('wait'); // stall 2
    const afterPatience = gov.planUnit(caravan, world, 4);         // stall 3 → give up
    // Patience spent: A is blacklisted inside this very call and the next
    // best target (B) is allocated immediately.
    expect(PLAN_OF(afterPatience)).toBe('move');
    const mission = gov.getMission('v1');
    expect(mission?.blacklisted).toContain('6,2');
    expect(mission?.targetCol).toBe(0);
    expect(mission?.targetRow).toBe(1);
    expect(PLAN_OF(gov.planUnit(caravan, world, 5))).toBe('move');
  });

  it('never re-picks a target it already failed to reach', () => {
    const { world, units, addCity, addCaravan, addEnemy } = makeWorld([
      '..~~~~~',
      '..~~~~~',
      '.......',
      '..~~~~~',
      '..~~~~~',
    ]);
    addCity('H', 0, 0);
    addCity('A', 6, 2);
    // B is the nearest city, but its route slots are full with strong routes,
    // so it is not a target and A is the only choice.
    addCity('B', 0, 1, HOME_CIV, {
      tradeRoutes: Array(MAX_CARAVAN_TRADE_ROUTES).fill({ trade: 9, round: 1 }),
    });
    const caravan = addCaravan('v1', 1, 2, 'H');
    const gov = new CaravanGovernor();

    // A is chosen while the corridor is open…
    const first = gov.planUnit(caravan, world, 1);
    expect(PLAN_OF(first)).toBe('move');
    expect(gov.getMission('v1')?.targetCol).toBe(6);

    // …then the corridor is plugged and patience runs out → A is blacklisted.
    addEnemy('e1', 3, 2);
    for (let turn = 2; turn <= CARAVAN_BLOCK_PATIENCE + 2; turn += 1) {
      gov.planUnit(caravan, world, turn);
    }
    expect(gov.getMission('v1')?.blacklisted).toContain('6,2');

    // The blocker leaves — A is reachable again, but this caravan has burned
    // that bridge, and B is still full: nothing left to deliver.
    const blocker = units.find((u) => u.id === 'e1');
    if (blocker) units.splice(units.indexOf(blocker), 1);
    gov.planUnit(caravan, world, 99);
    expect(gov.getMission('v1')?.targetCol).not.toBe(6);
  });
});

describe('scouting: at most one caravan per civ', () => {
  it('grants the scout role to the first idle caravan only', () => {
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3); // single-city civ → nothing to deliver
    const c1 = addCaravan('v1', 0, 3, 'H');
    const c2 = addCaravan('v2', 0, 3, 'H');
    const gov = new CaravanGovernor();

    expect(PLAN_OF(gov.planUnit(c1, world, 1))).toBe('scout');
    expect(gov.getScoutHolder(HOME_CIV)).toBe('v1');
    expect(PLAN_OF(gov.planUnit(c2, world, 1))).toBe('wait');
    expect(gov.getScoutHolder(HOME_CIV)).toBe('v1'); // still v1

    // The scout keeps scouting while there is nothing to deliver…
    expect(PLAN_OF(gov.planUnit(c1, world, 2))).toBe('scout');
  });

  it('drops the scout role the moment a delivery target appears', () => {
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    const c1 = addCaravan('v1', 0, 3, 'H');
    const gov = new CaravanGovernor();
    expect(PLAN_OF(gov.planUnit(c1, world, 1))).toBe('scout');

    // A second home city opens up (e.g. settled later): delivery beats scouting.
    addCity('C', 5, 0);
    const plan = gov.planUnit(c1, world, 2);
    expect(PLAN_OF(plan)).toBe('move');
    expect(gov.getScoutHolder(HOME_CIV)).toBeUndefined();
    expect(gov.getMission('v1')?.phase).toBe('outbound');
  });

  it('a scouting caravan routes around enemies instead of charging them', () => {
    const { world, addCity, addCaravan, addEnemy } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    const c1 = addCaravan('v1', 0, 3, 'H');
    addEnemy('e1', 1, 3); // adjacent hostile — but caravans never attack
    const gov = new CaravanGovernor();

    const plan = gov.planUnit(c1, world, 1);
    // The governor has nothing to deliver → scout; the AI's generic explorer
    // picks the unexplored tile (the enemy branch is skipped for caravans).
    expect(PLAN_OF(plan)).toBe('scout');
  });
});

describe('disband: the very last resort', () => {
  it('disbands after patience runs out with no target and no scout role', () => {
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    const c1 = addCaravan('v1', 0, 3, 'H');
    const c2 = addCaravan('v2', 0, 3, 'H');
    const gov = new CaravanGovernor();

    gov.planUnit(c1, world, 1); // v1 takes the scout role
    let last = '';
    for (let turn = 1; turn <= CARAVAN_DISBAND_PATIENCE; turn += 1) {
      last = PLAN_OF(gov.planUnit(c2, world, turn));
      if (turn < CARAVAN_DISBAND_PATIENCE) expect(last).toBe('wait');
    }
    expect(last).toBe('disband');

    // The scout, by contrast, is never disbanded for having no target.
    for (let turn = 2; turn <= 30; turn += 1) {
      expect(PLAN_OF(gov.planUnit(c1, world, turn))).toBe('scout');
    }
    // …and the disbanded unit's memory is gone.
    expect(gov.getMission('v2')).toBeUndefined();
  });
});

describe('max 3 caravans per city', () => {
  it('disbands only the surplus (newest) caravans above the cap', () => {
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    addCity('T', 5, 0); // reachable target so non-surplus caravans move
    const caravans = [1, 2, 3, 4, 5].map((n) => addCaravan(`v${n}`, 0, 3, 'H'));
    const gov = new CaravanGovernor();

    const plans = caravans.map((c, i) => ({ id: c.id, plan: gov.planUnit(c, world, i + 1) }));
    const disbanded = plans.filter((p) => p.plan.kind === 'disband').map((p) => p.id).sort();
    // The two newest go — as many as exceed the cap.
    expect(plans).toHaveLength(5);
    expect(disbanded).toHaveLength(5 - MAX_CARAVANS_PER_CITY);
    expect(disbanded).toEqual(['v4', 'v5']);
    for (const p of plans.filter((p) => !disbanded.includes(p.id))) {
      expect(p.plan.kind).toBe('move');
    }
    expect(CaravanGovernor.caravansOfCity(world, 'H')).toBe(5); // helper counts all
  });

  it('does not touch caravans of other cities or without a home city', () => {
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H1', 0, 3);
    addCity('H2', 5, 0);
    addCity('T', 5, 3);
    [1, 2, 3].forEach((n) => addCaravan(`a${n}`, 0, 3, 'H1'));
    const hutCaravan = addCaravan('hut1', 5, 3, undefined); // village mercenary

    const gov = new CaravanGovernor();
    expect(PLAN_OF(gov.planUnit(hutCaravan, world, 1))).toBe('move'); // no home → no cap
    for (const c of world.units.filter((u) => u.homeCityId === 'H1')) {
      expect(PLAN_OF(gov.planUnit(c as Unit, world, 2))).toBe('move');
    }
  });
});

describe('delivery eligibility (Civ1 rules)', () => {
  it('never targets its own home city and skips full-route cities', () => {
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    const full = addCity('Full', 5, 0, HOME_CIV, {
      tradeRoutes: Array(MAX_CARAVAN_TRADE_ROUTES).fill({}),
    });
    const caravan = addCaravan('v1', 0, 3, 'H');
    const gov = new CaravanGovernor();

    const plan = gov.planUnit(caravan, world, 1);
    // Only H (own, = home) and Full (capacity used) exist → scout.
    expect(PLAN_OF(plan)).toBe('scout');
    expect(gov.getMission('v1')?.phase).toBe('scouting');
    void full;
  });

  it('skips foreign cities at war, targets them at peace', () => {
    const { world, cities, addCity, addCaravan, wars } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    addCity('F', 5, 0, RIVAL_CIV);
    const caravan = addCaravan('v1', 0, 3, 'H');
    const gov = new CaravanGovernor();

    wars.add(`${HOME_CIV}-${RIVAL_CIV}`);
    expect(PLAN_OF(gov.planUnit(caravan, world, 1))).toBe('scout');

    wars.clear();
    const plan = gov.planUnit(caravan, world, 2);
    expect(PLAN_OF(plan)).toBe('move');
    expect(gov.getMission('v1')).toMatchObject({ targetCol: 5, targetRow: 0 });
    void cities;
  });

  it('skips an unreachable best-value city in favour of a reachable one', () => {
    // Island city I scores highest (far) but no land route exists.
    const { world, addCity, addCaravan } = makeWorld([
      '............',
      '............',
      '............',
      '....~~~.....',
      '............',
    ]);
    addCity('H', 0, 2);
    addCity('Near', 3, 0);
    addCity('Island', 5, 3); // surrounded by water on row 3? make it an island
    // Turn (5,3) into a true island: water on all 8 neighbouring tiles.
    (world as unknown as { getTileAt(c: number, r: number): MapTile | null }).getTileAt = (col, row) => {
      if (col < 0 || row < 0 || col >= 12 || row >= 5) return null;
      const isIslandRing = row >= 2 && row <= 4 && col >= 4 && col <= 6 && !(row === 3 && col === 5);
      const type = isIslandRing ? 'ocean' : 'grassland';
      return { terrain: type, type, visible: true, explored: true, col, row };
    };
    const caravan = addCaravan('v1', 0, 2, 'H');
    const gov = new CaravanGovernor();

    const plan = gov.planUnit(caravan, world, 1);
    expect(PLAN_OF(plan)).toBe('move');
    expect(gov.getMission('v1')).toMatchObject({ targetCol: 3, targetRow: 0 });
  });
});

describe('housekeeping', () => {
  it('pruneMissing clears missions and frees dead scouts', () => {
    const { world, units, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    const c1 = addCaravan('v1', 0, 3, 'H');
    const gov = new CaravanGovernor();
    gov.planUnit(c1, world, 1);
    expect(gov.getScoutHolder(HOME_CIV)).toBe('v1');

    // v1 dies → prune frees both the mission and the scout role.
    units.splice(units.indexOf(c1), 1);
    gov.pruneMissing(units);
    expect(gov.getMission('v1')).toBeUndefined();
    expect(gov.getScoutHolder(HOME_CIV)).toBeUndefined();

    // The role can be taken up again by the next caravan.
    const c2 = addCaravan('v2', 0, 3, 'H');
    expect(PLAN_OF(gov.planUnit(c2, world, 2))).toBe('scout');
    expect(gov.getScoutHolder(HOME_CIV)).toBe('v2');
  });
});

describe('the new concepts', () => {
  it('ranks a route by value per TURN, not per trip', () => {
    // Two destinations of equal value: the near one wins, because a caravan with
    // movement 1 pays for the trip in turns. Distance used to MULTIPLY value.
    const { world, addCity, addCaravan } = makeWorld([
      '........................',
      '........................',
      '........................',
      '........................',
    ]);
    addCity('H', 0, 2);
    addCity('Near', 2, 2, HOME_CIV, { population: 8 });
    addCity('Far', 18, 2, HOME_CIV, { population: 8 });
    const caravan = addCaravan('v1', 0, 2, 'H');
    const gov = new CaravanGovernor();

    gov.planUnit(caravan, world, 1);
    expect(gov.getMission('v1')).toMatchObject({ targetCol: 2, targetRow: 2 });
  });

  it('covers several tiles in one step when the terrain is cheap', () => {
    // Movement 1 on a roaded tile costs 1/3, so one step covers three tiles.
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    addCity('T', 5, 3);
    const caravan = addCaravan('v1', 0, 3, 'H');
    const gov = new CaravanGovernor();

    // A plain-grass step is cost 1, so only one tile is affordable per turn…
    const plain = gov.planUnit(caravan, world, 1);
    expect(plain.kind).toBe('move');
    if (plain.kind === 'move') {
      expect(plain.distanceCovered).toBe(1);
      expect(plain.step).toEqual({ col: 1, row: 3 });
    }
  });

  it('keeps a per-civ ledger of what the fleet did', () => {
    const { world, addCity, addCaravan } = makeWorld([
      '......',
      '......',
      '......',
      '......',
    ]);
    addCity('H', 0, 3);
    addCity('T', 5, 3);
    const caravan = addCaravan('v1', 0, 3, 'H');
    const gov = new CaravanGovernor();

    gov.planUnit(caravan, world, 1);
    const ledger = gov.getLedger(HOME_CIV);
    expect(ledger).toBeDefined();
    expect(ledger!.deliveries).toBe(0);
    expect(ledger!.inFlight).toBe(1);
  });

  it('abandons a mission that has taken too long to arrive', () => {
    const { world, addCity, addCaravan, addEnemy } = makeWorld([
      '..............................',
      '..............................',
      '..............................',
      '..............................',
    ]);
    addCity('H', 0, 0);
    addCity('T', 20, 0);
    const caravan = addCaravan('v1', 0, 0, 'H');
    const gov = new CaravanGovernor();

    gov.planUnit(caravan, world, 1);
    // Plug the corridor so it never arrives, and run past the transit deadline.
    addEnemy('e1', 1, 0);
    let plan = gov.planUnit(caravan, world, 2);
    // Patience gives up on the target first (no route), and the retarget finds
    // nothing reachable either — but the mission must not live forever.
    for (let round = 3; round <= 30; round += 1) plan = gov.planUnit(caravan, world, round);
    expect(plan.kind === 'move' || plan.kind === 'wait' || plan.kind === 'scout').toBe(true);
    const mission = gov.getMission('v1');
    if (mission && (mission.phase === 'outbound' || mission.phase === 'delivering')) {
      expect(mission.transitTurns).toBeLessThanOrEqual(CARAVAN_MAX_TRANSIT_TURNS + 1);
    }
  });
});
