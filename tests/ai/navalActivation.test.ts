/**
 * Naval activation + fleet coordination: the coordinator owns the gate that
 * starts the navy even when no mission was ever preset.
 *
 * Without it a sea world whose islands/enemies are still in fog never builds
 * its first hull (no hull → no contact → no mission → no hull).
 */
import { describe, it, expect } from 'vitest';
import { AICoordinator } from '@/game/engine/AI/AICoordinator';
import {
  desiredEscorts,
  desiredScouts,
  pickAffordableWarship,
  fleetNeed,
  scoreNavalTarget,
  scoreLandingSite,
  type AvailableShip,
} from '@/game/engine/AI/NavalDoctrine';

const FERRY: AvailableShip = { type: 'ferry', cost: 30, maintenance: 1, attack: 0, defense: 0, transportCapacity: 3 };
const TRIREME: AvailableShip = { type: 'trireme', cost: 80, maintenance: 2, attack: 3, defense: 2, transportCapacity: 0 };
const BATTLESHIP: AvailableShip = { type: 'battleship', cost: 280, maintenance: 6, attack: 18, defense: 12, transportCapacity: 0 };

const dist = (c1: number, r1: number, c2: number, r2: number) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));

describe('ensureNavalActivation', () => {
  const base = {
    needsNavy: true,
    landmassCount: 8,
    ownCoastalCities: 2,
    ownTransports: 0,
    ownWarships: 0,
    canBuildShips: true,
    hasColonyMission: false,
    hasInvasionMission: false,
    colonisableIslands: 0,
    seaInvasionTargets: 0,
    unexploredWaterShare: 0.8,
    atWar: false,
    troopsAvailable: true,
  };
  it('activates a bootstrap transport + scout on a dark archipelago', () => {
    const r = AICoordinator.ensureNavalActivation(base);
    expect(r.activate).toBe(true);
    expect(r.needsTransport).toBe(true);
  });
  it('stays quiet on a land map with no port', () => {
    const r = AICoordinator.ensureNavalActivation({ ...base, needsNavy: false, landmassCount: 1, ownCoastalCities: 0 });
    expect(r.activate).toBe(false);
  });
  it('demands an escort once troops are at sea with no screen', () => {
    const r = AICoordinator.ensureNavalActivation({ ...base, ownTransports: 1, colonisableIslands: 1, unexploredWaterShare: 0 });
    expect(r.needsEscort).toBe(true);
  });
  it('declares an emergency when at war across water with no hulls', () => {
    const r = AICoordinator.ensureNavalActivation({ ...base, atWar: true, seaInvasionTargets: 2, unexploredWaterShare: 0 });
    expect(r.activate).toBe(true);
    expect(r.reason).toMatch(/emergency/);
  });
});

describe('assignNavalEscorts', () => {
  it('pairs each transport with a screen, reusing when short', () => {
    const pairs = AICoordinator.assignNavalEscorts({ transportIds: ['t1', 't2', 't3'], warshipIds: ['w1'] });
    expect(pairs.get('t1')).toBe('w1');
    expect(pairs.get('t2')).toBe('w1');
    expect(pairs.get('t3')).toBe('w1');
  });
  it('marks transports unscreened when no warships exist', () => {
    const pairs = AICoordinator.assignNavalEscorts({ transportIds: ['t1'], warshipIds: [] });
    expect(pairs.get('t1')).toBeNull();
  });
});

describe('formNavalGroups', () => {
  it('glues escorts to their transports instead of hunting alone', () => {
    const pairs = new Map([['t1', 'w1']]);
    const groups = AICoordinator.formNavalGroups({
      transports: [{ id: 't1', col: 3, row: 2 }],
      warships: [{ id: 'w1', col: 4, row: 2, attack: 3 }],
      enemyFleets: [],
      enemyCoastalCities: [],
      escortPairs: pairs,
      distanceFn: dist,
    });
    const escort = groups.find((g) => g.mission === 'escort');
    expect(escort).toBeDefined();
    expect(escort!.shipIds).toContain('t1');
    expect(escort!.shipIds).toContain('w1');
  });
  it('forms hunter pairs for known enemy fleets', () => {
    const groups = AICoordinator.formNavalGroups({
      transports: [],
      warships: [
        { id: 'w1', col: 0, row: 0, attack: 3 },
        { id: 'w2', col: 1, row: 0, attack: 3 },
      ],
      enemyFleets: [{ col: 10, row: 10, strength: 6 }],
      enemyCoastalCities: [],
      distanceFn: dist,
    });
    expect(groups.some((g) => g.mission === 'hunt')).toBe(true);
  });
  it('leaves unescorted sealift visible as its own group', () => {
    const groups = AICoordinator.formNavalGroups({
      transports: [{ id: 't1', col: 3, row: 2 }],
      warships: [],
      enemyFleets: [],
      enemyCoastalCities: [],
      distanceFn: dist,
    });
    expect(groups.some((g) => g.mission === 'sealift')).toBe(true);
  });
});

describe('fleet mix helpers', () => {
  it('wants an escort per two transports', () => {
    expect(desiredEscorts(0, 0)).toBe(0);
    expect(desiredEscorts(1, 0)).toBe(1);
    expect(desiredEscorts(4, 4)).toBe(2);
  });
  it('wants scouts while water is dark', () => {
    expect(desiredScouts({
      treasury: 0, incomePerTurn: 0, upkeepPerTurn: 0, reservePerTurn: 0,
      ownTransports: 0, ownWarships: 0, ownCities: 3, ownCoastalCities: 2,
      threatenedOwnCoastalCities: 0, colonisableIslands: 0, seaInvasionTargets: 0,
      troopsAvailable: true, atWar: false, enemyTransports: 0, enemyWarships: 0,
      enemyCoastalCities: 0, bestAvailableShip: TRIREME, cheapestAvailableShip: FERRY,
      landmassCount: 8, needsNavy: true, unexploredWaterShare: 0.7,
    })).toBeGreaterThan(0);
  });
  it('picks a cheap screen when the battleship is out of reach', () => {
    const pick = pickAffordableWarship([TRIREME, BATTLESHIP], 100, 12, 5, 2);
    expect(pick?.type).toBe('trireme');
  });
  it('reports the fleet deficit in build order', () => {
    const need = fleetNeed({
      treasury: 0, incomePerTurn: 0, upkeepPerTurn: 0, reservePerTurn: 0,
      ownTransports: 0, ownWarships: 0, ownCities: 3, ownCoastalCities: 2,
      threatenedOwnCoastalCities: 0, colonisableIslands: 2, seaInvasionTargets: 0,
      troopsAvailable: true, atWar: false, enemyTransports: 0, enemyWarships: 0,
      enemyCoastalCities: 0, bestAvailableShip: TRIREME, cheapestAvailableShip: FERRY,
      wantTransports: 1, wantWarships: 2,
    });
    expect(need).toBe('transport');
  });
  it('gives raiders a merchant bonus and scouts a warship penalty', () => {
    const raiderVsMerchant = scoreNavalTarget({ targetClass: 'fisher_boat', distance: 5, attackerRole: 'raider' }).score;
    const raiderVsFleet = scoreNavalTarget({ targetClass: 'warship', distance: 5, attackerRole: 'raider' }).score;
    // Fisher (40+10) still below warship (90-6) in class order — role never flips class.
    expect(raiderVsFleet).toBeGreaterThan(raiderVsMerchant);
    const scoutVsScout = scoreNavalTarget({ targetClass: 'scout', distance: 5, attackerRole: 'scout' }).score;
    const scoutVsFleet = scoreNavalTarget({ targetClass: 'warship', distance: 5, attackerRole: 'scout' }).score;
    expect(scoutVsFleet).toBeGreaterThan(scoutVsScout); // class still dominates
  });
  it('lets siege guns crack a walled target', () => {
    const noGuns = scoreLandingSite({ ferryDistance: 2, landingForce: 10, targetCityDefence: 12, walledTarget: true });
    const guns = scoreLandingSite({ ferryDistance: 2, landingForce: 10, targetCityDefence: 12, walledTarget: true, siegePower: 12 });
    expect(noGuns.hopeless).toBe(true);
    expect(guns.hopeless).toBe(false);
    expect(guns.score).toBeGreaterThan(noGuns.score);
  });
});
