/**
 * The naval doctrine equation: how many hulls to buy, what to shoot at, and
 * where to put a landing force ashore.
 *
 * These are pure functions, so the whole policy is pinned here against
 * hand-written scenarios rather than a 400-round game. The behaviours that
 * motivated each term are in the module docblock.
 */
import { describe, it, expect } from 'vitest';
import {
  navalDoctrine,
  navalShipBudget,
  navalPressure,
  desiredTransports,
  scoreNavalTarget,
  classifyNavalTarget,
  scoreLandingSite,
  WARSHIP_TARGET_VALUE,
  type AvailableShip,
  type NavalDoctrineInput,
} from '@/game/engine/AI/NavalDoctrine';

/** A mid-game warship: expensive to buy and to keep. */
const BATTLESHIP: AvailableShip = {
  type: 'battleship', cost: 280, maintenance: 6, attack: 18, defense: 12, transportCapacity: 0,
};
/** The cheap early hull. */
const TRIREME: AvailableShip = {
  type: 'trireme', cost: 80, maintenance: 2, attack: 3, defense: 2, transportCapacity: 0,
};
/** The transport. */
const FERRY: AvailableShip = {
  type: 'ferry', cost: 30, maintenance: 1, attack: 0, defense: 0, transportCapacity: 3,
};

function input(over: Partial<NavalDoctrineInput> = {}): NavalDoctrineInput {
  return {
    treasury: 500,
    incomePerTurn: 40,
    upkeepPerTurn: 10,
    reservePerTurn: 10,
    ownTransports: 0,
    ownWarships: 0,
    ownCities: 4,
    ownCoastalCities: 2,
    threatenedOwnCoastalCities: 0,
    colonisableIslands: 0,
    seaInvasionTargets: 0,
    troopsAvailable: true,
    atWar: false,
    enemyTransports: 0,
    enemyWarships: 0,
    enemyCoastalCities: 0,
    bestAvailableShip: TRIREME,
    cheapestAvailableShip: FERRY,
    ...over,
  };
}

describe('naval budget', () => {
  it('is limited by what the treasury can buy up front', () => {
    // 150 gold of triremes at 80 each = 1, even though upkeep would allow more.
    expect(navalShipBudget(input({ treasury: 150, bestAvailableShip: TRIREME }))).toBeCloseTo(1.875);
  });

  it('is limited by what the treasury can sustain forever', () => {
    // surplus 20 at 2 gold/turn = 10 triremes, but only 4 are affordable now.
    expect(navalShipBudget(input({
      treasury: 320, incomePerTurn: 40, upkeepPerTurn: 10, reservePerTurn: 10, bestAvailableShip: TRIREME,
    }))).toBeCloseTo(4);
  });

  it('is zero when upkeep eats the whole economy', () => {
    // This is the guard: a civ already disbanding units for upkeep must stop
    // buying warships, or it feeds them straight back to the disbander.
    expect(navalShipBudget(input({
      treasury: 5000, incomePerTurn: 20, upkeepPerTurn: 25, reservePerTurn: 5, bestAvailableShip: BATTLESHIP,
    }))).toBe(0);
  });

  it('is zero when the civ has no naval technology', () => {
    expect(navalShipBudget(input({ bestAvailableShip: null }))).toBe(0);
  });

  it('is zero with no money at all', () => {
    expect(navalShipBudget(input({ treasury: 0 }))).toBe(0);
  });

  it('makes an expensive hull far harder to sustain than a cheap one', () => {
    const common = { treasury: 2000, incomePerTurn: 40, upkeepPerTurn: 10, reservePerTurn: 10 };
    const cheap = navalShipBudget(input({ ...common, bestAvailableShip: TRIREME }));
    const dear = navalShipBudget(input({ ...common, bestAvailableShip: BATTLESHIP }));
    expect(dear).toBeLessThan(cheap);
  });
});

describe('naval pressure', () => {
  it('is zero with no enemy fleet, no prizes and no threats', () => {
    expect(navalPressure(input())).toBe(0);
  });

  it('rises with the enemy fleet and saturates at 3', () => {
    expect(navalPressure(input({ enemyWarships: 1 }))).toBeCloseTo(1);
    expect(navalPressure(input({ enemyWarships: 2 }))).toBeCloseTo(2);
    // Saturates: ten enemy ships is not ten times the pressure of one.
    expect(navalPressure(input({ enemyWarships: 10 }))).toBeCloseTo(3);
  });

  it('rises with enemy coastal cities to raid, saturating at 2', () => {
    // Half our number of cities are theirs: pressure 1.
    expect(navalPressure(input({ enemyCoastalCities: 4 }))).toBeCloseTo(1);
    // Saturates: forty enemy cities is not forty times the pressure of four.
    expect(navalPressure(input({ enemyCoastalCities: 40 }))).toBeCloseTo(2);
  });

  it('rises when our own coast is threatened, saturating at 2', () => {
    expect(navalPressure(input({ threatenedOwnCoastalCities: 1, ownCoastalCities: 1 }))).toBeCloseTo(1);
    expect(navalPressure(input({ threatenedOwnCoastalCities: 2, ownCoastalCities: 1 }))).toBeCloseTo(2);
  });
});

describe('desired transports', () => {
  it('wants none when there is nothing to carry anywhere', () => {
    expect(desiredTransports(input({ troopsAvailable: false }))).toBe(0);
  });

  it('wants one for a reachable island', () => {
    expect(desiredTransports(input({ colonisableIslands: 1 }))).toBe(1);
  });

  it('wants one hull for many islands, because the hull is reused', () => {
    // A colony mission ends when the settler is put ashore, so the same hull
    // settles the next island on the next crossing. Hulls are needed for
    // SIMULTANEITY, not for the total number of objectives.
    expect(desiredTransports(input({ colonisableIslands: 3 }))).toBe(1);
  });

  it('wants a second hull when a colony and an invasion run at once', () => {
    expect(desiredTransports(input({ colonisableIslands: 2, seaInvasionTargets: 1 }))).toBe(2);
    expect(desiredTransports(input({ seaInvasionTargets: 1 }))).toBe(1);
  });

  it('never exceeds half a hull per city', () => {
    expect(desiredTransports(input({ colonisableIslands: 1, seaInvasionTargets: 1, ownCities: 1 }))).toBe(1);
  });
});

describe('naval doctrine', () => {
  it('builds nothing when there is no reason to sail at all', () => {
    // No island, no invasion target, no enemy fleet, no threat: a coastal civ
    // with nothing to cross water for should not buy a hull.
    const d = navalDoctrine(input());
    expect(d.wantTransports).toBe(0);
    expect(d.wantWarships).toBe(0);
    expect(d.choice).toBeNull();
  });

  it('builds a transport before any warship when there is somewhere to go', () => {
    // An island to settle AND an enemy fleet to worry about: the transport
    // wins, because a fleet of warships can neither settle nor invade.
    const d = navalDoctrine(input({ colonisableIslands: 2, enemyWarships: 3 }));
    expect(d.choice?.type).toBe('ferry');
    expect(d.reason).toMatch(/transport/);
  });

  it('builds a warship once the transports are covered and the enemy has a fleet', () => {
    const d = navalDoctrine(input({
      ownTransports: 2,
      enemyWarships: 2,
      bestAvailableShip: BATTLESHIP,
      cheapestAvailableShip: FERRY,
    }));
    expect(d.wantWarships).toBeGreaterThan(0);
    expect(d.choice?.type).toBe('battleship');
  });

  it('buys no warships when the civ cannot pay for them', () => {
    const d = navalDoctrine(input({
      ownTransports: 2,
      enemyWarships: 3,
      incomePerTurn: 20,
      upkeepPerTurn: 30,
      reservePerTurn: 5,
    }));
    expect(d.budget).toBe(0);
    expect(d.wantWarships).toBe(0);
    // …but the transports are still wanted, and the civ is bankrupt for them
    // too, so it builds nothing at all rather than a hull it cannot feed.
    expect(d.choice).toBeNull();
  });

  it('builds nothing once both the transports and the fleet are satisfied', () => {
    const d = navalDoctrine(input({
      ownTransports: 2,
      ownWarships: 4,
      enemyWarships: 1,
      bestAvailableShip: BATTLESHIP,
    }));
    expect(d.choice).toBeNull();
    expect(d.reason).toMatch(/satisfied/);
  });

  it('caps the fleet at one warship per city', () => {
    const d = navalDoctrine(input({
      ownTransports: 2,
      ownCities: 2,
      treasury: 99999,
      incomePerTurn: 9999,
      upkeepPerTurn: 0,
      reservePerTurn: 0,
      enemyWarships: 30,
      enemyCoastalCities: 30,
      threatenedOwnCoastalCities: 2,
      bestAvailableShip: BATTLESHIP,
    }));
    expect(d.wantWarships).toBeLessThanOrEqual(2);
  });

  it('never asks for a hull when the tech gives none', () => {
    const d = navalDoctrine(input({ bestAvailableShip: null, cheapestAvailableShip: null }));
    expect(d.choice).toBeNull();
    expect(d.reason).toMatch(/technology/);
  });

  it('picks the strongest hull it can build as the warship', () => {
    const d = navalDoctrine(input({ ownTransports: 2, enemyWarships: 1, bestAvailableShip: BATTLESHIP }));
    expect(d.choice?.type).toBe('battleship');
  });
});

describe('warship targeting', () => {
  it('ranks a loaded transport above everything else', () => {
    const transport = scoreNavalTarget({ targetClass: 'transport', distance: 10 });
    const warship = scoreNavalTarget({ targetClass: 'warship', distance: 1 });
    expect(transport.score).toBeGreaterThan(warship.score);
  });

  it('ranks the enemy fleet above coastal cities, cities above fishing boats, those above scouts', () => {
    const at = (targetClass: Parameters<typeof scoreNavalTarget>[0]['targetClass']) =>
      scoreNavalTarget({ targetClass, distance: 2 }).score;
    expect(at('transport')).toBeGreaterThan(at('warship'));
    expect(at('warship')).toBeGreaterThan(at('coastal_city'));
    expect(at('coastal_city')).toBeGreaterThan(at('fisher_boat'));
    expect(at('fisher_boat')).toBeGreaterThan(at('scout'));
  });

  it('lets distance break ties but not overturn a whole class', () => {
    // Two targets of the same class: nearer wins.
    const near = scoreNavalTarget({ targetClass: 'coastal_city', distance: 2 });
    const far = scoreNavalTarget({ targetClass: 'coastal_city', distance: 9 });
    expect(near.score).toBeGreaterThan(far.score);
    // …but a slightly nearer city must not beat a transport 10 tiles away.
    const nearCity = scoreNavalTarget({ targetClass: 'coastal_city', distance: 1 });
    const farTransport = scoreNavalTarget({ targetClass: 'transport', distance: 10 });
    expect(farTransport.score).toBeGreaterThan(nearCity.score);
  });

  it('values a partly loaded transport between an empty hull and a full one', () => {
    const empty = WARSHIP_TARGET_VALUE.other_naval;
    const half = scoreNavalTarget({ targetClass: 'transport', distance: 0, valueMultiplier: 0.6 + 0.4 * 0.5 }).score;
    const full = scoreNavalTarget({ targetClass: 'transport', distance: 0, valueMultiplier: 1 }).score;
    expect(half).toBeGreaterThan(empty);
    expect(half).toBeLessThan(full);
  });

  it('classifies hulls and cargo correctly', () => {
    expect(classifyNavalTarget({ type: 'ferry', transportCapacity: 3, cargoCount: 0 })).toBe('other_naval');
    expect(classifyNavalTarget({ type: 'ferry', transportCapacity: 3, cargoCount: 2 })).toBe('transport');
    expect(classifyNavalTarget({ type: 'battleship', attack: 18 })).toBe('warship');
    expect(classifyNavalTarget({ type: 'fisher_boat', attack: 0 })).toBe('fisher_boat');
    expect(classifyNavalTarget({ type: 'scout', attack: 0.5 })).toBe('scout');
  });
});

describe('landing-site scoring', () => {
  it('calls a beach hopeless when the force cannot take what defends it', () => {
    // 3 riflemen against a defended city — a suicide run.
    const bad = scoreLandingSite({
      ferryDistance: 2, landingForce: 9, beachDefence: 0, targetCityDefence: 20,
    });
    expect(bad.hopeless).toBe(true);
  });

  it('accepts a beach when the force outguns the defence by 1.5:1', () => {
    const ok = scoreLandingSite({
      ferryDistance: 2, landingForce: 30, beachDefence: 0, targetCityDefence: 20,
    });
    expect(ok.hopeless).toBe(false);
  });

  it('prefers a beach next to the objective over one far from it', () => {
    const nearCity = scoreLandingSite({
      ferryDistance: 2, landingForce: 30, targetCityDefence: 10, adjacentToTarget: true,
    });
    const away = scoreLandingSite({
      ferryDistance: 2, landingForce: 30, targetCityDefence: 10, adjacentToTarget: false,
    });
    expect(nearCity.score).toBeGreaterThan(away.score);
  });

  it('prefers a beach the hull can reach sooner', () => {
    const close = scoreLandingSite({ ferryDistance: 1, landingForce: 30 });
    const far = scoreLandingSite({ ferryDistance: 9, landingForce: 30 });
    expect(close.score).toBeGreaterThan(far.score);
  });

  it('prefers fertile ground for a colony', () => {
    const rich = scoreLandingSite({ ferryDistance: 3, landingForce: 0, tileYield: 6 });
    const bare = scoreLandingSite({ ferryDistance: 3, landingForce: 0, tileYield: 0 });
    expect(rich.score).toBeGreaterThan(bare.score);
  });

  it('penalises defended ground', () => {
    const open = scoreLandingSite({ ferryDistance: 3, landingForce: 60, beachDefence: 0 });
    const held = scoreLandingSite({ ferryDistance: 3, landingForce: 60, beachDefence: 10 });
    expect(open.score).toBeGreaterThan(held.score);
  });
});
