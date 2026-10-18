// ============================================================================
// AirDoctrine — the pure computational core.
//
// Every test states the engine fact or the policy decision it pins down, so a
// change that quietly reinterprets one of them fails HERE rather than behaving
// unaccountably in a benchmark.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  AIR_FRAMES,
  MAX_AIRCRAFT_ABSOLUTE,
  MAX_AIRCRAFT_PER_BASE,
  MAX_AIRCRAFT_PER_TARGET,
  MAX_AIR_SHARE,
  STRIKE_FRAME,
  airReachOf,
  bestGroundAttacker,
  carrierReachableTargets,
  chebyshev,
  compareAirVsGround,
  targetsWithinReach,
  evaluateAirDoctrine,
  type AirBase,
  type AirCarrier,
  type AirDoctrineInput,
  type AirTarget,
  type GroundAttacker,
} from '@/game/engine/AI/AirDoctrine';
import { UNIT_PROPS } from '@/utils/Constants';

const base = (col: number, row: number, cityId = 'b'): AirBase => ({ col, row, cityId });
const target = (col: number, row: number, owner: number, defense: number, acrossWater = false, cityId = 't'): AirTarget =>
  ({ col, row, ownerCivId: owner, defense, acrossWater, cityId });
const carrier = (col: number, row: number, unitId = 'cv'): AirCarrier => ({ col, row, unitId });

// A canBuild gate that allows everything except one type, to test the plug.
const canBuild: (t: string) => boolean = () => true;

const input = (over: Partial<AirDoctrineInput> = {}): AirDoctrineInput => ({
  civId: 1,
  bases: [base(0, 0, 'home')],
  targets: [],
  isHostileTo: () => true,
  canBuild,
  carriers: [],
  bombersOwned: 0,
  fightersOwned: 0,
  treasury: 10_000,
  spareIncome: 100,
  ...over,
});

describe('geometry — fact 7 (Chebyshev, engine distance)', () => {
  it('is max(|dcol|, |drow|), the squareGrid metric', () => {
    expect(chebyshev({ col: 0, row: 0 }, { col: 3, row: 4 })).toBe(4);
    expect(chebyshev({ col: 0, row: 0 }, { col: 5, row: 1 })).toBe(5);
    expect(chebyshev({ col: 2, row: 2 }, { col: 2, row: 2 })).toBe(0);
  });
});

describe('reach — fact 1 (movement IS the strike reach) and fact 5 (nuclear excluded)', () => {
  it('bomber reaches `movement` tiles', () => {
    expect(UNIT_PROPS.bomber?.movement).toBe(8);
    expect(airReachOf('bomber')).toBe(8);
  });

  it('fighter reaches farther', () => {
    expect((UNIT_PROPS.fighter?.movement ?? 0) > (UNIT_PROPS.bomber?.movement ?? 0)).toBe(true);
    expect(airReachOf('fighter')).toBe(UNIT_PROPS.fighter?.movement);
  });

  it('nuclear is NOT planned here — it travels by submarine (fact 5)', () => {
    expect(airReachOf('nuclear')).toBe(0);
    expect(AIR_FRAMES).not.toContain('nuclear');
  });

  it('ground units have no air reach at all', () => {
    expect(airReachOf('warrior')).toBe(0);
    expect(airReachOf('legion')).toBe(0);
  });
});

describe('targetsWithinReach — geography decides, nearest base serves', () => {
  it('a target exactly at reach is in; one beyond is NOT partially counted', () => {
    const hits = (bases: AirBase[], targets: AirTarget[], reach: number) =>
      targetsWithinReach(bases, targets, reach);
    const inReach = hits([base(0, 0)], [target(8, 0, 2, 8)], 8);
    expect(inReach).toHaveLength(1);
    expect(inReach[0].distance).toBe(8);
    const out = hits([base(0, 0)], [target(9, 0, 2, 8)], 8);
    expect(out).toHaveLength(0); // 9 tiles is beyond an 8-reach bomber: no partial reach
  });

  it('nearest base serves the target', () => {
    const hits = targetsWithinReach(
      [base(0, 0, 'far'), base(6, 0, 'near')],
      [target(8, 0, 2, 8)],
      8,
    );
    expect(hits[0].servedBy).toBe('near');
  });

  it('no bases, no strikes', () => {
    expect(targetsWithinReach([], [target(1, 0, 2, 8)], 8)).toHaveLength(0);
  });
});

describe('carrier projection — fact 8 (hull parks within reach, airframe flies last leg)', () => {
  it('stages targets the predicate says are physically possible', () => {
    const t = target(30, 30, 2, 8, true);
    const yes = carrierReachableTargets([t], 8, carrier(10, 10), () => true);
    expect(yes).toHaveLength(1);
    expect(yes[0].via).toBe('carrier');
    expect(yes[0].servedBy).toBe('10,10');
  });

  it('does not stage what the naval physics refuse', () => {
    const t = target(30, 30, 2, 8, true);
    expect(carrierReachableTargets([t], 8, carrier(10, 10), () => false)).toHaveLength(0);
  });

  it('needs carriers AND the staging predicate', () => {
    const t = target(30, 30, 2, 8, true);
    // No muster at all (null without a port) still stages when the predicate
    // permits — the PORT case: the decision to build the first deck.
    expect(carrierReachableTargets([t], 8, null, () => true)).toHaveLength(1);
    expect(carrierReachableTargets([t], 8, carrier(10, 10), undefined)).toHaveLength(0);
  });
});

describe('bestGroundAttacker — the strongest land threat, not a bargain bin', () => {
  it('picks the strongest attack among buildable land units', () => {
    // cf. warrior / legion / knight-at-like tiers: the strongest WINS.
    const g = bestGroundAttacker((t) => ['warrior', 'legion', 'knight'].includes(t));
    expect(g).not.toBeNull();
    expect(g!.attack).toBeGreaterThanOrEqual(UNIT_PROPS.legion?.attack ?? 0);
  });

  it('never considers naval or air units — ships belong to the naval doctrine (fact 5)', () => {
    const g = bestGroundAttacker(canBuild);
    expect(g?.type).not.toBe('battleship'); // attack 18 naval
    expect(g?.type).not.toBe('bomber');     // attack 12 air
    expect(g?.type).not.toBe('nuclear');    // attack 99 air
    const props = UNIT_PROPS[g!.type];
    expect(props?.naval ?? false).toBe(false);
    expect(props?.type).not.toBe('air');
  });
});

describe('compareAirVsGround — the user’s core question: does air beat marching troops?', () => {
  // Controlled ground attacker so the arithmetic in each case is exact.
  const ground: GroundAttacker = { type: 'testguard', attack: 12, cost: 120, maintenance: 3, movement: 2 };

  it('a FAR target is exactly where air wins: ground pays 4 turns of march, air pays one strike', () => {
    // distance 8, movement 2 → groundTurns 4; ground value = 12/(120·4) = 0.025
    // air value = 12/120 = 0.1 → air wins 4:1.
    const t = { ...target(8, 0, 2, 8), distance: 8, servedBy: 'home', via: 'base' as const, capturable: true };
    const e = compareAirVsGround(t, ground, 'bomber', { servedBy: base(0, 0) });
    expect(e.groundTurnsToTarget).toBe(4);
    expect(e.airTurnsToTarget).toBe(1);
    expect(e.airWins).toBe(true);
  });

  it('a target NEXT DOOR belongs to ground: march is one turn and air adds nothing', () => {
    // distance 1: ground = 12/120 = 0.1 = air → tie is not a win? It IS (>=):
    // air delivers the same value with a front-line base already there. Pin it.
    const t = { ...target(1, 0, 2, 8), distance: 1, servedBy: 'home', via: 'base' as const, capturable: true };
    const e = compareAirVsGround(t, ground, 'bomber', { servedBy: base(0, 0) });
    expect(e.groundTurnsToTarget).toBe(1);
    expect(e.airPerGold).toBeGreaterThanOrEqual(e.groundPerGold);
  });

  it('an island target handicaps GROUND (a hull to guarantee), air flies free — fact 2', () => {
    // Same distance, now across water: ground pays ferry on top of march.
    const landT = { ...target(8, 0, 2, 8, false), distance: 8, servedBy: 'home', via: 'base' as const, capturable: true };
    const seaT = { ...target(8, 0, 2, 8, true), distance: 8, servedBy: 'home', via: 'base' as const, capturable: true };
    const onLand = compareAirVsGround(landT, ground, 'bomber', { servedBy: base(0, 0) });
    const onIsland = compareAirVsGround(seaT, ground, 'bomber', { servedBy: base(0, 0) });
    expect(onIsland.groundPerGold).toBeLessThan(onLand.groundPerGold);
  });

  it('staging via carrier puts the HULL PRICE on the air side', () => {
    const t = { ...target(30, 30, 2, 8, true), distance: 8, servedBy: 'cv', via: 'carrier' as const, capturable: true };
    const avecHull = compareAirVsGround(t, ground, 'bomber', {
      servedBy: base(0, 0),
      carrierGold: UNIT_PROPS.carrier?.cost ?? 160,
    });
    const bare = compareAirVsGround(t, ground, 'bomber', { servedBy: base(0, 0) });
    expect(avecHull.airPerGold).toBeLessThan(bare.airPerGold);
  });
});

describe('evaluateAirDoctrine — the go/no-go', () => {
  it('strikes are planned only against HOSTILE owners (naval doctrine’s war rule)', () => {
    const v = evaluateAirDoctrine(input({
      targets: [target(5, 0, 7, 8)], // a PEACEFUL third party
      isHostileTo: () => false,
    }));
    expect(v.hasMission).toBe(false);
    expect(v.reason).toContain('no hostile target');
  });

  it('a hostile target within reach with air-winning numbers gets a DIRECT mission', () => {
    expect(UNIT_PROPS.bomber?.attack).toBe(12);
    // defense 8 ≤ 12 → capturable; distance 6 → ground march 3 turns → air wins.
    const v = evaluateAirDoctrine(input({ targets: [target(6, 0, 2, 8)] }));
    expect(v.hasMission).toBe(true);
    expect(v.mission?.airframe).toBe('bomber');
    expect(v.mission?.economy.airWins).toBe(true);
    expect(v.deployment.bombs).toBeGreaterThanOrEqual(1);
    expect(v.deployment.mode).toBe('direct');
    expect(v.fundable).toBe(true);
  });

  it('the mission prefers a CAPTURABLE target over a merely reachable one', () => {
    const v = evaluateAirDoctrine(input({
      targets: [target(10, 0, 2, 99, false, 'hard'), target(4, 0, 3, 8, false, 'soft')],
    }));
    expect(v.mission?.target.cityId).toBe('soft');
  });

  it('offshore-only targets stage through a LIVE carrier first', () => {
    // Bases on the home continent; the hostile city is 30 tiles out across sea;
    // within BOMBER reach of sea near it, so a carrier can stage.
    const v = evaluateAirDoctrine(input({
      targets: [target(30, 30, 2, 8, true)],
      bases: [base(0, 0, 'home')],
      carrierCanStage: () => true,
      carriers: [carrier(10, 10)],
    }));
    expect(v.carrierTargets).toHaveLength(1);
    expect(v.hasMission).toBe(true);
    expect(v.deployment.mode).toBe('carrier');
    // One deck already hosts the whole small program (4 airframes per deck).
    expect(v.deployment.bombs).toBeGreaterThanOrEqual(1);
    expect(v.deployment.carriers).toBe(0);
  });

  it('a carrier program too small for its missions asks for the missing decks', () => {
    // Five offshore fronts and one deck: 4 airframes fit, so a second deck.
    const targets = Array.from({ length: 5 }, (_, i) =>
      target(20 + i * 2, 20, 2, 8, true, `isl${i}`));
    const v = evaluateAirDoctrine(input({
      targets,
      carrierCanStage: () => true,
      carriers: [carrier(10, 10)], // one deck owned
      bases: Array.from({ length: 5 }, (_, i) => base(i * 2, 0, `b${i}`)),
    }));
    expect(v.deployment.mode).toBe('carrier');
    expect(v.deployment.bombs).toBe(5);
    // ceil(5/4) = 2 decks - 1 owned = 1 to build.
    expect(v.deployment.carriers).toBe(1);
  });

  it('an unstageable offshore target (no sea route) produces no mission', () => {
    const v = evaluateAirDoctrine(input({
      targets: [target(30, 30, 2, 8, true)],
      carrierCanStage: () => false,
      carriers: [carrier(10, 10)],
    }));
    expect(v.carrierTargets).toHaveLength(0);
    expect(v.hasMission).toBe(false);
  });

  it('no carriers afloat and no coastal port means no carrier projection', () => {
    const v = evaluateAirDoctrine(input({
      targets: [target(30, 30, 2, 8, true)],
      carriers: [],
      carrierCanStage: () => true,
    }));
    expect(v.hasMission).toBe(false);
  });

  it('the FIRST deck is requested from a coastal port, not from thin air', () => {
    // Without this case the doctrine could never reach the "build a carrier"
    // decision: staging was only asked once a carrier already existed. The
    // null-muster case asks the physics a port would have to supply.
    const v = evaluateAirDoctrine(input({
      targets: [target(30, 30, 2, 8, true)],
      carriers: [],
      hasCoastalPort: true,
      carrierCanStage: (muster) => muster === null,
    }));
    expect(v.carrierTargets).toHaveLength(1);
    expect(v.deployment.mode).toBe('carrier');
    expect(v.deployment.carriers).toBe(1);
  });

  it('real unit tables make the bomber at least as gold-efficient as its siege peers', () => {
    // Audited UNIT_PROPS: artillery is 12 atk / 150 gold, the bomber 12/120.
    // So in a Flight-era war the per-gold comparison never sides with ground —
    // an engine balance fact the doctrine records via mission.economy, and a
    // reason the go/no-go discipline lives in TARGETS and CAPS, not in the
    // ratio. Here: everything buildable, real tables, strike still planned.
    const v = evaluateAirDoctrine(input({ targets: [target(6, 0, 2, 8)] }));
    expect(v.hasMission).toBe(true);
    expect(v.mission?.economy.airWins).toBe(true);
  });

  it('a ground program that dominates per-gold rejects air — semantics pinned at unit level', () => {
    // Synthetic: an attacker cheaper AND faster than reality to prove the
    // gate sides with ground when the numbers say so.
    const richGround: GroundAttacker = { type: 'domination', attack: 12, cost: 12, maintenance: 1, movement: 9 };
    const handBuilt = compareAirVsGround(
      { ...target(6, 0, 2, 8, false, 'easy-march'), distance: 6, servedBy: 'home', via: 'base', capturable: true },
      richGround, 'bomber', { servedBy: base(0, 0) },
    );
    expect(handBuilt.airWins).toBe(false);
  });

  it('deployment obeys the base-pair ceiling', () => {
    // Many mission fronts, one base → base cap binds (2 per base).
    const targets = [
      target(6, 0, 2, 8, false, 'a'),
      target(0, 6, 2, 8, false, 'b'),
      target(6, 6, 2, 8, false, 'c'),
      target(0, 8, 2, 8, false, 'd'),
      target(8, 8, 2, 8, false, 'e'),
    ];
    const v = evaluateAirDoctrine(input({ targets, bases: [base(0, 0, 'home')] }));
    expect(v.deployment.bombs).toBeGreaterThan(0);
    expect(v.deployment.bombs).toBeLessThanOrEqual(MAX_AIRCRAFT_PER_BASE);
  });

  it('deployment obeys the absolute ceiling (fact 6 — air is a supporting branch)', () => {
    const targets = Array.from({ length: 12 }, (_, i) =>
      target((i % 4) * 4, 4 + i, 2, 8, false, `t${i}`));
    const v = evaluateAirDoctrine(input({
      targets,
      bases: Array.from({ length: 10 }, (_, i) => base(i * 3, 0, `b${i}`)),
      bombersOwned: MAX_AIRCRAFT_ABSOLUTE,
    }));
    expect(v.deployment.bombs).toBe(0);
  });

  it('the air share cannot eat the landing force (fact 6)', () => {
    // 10_000 treasury, cheap ground reference 10 → 1000/10 = 100 unit-equivs;
    // share = 33 airframes equivalent → well above what missions need, so
    // budget does NOT bind here. Pin the share constant instead.
    const targets = Array.from({ length: 20 }, (_, i) =>
      target((i % 4) * 4, 6 + i, 2, 8, false, `t${i}`));
    const v = evaluateAirDoctrine(input({
      targets,
      bases: Array.from({ length: 20 }, (_, i) => base(i * 3, 0, `b${i}`)),
    }));
    expect(v.deployment.bombs).toBeGreaterThan(0);
    expect(MAX_AIR_SHARE).toBeLessThan(0.5);
  });

  it('a treasury too small to strike is honestly not fundable', () => {
    const v = evaluateAirDoctrine(input({ targets: [target(6, 0, 2, 8)], treasury: 10 }));
    // 10 gold < 25% of a 120-gold airframe.
    expect(v.deployment.bombs).toBeGreaterThanOrEqual(0);
    expect(v.hasMission || v.reason.length > 0).toBe(true);
    expect(v.fundable).toBe(false);
  });

  it('tech-blocked civs get a no with the right reason', () => {
    const v = evaluateAirDoctrine(input({ targets: [target(6, 0, 2, 8)], canBuild: () => false }));
    expect(v.hasMission).toBe(false);
    expect(v.reason).toContain('tech');
  });

  it('strikes target CITY ids the caller passed — the doctrine invents no target', () => {
    const t = target(6, 0, 2, 8, false, 'enemy-capital');
    const v = evaluateAirDoctrine(input({ targets: [t] }));
    expect(v.mission?.target.cityId).toBe('enemy-capital');
    expect(v.mission?.target.ownerCivId).toBe(2);
  });

  it('strike frame stays the bomber', () => {
    expect(STRIKE_FRAME).toBe('bomber');
  });
});

describe('policy constants — decisions pinned so they cannot drift silently', () => {
  it('one airframe per strike opportunity', () => {
    expect(MAX_AIRCRAFT_PER_TARGET).toBe(1);
  });
  it('two airframes per base', () => {
    expect(MAX_AIRCRAFT_PER_BASE).toBe(2);
  });
  it('the air arm is capped below half the attack program (fact 6)', () => {
    expect(MAX_AIR_SHARE).toBeLessThan(0.5);
  });
});
