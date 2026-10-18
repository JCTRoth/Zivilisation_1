// ============================================================================
// Air Doctrine — whether aircraft are worth building and where to send them.
// ============================================================================
//
// Companion to `NavalDoctrine`: the same discipline (pure computational core,
// no engine state, every constant traceable to an audited engine fact), for the
// question the AI could not answer at all before this file existed.
//
// The audit that produced this file found the air branch was COMPLETELY DEAD:
// across benchmark games of 140 rounds no civilization ever researched Flight
// (each had 15–20 techs, none of them the air chain), so no bomber was ever
// built and the "air vs ground" tradeoff was never once made. The doctrine
// below answers it from engine facts.
//
// Engine facts this file is built on (audit, all verified in code):
//
//  1. REACH IS `movement`. Air units carry no separate range stat: a bomber's
//     `movement: 8` is how far it flies in one strike (fighter 10). There is
//     no "must return to base" rule in the movement code either.
//  2. AIR FLIES OVER EVERYTHING. `GameEngine.canUnitMoveTo`: water, lakes,
//     wide rivers and impassable ground are GROUND problems — `type: 'air'`
//     passes all of them. Distance itself is the whole delivery problem; a
//     strike needs no ferry, no beach, no river crossing.
//  3. AIR IGNORES CITY WALLS. `CombatSystem` (ignoresWalls): `unitClass ===
//     'air'` is exempt from wall defense.
//  4. AIR CAN TAKE A CITY. `moveUnit` blocks civilians from attacking cities;
//     air is not in that block, so `resolveCityCombat` runs — walls ignored,
//     per fact 3.
//  5. NUCLEAR IS NOT CITY AIRCRAFT. `type: 'air'` in the unit table, but it
//     TRAVELS by submarine (see GameEngine on `detonateNuclear` delivery) and
//     the naval doctrine decides the nuke↔sub pairing. Excluded here.
//  6. AIR CANNOT GARRISON. `AIManager.isGarrisonEligible` excludes air — a
//     bomber holding a city contributes nothing to martial law. Air is
//     therefore ALWAYS a supporting branch and must not starve the land arm.
//  7. DISTANCE IS CHEBYSHEV. Everything engine-side uses
//     `squareGrid.squareDistance` = max(|dcol|, |drow|).
//  8. CARRIER: `aircraftCapacity: 4`, `requires: flight` — the same tech as
//     the airframes, so a carrier program is never tech-blocked behind its
//     bombers. A carrier extends a strike by parking on a legal sea tile
//     within air reach of the target; the airframe flies the last leg.
// ============================================================================

import { UNIT_PROPS } from '@/utils/Constants';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface AirPoint {
  col: number;
  row: number;
}

/** A tile an airframe can strike from — today that is an own city. */
export interface AirBase extends AirPoint {
  cityId: string;
}

/** A known enemy city the doctrine considers striking. */
export interface AirTarget extends AirPoint {
  cityId: string;
  ownerCivId: number;
  /**
   * Estimated defense. Callers take this from `AIAggression.estimateCityDefense`
   * (or `UNKNOWN_CITY_DEFENSE` when the city is not yet scouted).
   */
  defense: number;
  /**
   * True when the target sits on a landmass no own city shares — ground
   * troops need a hull to get there, an airframe does not (fact 2). The
   * engine computes this from map landmasses; the doctrine only prices it.
   */
  acrossWater: boolean;
}

/** An own carrier afloat (or a coastal city used as a muster port). */
export interface AirCarrier extends AirPoint {
  unitId: string;
}

/** The best ground attacker of the era, for the strength-and-cost comparison. */
export interface GroundAttacker {
  type: string;
  attack: number;
  cost: number;
  maintenance: number;
  movement: number;
}

export interface AirDoctrineInput {
  civId: number;
  /**
   * Own cities that can host an airframe. Aircraft are built and repaired in
   * cities, so until carrier decks exist every base is a city tile.
   */
  bases: AirBase[];
  /** Known enemy cities. The doctrine filters to HOSTILE owners itself. */
  targets: AirTarget[];
  /** True when `civId` is at war with `otherCivId`. */
  isHostileTo: (otherCivId: number) => boolean;
  /** Tech gate — wire `canBuildUnit(civ, type)` from AITypes. */
  canBuild: (unitType: string) => boolean;
  /**
   * Naval-path physics, delegated to the engine: can a carrier sail from
   * `muster` and park on a sea tile within `reach` of `target`?
   *
   * `muster: null` means FROM OUR COAST — asked with zero carriers afloat, so
   * the doctrine can decide to BUILD the first deck. Without this case the
   * doctrine could never request a carrier: `carrierTargets` needed a carrier
   * to exist before asking for one. Cached by the caller; here it is just a
   * predicate.
   */
  carrierCanStage?: (muster: AirPoint | null, target: AirPoint, reach: number) => boolean;
  /**
   * True when any own city borders sea (the null-muster prerequisite).
   * The engine already knows this — `hasWaterAccess`.
   */
  hasCoastalPort?: boolean;
  carriers: AirCarrier[];
  bombersOwned: number;
  fightersOwned: number;
  treasury: number;
  /** Income minus all upkeep except the airframes under consideration. */
  spareIncome: number;
}

/** Why the doctrine said yes or no — surfaced in logs and benchmark diffs. */
export interface AirDoctrineVerdict {
  /** Reach per airframe, straight from the `movement` stat (fact 1). */
  reach: { bomber: number; fighter: number };
  /** Own cities that can host an airframe. */
  bases: AirBase[];
  /** Hostile cities a ground-based bomber can strike this turn (fact 2). */
  directTargets: ReachableTarget[];
  /** Hostile cities reachable once a carrier stages offshore (fact 8). */
  carrierTargets: ReachableTarget[];
  /** A strike mission was found AND the numbers beat marching troops. */
  hasMission: boolean;
  /** The mission the doctrine would fund — null when `hasMission` is false. */
  mission: AirMission | null;
  /** Targets exist AND the deployment fits the economy. */
  fundable: boolean;
  /** Deployment plan: how many airframes, and whether carriers are needed. */
  deployment: AirDeployment;
  /** One line explaining the answer, for logs and benchmark diffs. */
  reason: string;
}

export interface ReachableTarget extends AirTarget {
  /** Distance from the serving base to the target (Chebyshev, fact 7). */
  distance: number;
  /** Which base serves this target ('carrier' for carrier-staged strikes). */
  servedBy: string;
  /** `carrier` when the reach depends on a hull parking offshore. */
  via: 'base' | 'carrier';
  /** A single bomber pass meets estimated defense (facts 3+4) → city falls. */
  capturable: boolean;
}

export interface AirMission {
  target: ReachableTarget;
  /** The doctrine always plans the strike arm as bombers (fact 3, see below). */
  airframe: 'bomber';
  /** Economics — why air beats marching for THIS target. */
  economy: AirVsGround;
}

export interface AirDeployment {
  bombs: number;
  /** Escort cover, built only once the strike arm pays for itself. */
  fighters: number;
  /** Carriers the plan must build to stage offshore strikes. */
  carriers: number;
  mode: 'direct' | 'carrier' | 'none';
}

export interface AirVsGround {
  /** Bomber strike value per gold (attack / airframe cost). */
  airPerGold: number;
  /** Ground attacker's value per gold, penalized by march and ferry time. */
  groundPerGold: number;
  /** The ground unit considered. */
  ground: GroundAttacker;
  /** Turns ground needs to reach this target, ferry legs included. */
  groundTurnsToTarget: number;
  /** Air reaches a target within strike reach in ONE turn (fact 2). */
  airTurnsToTarget: number;
  /** True when air delivers strictly better value per gold on THIS target. */
  airWins: boolean;
}

// ---------------------------------------------------------------------------
// Policy constants — each is a decision, stated with its rationale
// ---------------------------------------------------------------------------

/**
 * Airframes this doctrine plans for.
 *
 * Nuclear excluded on purpose (fact 5). Fighters are not mission-scoped: with
 * a base attack of 4 they cannot crack `UNKNOWN_CITY_DEFENSE` (+8) — the
 * doctrine plans bombers as the strike arm and fighters as escort cover
 * (see `planDeployment`).
 */
export const AIR_FRAMES = ['bomber', 'fighter'] as const;

/** The strike arm. Bomber = 12 attack, 8 reach, 120 gold, walls ignored. */
export const STRIKE_FRAME = 'bomber' as const;

/** How many airframes one city hosts before it is saturated. */
export const MAX_AIRCRAFT_PER_BASE = 2;

/** Absolute airframe ceiling per civ — air is a supporting branch (fact 6). */
export const MAX_AIRCRAFT_ABSOLUTE = 8;

/** One strike opportunity: a second bomber on the same front adds nothing yet. */
export const MAX_AIRCRAFT_PER_TARGET = 1;

/**
 * The share of the attack program that may be spent in the sky.
 *
 * The denominator is the attackMarchForce it displaces, priced in ground units
 * — bombers cannot hold what they crack (fact 6), so the doctrine must never
 * let the air arm eat the landing force. A third of the program is the
 * ceiling; the ground alternative keeps the cities.
 */
export const MAX_AIR_SHARE = 1 / 3;

// ---------------------------------------------------------------------------
// Geometry — mirrors `squareGrid.squareDistance` (fact 7)
// ---------------------------------------------------------------------------

export function chebyshev(a: AirPoint, b: AirPoint): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/**
 * Strike reach of an airframe.
 *
 * The unit table has no range column: `movement` is the whole answer (fact 1).
 * Nuclear and everything non-air returns 0.
 */
export function airReachOf(unitType: string): number {
  if (!(AIR_FRAMES as readonly string[]).includes(unitType)) return 0;
  return UNIT_PROPS[unitType]?.movement ?? 0;
}

// ---------------------------------------------------------------------------
// Reach — what can the strike arm hit this turn?
// ---------------------------------------------------------------------------

/**
 * Which hostile targets a bomber based in one of `bases` can reach.
 *
 * Reach is binary: a bomber cannot "almost reach" — it either strikes this
 * turn or it is the wrong tool. The nearest base serves each target.
 */
export function targetsWithinReach(
  bases: AirBase[],
  targets: AirTarget[],
  reach: number,
  dist: (a: AirPoint, b: AirPoint) => number = chebyshev,
): ReachableTarget[] {
  if (reach <= 0 || bases.length === 0) return [];
  const out: ReachableTarget[] = [];
  for (const target of targets) {
    let best: { base: AirBase; distance: number } | null = null;
    for (const base of bases) {
      const distance = dist(base, target);
      if (distance > reach) continue;
      if (!best || distance < best.distance) best = { base, distance };
    }
    if (best) {
      out.push({
        ...target,
        distance: best.distance,
        servedBy: best.base.cityId,
        via: 'base',
        capturable: false,
      });
    }
  }
  return out;
}

/**
 * Which targets become reachable once a carrier stages offshore.
 *
 * Two inequalities decide it: the TARGET must lie within air reach of a legal
 * parking tile (the airframe flies the last leg), and a carrier must be able
 * to SAIL to that parking neighborhood (naval physics →
 * `carrierCanStage`, cached engine-side). A target 30 tiles from the nearest
 * sea is not projectable no matter where the carriers are.
 */
export function carrierReachableTargets(
  targets: AirTarget[],
  reach: number,
  muster: AirPoint | null,
  carrierCanStage?: (muster: AirPoint | null, target: AirPoint, reach: number) => boolean,
): ReachableTarget[] {
  if (reach <= 0 || !carrierCanStage) return [];
  if (muster === null && arguments.length === 0) return [];
  const out: ReachableTarget[] = [];
  for (const target of targets) {
    if (!carrierCanStage(muster, target, reach)) continue;
    out.push({
      ...target,
      distance: reach,
      servedBy: muster ? String(muster.col + ',' + muster.row) : 'port',
      via: 'carrier',
      capturable: false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Economics — air vs regular troops (facts 2, 3, 6)
// ---------------------------------------------------------------------------

/**
 * The best ground attacker the civ can field, for the comparison.
 *
 * "Best" is attack first, cheapness tiebreak: the doctrine compares DELIVERY
 * SYSTEMS against the strongest threat, not a bargain bin. Naval units are
 * excluded (ships do not walk into cities — that is the naval doctrine).
 */
export function bestGroundAttacker(
  canBuild: (unitType: string) => boolean,
): GroundAttacker | null {
  let best: GroundAttacker | null = null;
  for (const [type, props] of Object.entries(UNIT_PROPS)) {
    if (!props?.attack || props.attack <= 0) continue;
    if (props.naval) continue;
    if (UNIT_PROPS[type]?.type === 'air') continue;
    if (!canBuild(type)) continue;
    if (!best
      || props.attack > best.attack
      || (props.attack === best.attack && (props.cost ?? Infinity) < best.cost)) {
      best = {
        type,
        attack: props.attack,
        cost: props.cost ?? 0,
        maintenance: props.maintenance ?? 0,
        movement: props.movement ?? 1,
      };
    }
  }
  return best;
}

function cheapestGroundCost(canBuild: (type: string) => boolean): number | null {
  let best: number | null = null;
  for (const [type, props] of Object.entries(UNIT_PROPS)) {
    if (!props?.attack || props.attack <= 0 || props.naval) continue;
    if (props.type === 'air') continue;
    if (!canBuild(type)) continue;
    if (best === null || props.cost < best) best = props.cost;
  }
  return best;
}

const WARRIOR_FALLBACK: GroundAttacker = {
  type: 'warrior',
  attack: UNIT_PROPS.warrior?.attack ?? 1,
  cost: UNIT_PROPS.warrior?.cost ?? 10,
  maintenance: UNIT_PROPS.warrior?.maintenance ?? 0,
  movement: UNIT_PROPS.warrior?.movement ?? 1,
};

/**
 * Air vs ground for ONE target — the comparison the doctrine exists for.
 *
 * Both sides score "attack value per gold":
 *
 *  - AIR (fact 2): within strike reach, the attack lands in ONE turn, needs
 *    no ferry, ignores walls (fact 3). Value = bomber attack; cost = airframe.
 *  - GROUND: must MARCH from the serving base. `movement: 2` across 8 tiles
 *    is 4 turns in contact, and a target across water needs a ferry chain —
 *    priced as `ferryGold` (the naval program the troops require, or the
 *    carrier program air requires — the caller states it per mode). The
 *    delivered attack only lands on the march's LAST turn, so the average
 *    delivered value over the march is attack / turns; ferries add pure gold.
 *
 * `airWins` is allowed to be false — when the front is one tile away, marching
 * is nearly free and ground holds the city, so air should NOT be built just
 * because it flies. Air is for targets where distance, water or walls are
 * exactly what makes ground bad.
 */
export function compareAirVsGround(
  target: ReachableTarget,
  ground: GroundAttacker,
  airframeType: string = STRIKE_FRAME,
  opts: { carrierGold?: number; servedBy?: AirPoint; dist?: (a: AirPoint, b: AirPoint) => number } = {},
): AirVsGround {
  const reach = airReachOf(airframeType);
  const props = UNIT_PROPS[airframeType];
  const airCost = Math.max(1, props?.cost ?? 0);
  const airAttack = props?.attack ?? 0;

  // Both legs start from the same serving base so the comparison is fair:
  // ground marches from home even when air would stage via carrier, and the
  // ferry cost accompanies the GROUND estimate then (troops need a hull;
  // the airframe's carrier program is priced on the air side via ferryGold).
  const dist = opts.dist ?? chebyshev;
  const marchDistance = Math.max(1, dist(opts.servedBy ?? target, target));
  const groundTurns = Math.max(1, Math.ceil(marchDistance / Math.max(1, ground.movement)));

  // AIR side: the airframe, plus the carrier hull program when the strike is
  // staged offshore (the deck is bought for the mission). Cost, not turns —
  // the airframe strikes in turn one (fact 2), the hull sails on its own
  // schedule and the naval doctrine owns that march.
  const airGold = airCost + (opts.carrierGold ?? 0);

  // GROUND side: boots plus the hull the boots need when the target is an
  // island (priced as one ferry — see below) — and the march discount.
  const ferryGold = target.acrossWater ? (UNIT_PROPS.ferry?.cost ?? 30) : 0;
  const groundGold = Math.max(1, ground.cost + ferryGold) * groundTurns;

  const airPerGold = reach > 0 && airGold > 0 ? airAttack / airGold : 0;
  const groundPerGold = ground.attack / groundGold;

  return {
    airPerGold: round4(airPerGold),
    groundPerGold: round4(groundPerGold),
    ground,
    groundTurnsToTarget: groundTurns,
    airTurnsToTarget: reach > 0 ? 1 : 0,
    airWins: airPerGold > 0 && airPerGold >= groundPerGold,
  };
}

// ---------------------------------------------------------------------------
// The verdict — the entry point the engine calls
// ---------------------------------------------------------------------------

/**
 * Full evaluation: pass the world as data, get the plan back as data.
 *
 * Decision order, each stage rejecting for its own stated reason:
 *   1. geography  — hostile, within reach of bases or carrier-stageable
 *   2. capture    — a strike must be able to EARN the city, not dent it
 *   3. economics  — for each candidate, does air beat marching to it?
 *   4. deployment — counts fit the base/absolute/air-share caps
 */
export function evaluateAirDoctrine(input: AirDoctrineInput): AirDoctrineVerdict {
  const reach = {
    bomber: airReachOf(STRIKE_FRAME),
    fighter: airReachOf('fighter'),
  };

  // Hostile targets only — naval doctrine's precedent (`nextEnemyFromLand`
  // requires an actual war). An AI that opens wars from the sky without any
  // other consequence model is not aggressive, it is incomprehensible.
  const hostile = input.targets.filter((t) => input.isHostileTo(t.ownerCivId));

  const directTargets = targetsWithinReach(input.bases, hostile, reach.bomber);

  const alreadyServed = new Set(directTargets.map((t) => t.cityId));
  let carrierTargets: ReachableTarget[] = [];
  if (input.carrierCanStage) {
    // Staging is asked in DECREASING precedence: an afloat carrier first
    // (its position is known), else our own coast when the civ has a port —
    // that second case is what makes "build the first deck" a decision the
    // doctrine can actually reach, rather than a case it can never see.
    const offshore = hostile.filter((t) => !alreadyServed.has(t.cityId));
    let staged: ReachableTarget[] = [];
    if (input.carriers.length > 0) {
      staged = carrierReachableTargets(offshore, reach.bomber, input.carriers[0], input.carrierCanStage);
    } else if (input.hasCoastalPort === true) {
      staged = carrierReachableTargets(offshore, reach.bomber, null, input.carrierCanStage);
    }
    carrierTargets = staged;
  }

  // Capture test (facts 3+4): one pass, walls ignored, attack meets defense.
  const bomberAttack = UNIT_PROPS[STRIKE_FRAME]?.attack ?? 0;
  for (const t of directTargets) t.capturable = bomberAttack >= t.defense;
  for (const t of carrierTargets) t.capturable = bomberAttack >= t.defense;

  if (directTargets.length === 0 && carrierTargets.length === 0) {
    return none("no hostile target within strike reach", reach, input);
  }
  if (!input.canBuild(STRIKE_FRAME)) {
    return none('bomber tech missing', reach, input);
  }

  // Stage 3 — economics, target by target. The doctrine funds air only where
  // the airframe actually beats the march; if NO target clears that bar, the
  // answer is no even though targets were found.
  const ground = bestGroundAttacker(input.canBuild) ?? WARRIOR_FALLBACK;
  const candidates = [...directTargets, ...carrierTargets];
  const missions: AirMission[] = [];
  for (const target of candidates) {
    // Both delivery systems are measured from the nearest own base: ground
    // marches from home even when the strike stages via carrier.
    const serveFrom: AirPoint = nearestBase(input.bases, target);
    const economy = compareAirVsGround(target, ground, STRIKE_FRAME, {
      servedBy: serveFrom,
      carrierGold: target.via === 'carrier' ? (UNIT_PROPS.carrier?.cost ?? 160) : 0,
    });
    if (economy.airWins) missions.push({ target, airframe: STRIKE_FRAME, economy });
  }

  if (missions.length === 0) {
    return none(`targets found (${candidates.length}) but ground march wins every one`, reach, input);
  }

  // Stage 4 — deployment caps (the funding answer is stage 4 + budget).
  const deployment = planDeployment(input, missions, { ground });

  if (deployment.bombs === 0) {
    return none('deployment capped to zero airframes (bases/share/ceiling)', reach, input);
  }

  // Funds: the plan must be payable without starving the land arm.
  const bomberCost = UNIT_PROPS[STRIKE_FRAME]?.cost ?? 120;
  const carrierCost = UNIT_PROPS.carrier?.cost ?? 160;
  const need = deployment.bombs * bomberCost + deployment.carriers * carrierCost;
  const fundable = input.spareIncome >= (UNIT_PROPS[STRIKE_FRAME]?.maintenance ?? 3)
    && input.treasury >= need * 0.25;

  const pick = chooseMission(missions, deployment);
  return {
    reach,
    bases: input.bases,
    directTargets,
    carrierTargets,
    hasMission: !!pick,
    mission: pick,
    fundable,
    deployment,
    reason: pick
      ? `${deployment.mode} strike @${pick.target.cityId} ${Math.round(pick.target.distance)}tk`
      + ` (cap=${pick.target.capturable ? 'y' : 'n'}), air ${pick.economy.airPerGold}`
      + ` vs ground ${pick.economy.groundPerGold}/gold over ${pick.economy.groundTurnsToTarget}tk`
      + `${fundable ? '' : ' — NOT fundable'}`
      : 'no mission passed the economics gate',
  };
}

function planDeployment(
  input: AirDoctrineInput,
  missions: AirMission[],
  _ground: { ground: GroundAttacker },
): AirDeployment {
  const bomberCost = UNIT_PROPS[STRIKE_FRAME]?.cost ?? 120;
  const carrierCost = UNIT_PROPS.carrier?.cost ?? 160;

  // Missions × strike opportunities, never more than bases and the ceiling.
  const baseCap = input.bases.length * MAX_AIRCRAFT_PER_BASE;
  const missionCap = missions.length * MAX_AIRCRAFT_PER_TARGET;
  const missionBaseCap = Math.min(missionCap, baseCap, MAX_AIRCRAFT_ABSOLUTE);
  const owned = input.bombersOwned + input.fightersOwned;

  // Budget: the air arm may take at most MAX_AIR_SHARE of a comparable ground
  // program (fact 6 — bombers cannot hold the cities they crack, the ground
  // arm keeps them). Reference price: the cheapest attack unit the civ can
  // actually field, so an early empire is not forced to buy nothing.
  const groundRef = cheapestGroundCost(input.canBuild) ?? bomberCost;
  const budgetCap = Math.floor((input.treasury / Math.max(1, groundRef)) * MAX_AIR_SHARE)
    + owned;

  const bombs = Math.max(0, Math.min(missionBaseCap, budgetCap) - owned);
  const mode: AirDeployment['mode'] = bombs === 0
    ? 'none'
    : missions.every((m) => m.target.via === 'carrier')
      ? 'carrier'
      : 'direct';

  // Carriers: exactly the decks the plan's offshore missions need. One deck
  // hosts 4 airframes (fact 8) — a whole small air program on one hull, so
  // the plan never asks for a carrier FLEET, just a deck per flight of four.
  const carriersNeeded = mode === 'carrier'
    ? Math.max(0, Math.ceil(bombs / (UNIT_PROPS.carrier?.aircraftCapacity ?? 4)) - input.carriers.length)
    : 0;

  // Escort cover: 1 fighter per 3 bombers, only once the strike arm is real.
  const fighters = (!input.canBuild('fighter') || bombs === 0)
    ? 0
    : Math.floor(bombs / 3);

  void carrierCost;
  return { bombs, fighters, carriers: carriersNeeded, mode };
}

/**
 * The ONE mission the engine should act on: capturable first, then direct
 * beats carrier (a base launch is faster and hull-independent), then nearest.
 */
function chooseMission(missions: AirMission[], deployment: AirDeployment): AirMission | null {
  if (deployment.bombs === 0 || missions.length === 0) return null;
  return [...missions].sort((a, b) => {
    const capDiff = (b.target.capturable ? 1 : 0) - (a.target.capturable ? 1 : 0);
    if (capDiff !== 0) return capDiff;
    const viaW = (t: ReachableTarget) => (t.via === 'base' ? 0 : 1);
    const viaDiff = viaW(a.target) - viaW(b.target);
    if (viaDiff !== 0) return viaDiff;
    return a.target.distance - b.target.distance;
  })[0];
}

function nearestBase(bases: AirBase[], target: AirPoint): AirPoint {
  let best = bases[0];
  let bestDistance = Infinity;
  for (const b of bases) {
    const d = chebyshev(b, target);
    if (d < bestDistance) { bestDistance = d; best = b; }
  }
  return best;
}

function none(reason: string, reach: { bomber: number; fighter: number }, input: AirDoctrineInput): AirDoctrineVerdict {
  return {
    reach,
    bases: input.bases,
    directTargets: [],
    carrierTargets: [],
    hasMission: false,
    mission: null,
    fundable: false,
    deployment: { bombs: 0, fighters: 0, carriers: 0, mode: 'none' },
    reason,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
