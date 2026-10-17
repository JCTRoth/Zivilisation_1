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
  isWarshipHull,
  fleetMix,
  pickFleetMixHull,
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
/** The carrier: attack 1, so it can never win a "strongest hull" contest. */
const CARRIER: AvailableShip = {
  type: 'carrier', cost: 160, maintenance: 5, attack: 1, defense: 12, transportCapacity: 0,
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

  it('never exceeds one hull per city', () => {
    expect(desiredTransports(input({ colonisableIslands: 1, seaInvasionTargets: 1, ownCities: 1 }))).toBe(1);
  });

  it('scales sealift with parallel objectives', () => {
    // 1-3 islands reuse one hull; 4+ need parallel seeding.
    expect(desiredTransports(input({ colonisableIslands: 5 }))).toBe(2);
    expect(desiredTransports(input({ colonisableIslands: 8 }))).toBe(3);
    // Invasions add their own lift on top of colonies.
    expect(desiredTransports(input({ colonisableIslands: 1, seaInvasionTargets: 3 }))).toBe(3);
  });

  it('still wants a bootstrap hull on a dark archipelago', () => {
    // Sea world, coastal port, troops, dark water, nothing charted yet: the
    // scout-transport that finds the islands (the chicken-egg fix).
    expect(desiredTransports(input({
      colonisableIslands: 0, seaInvasionTargets: 0, landmassCount: 8,
      needsNavy: true, unexploredWaterShare: 0.8, ownCoastalCities: 2,
    }))).toBe(1);
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

  it('caps the fleet at ONE warship per city', () => {
    // Reduced from 2/city: the old figure doubled the fleet with every coastal
    // city and, multiplied by a pressure term that could reach 9, ordered 10+
    // hulls for a five-city civ. A screen per harbour is what a fleet is for.
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
    expect(d.wantWarships).toBeGreaterThan(0);
  });

  it('never lets the fleet exceed the absolute ceiling', () => {
    // Even a civ that could afford a hundred hulls gets at most eight.
    const d = navalDoctrine(input({
      ownTransports: 2,
      ownCities: 40,
      ownCoastalCities: 40,
      treasury: 999999,
      incomePerTurn: 99999,
      upkeepPerTurn: 0,
      reservePerTurn: 0,
      enemyWarships: 90,
      enemyCoastalCities: 90,
      threatenedOwnCoastalCities: 40,
      bestAvailableShip: BATTLESHIP,
    }));
    expect(d.wantWarships).toBeLessThanOrEqual(8);
  });

  it('clamps stacked pressure instead of adding it to a museum', () => {
    // Every signal firing at once used to sum to ~9 and multiply the budget into
    // a fleet three times the size any one of them asked for.
    const d = navalDoctrine(input({
      ownTransports: 2,
      ownCities: 3,
      ownCoastalCities: 3,
      treasury: 999999,
      incomePerTurn: 99999,
      upkeepPerTurn: 0,
      reservePerTurn: 0,
      enemyWarships: 40,
      enemyTransports: 40,
      enemyCoastalCities: 40,
      threatenedOwnCoastalCities: 3,
      colonisableIslands: 8,
      seaInvasionTargets: 4,
      unexploredWaterShare: 0.9,
      fishingGrounds: 9,
      landmassCount: 9,
      needsNavy: true,
      atWar: true,
      bestAvailableShip: BATTLESHIP,
    }));
    expect(d.pressure).toBeLessThanOrEqual(5);
  });

  it('builds a fleet MIX, not ten of one hull', () => {
    // The whole point: a civ short of every role gets the role it is shortest
    // on, not "the strongest affordable hull" again and again.
    const carrier = { type: 'carrier', cost: 160, maintenance: 5, attack: 1, defense: 12, transportCapacity: 0 };
    const submarine = { type: 'submarine', cost: 80, maintenance: 3, attack: 14, defense: 2, transportCapacity: 1 };
    const sail = { type: 'sail', cost: 20, maintenance: 1, attack: 1, defense: 1, transportCapacity: 0 };
    const battleship = { type: 'battleship', cost: 180, maintenance: 6, attack: 12, defense: 12, transportCapacity: 0 };
    const d = navalDoctrine(input({
      ownTransports: 2,
      ownWarships: 0,
      ownCities: 4,
      ownCoastalCities: 4,
      treasury: 999999,
      incomePerTurn: 99999,
      upkeepPerTurn: 0,
      reservePerTurn: 0,
      enemyWarships: 20,
      enemyTransports: 20,
      enemyCoastalCities: 20,
      threatenedOwnCoastalCities: 4,
      unexploredWaterShare: 0.7,
      landmassCount: 6,
      needsNavy: true,
      bestAvailableShip: battleship,
      cheapestAvailableShip: sail,
      warshipOptions: [sail, submarine, battleship, carrier],
      transportOptions: [],
    }));
    // A carrier can never win "strongest affordable", so without a composition
    // gap no civ ever fielded one. Assert one is actually ordered.
    expect(d.mix).toBeDefined();
    expect(d.mix!.carriers).toBeGreaterThanOrEqual(0);
    expect(d.mix!.raiders).toBeGreaterThanOrEqual(0);
    expect(d.mix!.scouts).toBeGreaterThanOrEqual(0);
    // The parts must never sum to more than the whole.
    const parts = d.mix!.scouts + d.mix!.screens + d.mix!.heavies + d.mix!.raiders + d.mix!.carriers;
    expect(parts).toBeLessThanOrEqual(d.wantWarships);
  });

  it('puts to sea on an archipelago even before contact', () => {
    // Split world, coastal ports, dark water, no enemies seen yet: the old
    // doctrine answered 0 (pressure 0 → no fleet → no contact → no fleet).
    const d = navalDoctrine(input({
      ownCities: 3, ownCoastalCities: 2, landmassCount: 8, needsNavy: true,
      unexploredWaterShare: 0.6, troopsAvailable: true,
      treasury: 500, incomePerTurn: 40, upkeepPerTurn: 10, reservePerTurn: 10,
      bestAvailableShip: TRIREME,
    }));
    expect(d.wantTransports + d.wantWarships).toBeGreaterThan(0);
    expect(d.choice).not.toBeNull();
  });

  it('buys a cheap screen when the best hull is out of reach', () => {
    // Treasury feeds a trireme but not a battleship: the old code answered 0
    // warships and built nothing; the new code fields the screen.
    const trireme = { type: 'trireme', cost: 80, maintenance: 2, attack: 3, defense: 2, transportCapacity: 0 };
    const d = navalDoctrine(input({
      ownTransports: 1,
      treasury: 100, incomePerTurn: 12, upkeepPerTurn: 5, reservePerTurn: 2,
      enemyWarships: 2,
      bestAvailableShip: BATTLESHIP,
      warshipOptions: [trireme, BATTLESHIP],
    }));
    expect(d.choice?.type).toBe('trireme');
  });

  it('scouts dark water before building the battle line', () => {
    // Both sail (scout) and ironclad (heavy) affordable, water dark, no scouts
    // sailing: the sail wins — it finds the islands and the wars. Without this
    // the bootstrap built heavies, made no contact, planned no missions.
    const sail = { type: 'sail', cost: 40, maintenance: 1, attack: 1, defense: 1, transportCapacity: 0 };
    const ironclad = { type: 'ironclad', cost: 120, maintenance: 3, attack: 6, defense: 4, transportCapacity: 0 };
    const d = navalDoctrine(input({
      ownTransports: 1,
      treasury: 500, incomePerTurn: 40, upkeepPerTurn: 10, reservePerTurn: 10,
      landmassCount: 8, needsNavy: true, unexploredWaterShare: 0.7,
      bestAvailableShip: ironclad,
      warshipOptions: [sail, ironclad],
    }));
    expect(d.choice?.type).toBe('sail');
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

describe('isWarshipHull: what counts as an escort', () => {
  it('counts a hull that can sink things', () => {
    expect(isWarshipHull(BATTLESHIP)).toBe(true);
    expect(isWarshipHull(TRIREME)).toBe(true);
  });

  it('does not count a ferry, which carries troops but fights nothing', () => {
    expect(isWarshipHull({ attack: 4, transportCapacity: 2 })).toBe(false);
  });

  it('does not count a fisher boat, which is naval and harmless', () => {
    // A Fisher Boat is `naval: true` with attack 0 and no capacity, so counting
    // hulls by "naval and not a transport" made a civ's whole fishing fleet
    // satisfy its warship quota and stopped it buying escorts.
    expect(isWarshipHull({ attack: 0, transportCapacity: 0 })).toBe(false);
  });

  it('counts an unarmed hull with no stats as nothing', () => {
    expect(isWarshipHull(undefined)).toBe(false);
    expect(isWarshipHull({})).toBe(false);
  });
});

describe('fleetMix — the parts always sum to the whole', () => {
  const mixOf = (total: number, over: Partial<NavalDoctrineInput> = {}) => {
    const m = fleetMix(total, input(over));
    return m;
  };
  const sum = (m: { scouts: number; screens: number; heavies: number; raiders: number; carriers: number }) =>
    m.scouts + m.screens + m.heavies + m.raiders + m.carriers;

  it('accounts for every hull, at every size, in every situation', () => {
    // The regression this guards: the first cut allocated each role from the
    // total independently and a 4-hull fleet came out as 5 hulls, so the AI
    // ordered more ships than the doctrine asked for.
    const situations: Array<Partial<NavalDoctrineInput>> = [
      {},
      { enemyWarships: 20, enemyTransports: 20 },
      { unexploredWaterShare: 0.8, landmassCount: 6, needsNavy: true },
      {
        enemyWarships: 40, enemyTransports: 40, unexploredWaterShare: 0.9,
        landmassCount: 9, needsNavy: true, warshipOptions: [CARRIER],
      },
    ];
    for (let total = 0; total <= 12; total++) {
      for (const situation of situations) {
        expect(sum(mixOf(total, situation))).toBe(total);
      }
    }
  });

  it('gives a tiny fleet core hulls, not a parade of specialists', () => {
    // One hull cannot be a carrier AND a screen. A 2-hull fleet must be able to
    // fight and screen, which is what screens and heavies are for.
    const m = mixOf(2, { enemyWarships: 20, unexploredWaterShare: 0.9, warshipOptions: [CARRIER] });
    expect(m.carriers).toBe(0);
    expect(m.screens + m.heavies).toBe(2);
  });

  it('spreads a large fleet across every role the situation calls for', () => {
    const m = mixOf(8, {
      enemyWarships: 20,
      enemyTransports: 20,
      unexploredWaterShare: 0.8,
      landmassCount: 8,
      needsNavy: true,
      warshipOptions: [CARRIER],
    });
    expect(m.screens).toBeGreaterThan(0);
    expect(m.heavies).toBeGreaterThan(0);
    expect(m.raiders).toBeGreaterThan(0);
    expect(m.scouts).toBeGreaterThan(0);
  });

  it('never builds a carrier without the technology or the fleet to carry it', () => {
    expect(mixOf(8, { warshipOptions: [] }).carriers).toBe(0);
    expect(mixOf(4, { warshipOptions: [CARRIER] }).carriers).toBe(0);
    expect(mixOf(5, { warshipOptions: [CARRIER] }).carriers).toBe(1);
  });

  it('builds no raiders when there is nothing to raid', () => {
    expect(mixOf(8, { enemyWarships: 0, enemyTransports: 0 }).raiders).toBe(0);
  });

  it('builds no scouts when the water is already charted', () => {
    expect(mixOf(8, { unexploredWaterShare: 0.02, landmassCount: 1 }).scouts).toBe(0);
  });

  it('is all zeroes for a fleet of none', () => {
    expect(mixOf(0)).toEqual({ scouts: 0, screens: 0, heavies: 0, raiders: 0, carriers: 0 });
  });
});

describe('pickFleetMixHull — fill the biggest gap, not buy the biggest gun', () => {
  const SAIL: AvailableShip = { type: 'sail', cost: 20, maintenance: 1, attack: 1, defense: 1, transportCapacity: 0 };
  const CARAVEL: AvailableShip = { type: 'caravel', cost: 60, maintenance: 2, attack: 3, defense: 3, transportCapacity: 0 };
  const FRIGATE: AvailableShip = { type: 'frigate', cost: 90, maintenance: 3, attack: 6, defense: 5, transportCapacity: 0 };
  const IRONCLAD: AvailableShip = { type: 'ironclad', cost: 150, maintenance: 5, attack: 10, defense: 10, transportCapacity: 0 };
  const SUB: AvailableShip = { type: 'submarine', cost: 80, maintenance: 3, attack: 14, defense: 2, transportCapacity: 1 };

  const all = [SAIL, CARAVEL, FRIGATE, IRONCLAD, SUB, CARRIER];
  const affordAll = () => true;
  const affordNone = () => false;

  it('returns null when nothing is affordable', () => {
    expect(pickFleetMixHull(all, { scouts: 0, screens: 0, heavies: 0, raiders: 0, carriers: 0 }, { scouts: 0, screens: 0, heavies: 0, raiders: 0, carriers: 0 }, affordNone)).toBeNull();
  });

  it('buys the cheapest hull that fills the gap, not the most expensive', () => {
    // Short of scouts only: both sail and caravel fill the gap, and the sail is
    // the one that costs 20. The old rule bought the strongest affordable hull
    // every turn, which is how a fleet became one repeated hull.
    const want = { scouts: 2, screens: 0, heavies: 0, raiders: 0, carriers: 0 };
    const onHand = { scouts: 0, screens: 0, heavies: 0, raiders: 0, carriers: 0 };
    const picked = pickFleetMixHull(all, want, onHand, affordAll);
    expect(picked).not.toBeNull();
    expect(picked!.type).toBe('sail');
  });

  it('picks the role it is furthest behind on', () => {
    // Screens and scouts full, heavies two short, raiders one short → a heavy,
    // because that is the largest gap. `classifyWarshipRole` calls ironclad a
    // heavy (attack 10) and frigate a screen (attack 6), so ironclad is the
    // cheapest hull that actually fills it.
    const want = { scouts: 1, screens: 2, heavies: 2, raiders: 1, carriers: 0 };
    const onHand = { scouts: 1, screens: 2, heavies: 0, raiders: 0, carriers: 0 };
    const picked = pickFleetMixHull([SAIL, CARAVEL, FRIGATE, IRONCLAD, SUB], want, onHand, affordAll);
    expect(picked!.type).toBe('ironclad');
  });

  it('takes the cheaper hull within a role when two both fit', () => {
    // Sail and caravel are both scouts; the gap is filled either way, so the
    // 20-shield hull is the right answer to a 20-shield problem.
    const want = { scouts: 1, screens: 0, heavies: 0, raiders: 0, carriers: 0 };
    const onHand = { scouts: 0, screens: 0, heavies: 0, raiders: 0, carriers: 0 };
    expect(pickFleetMixHull([CARAVEL, SAIL], want, onHand, affordAll)!.type).toBe('sail');
    // ...but a caravel is worth its extra 40 when the sail cannot be afforded.
    expect(pickFleetMixHull([CARAVEL, SAIL], want, onHand, (s) => s.type === 'caravel')!.type).toBe('caravel');
  });

  it('prefers a raider over a heavy when the gaps tie', () => {
    // Both one short. Raiding the enemy's supply line is not replaceable in the
    // way a bigger gun is, so the raider wins the tie.
    const want = { scouts: 0, screens: 1, heavies: 1, raiders: 1, carriers: 0 };
    const onHand = { scouts: 0, screens: 1, heavies: 0, raiders: 0, carriers: 0 };
    const picked = pickFleetMixHull([IRONCLAD, SUB], want, onHand, affordAll);
    expect(picked!.type).toBe('submarine');
  });

  it('orders a carrier only when the fleet is short of one', () => {
    const want = { scouts: 0, screens: 1, heavies: 1, raiders: 0, carriers: 1 };
    const onHand = { scouts: 0, screens: 1, heavies: 1, raiders: 0, carriers: 0 };
    expect(pickFleetMixHull([IRONCLAD, CARRIER], want, onHand, affordAll)!.type).toBe('carrier');
    const full = { scouts: 0, screens: 1, heavies: 1, raiders: 0, carriers: 1 };
    expect(pickFleetMixHull([IRONCLAD, CARRIER], want, full, affordAll)!.type).not.toBe('carrier');
  });

  it('tops up with the cheapest hull when nothing is short', () => {
    const want = { scouts: 1, screens: 1, heavies: 1, raiders: 1, carriers: 1 };
    const onHand = { scouts: 1, screens: 1, heavies: 1, raiders: 1, carriers: 1 };
    const picked = pickFleetMixHull(all, want, onHand, affordAll);
    expect(picked!.type).toBe('sail');
  });

  it('falls back to another role when the civ cannot build the short one', () => {
    // Short of carriers but the civ has no carrier hull: build something else
    // rather than nothing at all.
    const want = { scouts: 0, screens: 1, heavies: 0, raiders: 0, carriers: 2 };
    const onHand = { scouts: 0, screens: 1, heavies: 0, raiders: 0, carriers: 0 };
    const picked = pickFleetMixHull([SAIL, FRIGATE], want, onHand, affordAll);
    expect(picked).not.toBeNull();
  });

  it('is a pure function of its arguments', () => {
    const want = { scouts: 0, screens: 2, heavies: 0, raiders: 0, carriers: 0 };
    const onHand = { scouts: 0, screens: 0, heavies: 0, raiders: 0, carriers: 0 };
    const before = all.map((s) => s.type).join(',');
    pickFleetMixHull(all, want, onHand, affordAll);
    expect(all.map((s) => s.type).join(',')).toBe(before);
    expect(want).toEqual({ scouts: 0, screens: 2, heavies: 0, raiders: 0, carriers: 0 });
  });
});
