/**
 * Naval doctrine: how many hulls to build, of what kind, and what a warship
 * should shoot at.
 *
 * Deliberately pure — no engine, no DOM, no globals — so the whole equation can
 * be unit-tested against hand-written scenarios instead of a 400-round game.
 * `AIManager` supplies the inputs, `AutoProduction` acts on the result.
 *
 * The two questions answered here:
 *
 *  1. **Budget.** A battleship costs 6 gold/turn. A civ that cannot pay its
 *     upkeep already disbands units every turn, so the first gate is not "do I
 *     want a navy" but "can I sustain one":
 *
 *         surplus = income - upkeep - reserve
 *         budget  = min( treasury / cost , max(0, surplus) / maintenance )
 *
 *     `budget` is how many of the strongest available ships are simultaneously
 *     affordable — both up front and forever. With a negative surplus it is 0,
 *     which is the point: a bankrupt civ stops buying warships instead of
 *     feeding them straight back to the disbander.
 *
 *  2. **Pressure.** Budget says what we *can* have; pressure says how much of it
 *     is *warranted*:
 *
 *         pressure = min(3, enemyFleet / max(1, ownFleet))        // fleet ratio
 *                   + min(2, enemyCoastalCities / max(1, ownCities))  // spoils
 *                   + min(2, threatenedOwnCoast / max(1, ownCoastal)) // defence
 *         wantWarships = clamp(round(budget * pressure), 0, floor(budget))
 *
 *     Three terms because a navy is wanted for three different reasons: to
 *     out-build the enemy's fleet, to have something to aim at, and to keep an
 *     enemy fleet out of our own harbours. Each term saturates, so a single
 *     overwhelming enemy cannot talk the AI into a fleet it cannot feed.
 */

/** One naval unit the civ could actually build right now. */
export interface AvailableShip {
  type: string;
  cost: number;
  /** Gold per turn. */
  maintenance: number;
  attack: number;
  defense: number;
  /** How many land units the hull carries; 0 for a pure warship. */
  transportCapacity: number;
}

export interface NavalDoctrineInput {
  // ── economy ────────────────────────────────────────────────────────────
  /** Gold in the treasury right now. */
  treasury: number;
  /** Gold per turn at the civ's current tax rate. */
  incomePerTurn: number;
  /** Gold per turn already spent on unit + building upkeep. */
  upkeepPerTurn: number;
  /** Gold per turn we deliberately keep free (a war reserve). */
  reservePerTurn: number;

  // ── own force ──────────────────────────────────────────────────────────
  ownTransports: number;
  ownWarships: number;
  ownCities: number;
  ownCoastalCities: number;
  /** Own coastal cities currently threatened. */
  threatenedOwnCoastalCities: number;

  // ── opportunity and threat ─────────────────────────────────────────────
  /** Small city-free islands the civ could settle by sea. */
  colonisableIslands: number;
  /** Enemy cities on a landmass we cannot walk to. */
  seaInvasionTargets: number;
  /** Land units the civ has that a hull could carry. */
  troopsAvailable: boolean;
  atWar: boolean;

  // ── enemy force ────────────────────────────────────────────────────────
  enemyTransports: number;
  enemyWarships: number;
  /** Enemy cities on a coast we can sail to. */
  enemyCoastalCities: number;

  /** The strongest hull the civ has the technology for; null = cannot build ships. */
  bestAvailableShip: AvailableShip | null;
  /** The cheapest hull the civ has the technology for; null = no ships at all. */
  cheapestAvailableShip: AvailableShip | null;
}

export interface NavalDoctrineResult {
  /** Hulls carrying landing forces the civ should own in total. */
  wantTransports: number;
  /** Warships the civ should own in total. */
  wantWarships: number;
  /** Warships simultaneously affordable (see equation above). 0 = bankrupt. */
  budget: number;
  /** Raw pressure figure, for logging. */
  pressure: number;
  /** Which hull to build next, or null to build no ship at all. */
  choice: AvailableShip | null;
  /** Why the doctrine decided what it did — surfaced in the AI log. */
  reason: string;
}

/** Cap on transports relative to cities, so a naval civ still builds a city. */
const MAX_TRANSPORTS_PER_CITY = 0.5;
/** Hard ceiling on warships relative to cities. */
const MAX_WARSHIPS_PER_CITY = 1;
/** Never answer a capital-sized fleet even if the maths allows it. */
const MAX_WARSHIPS_ABSOLUTE = 12;
/**
 * Budget used when the caller supplied no economic data whatsoever. Two hulls:
 * enough to express intent (a transport plus an escort) without turning a
 * missing measurement into a build queue.
 */
const ECONOMY_UNMEASURED_BUDGET = 2;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * How many warships the treasury can sustain at once. Both halves matter: a civ
 * with a mountain of gold and a collapsing economy still gets 0.
 */
export function navalShipBudget(input: NavalDoctrineInput): number {
  const ship = input.bestAvailableShip;
  if (!ship || ship.cost <= 0) return 0;
  const surplus = input.incomePerTurn - input.upkeepPerTurn - input.reservePerTurn;
  // Upkeep eating the whole economy means 0 — but only when the figures are
  // actually known. A caller with no economic data at all (income, upkeep and
  // reserve all exactly zero) has not measured a bankruptcy, it has failed to
  // measure, and is allowed a nominal budget so the doctrine still expresses
  // intent. A measured surplus of zero or less is a real answer and gives 0.
  const economyMeasured = input.incomePerTurn > 0 || input.upkeepPerTurn > 0 || input.reservePerTurn > 0;
  if (surplus <= 0) {
    if (!economyMeasured) return ECONOMY_UNMEASURED_BUDGET;
    return 0;
  }
  const sustain = surplus / Math.max(1, ship.maintenance);
  const buy = input.treasury / ship.cost;
  return Math.max(0, Math.min(sustain, buy));
}

/**
 * How many landing-force hulls the civ should own.
 *
 * Not one hull per objective: a colony mission ends when the settler is put
 * ashore, so the same hull serves every island in turn. What actually forces a
 * SECOND hull is simultaneity — a colony mission and an invasion running at
 * once, which cannot share a hull that is already at sea. The hold size is
 * deliberately not a factor either: a bigger hold means a bigger landing force
 * per crossing, not more crossings to make.
 */
export function desiredTransports(input: NavalDoctrineInput): number {
  const hasIsland = input.colonisableIslands > 0;
  const hasInvasion = input.seaInvasionTargets > 0;
  if (!hasIsland && !hasInvasion) return 0;
  const want = hasIsland && hasInvasion ? 2 : 1;
  return clamp(want, 0, Math.max(1, Math.ceil(input.ownCities * MAX_TRANSPORTS_PER_CITY)));
}

/** How much of a fleet the situation warrants. See the module docblock. */
export function navalPressure(input: NavalDoctrineInput): number {
  const ownFleet = input.ownTransports + input.ownWarships;
  const enemyFleet = input.enemyTransports + input.enemyWarships;
  const fleetRatio = Math.min(3, enemyFleet / Math.max(1, ownFleet));
  const spoils = Math.min(2, input.enemyCoastalCities / Math.max(1, input.ownCities));
  const defence = Math.min(
    2,
    input.threatenedOwnCoastalCities / Math.max(1, input.ownCoastalCities),
  );
  const pressure = fleetRatio + spoils + defence;
  // Floor: a civ moving troops by sea with no warship at all is running an
  // undefended supply line, and fog of war means "I cannot see an enemy fleet"
  // is weak evidence that there is none. One escort hull is always warranted.
  if (input.ownTransports > 0 && input.ownWarships === 0) return Math.max(pressure, 1);
  return pressure;
}

/** The full doctrine decision. */
export function navalDoctrine(input: NavalDoctrineInput): NavalDoctrineResult {
  const budget = navalShipBudget(input);
  const pressure = navalPressure(input);
  const wantWarships = clamp(
    Math.round(budget * pressure),
    0,
    Math.min(MAX_WARSHIPS_ABSOLUTE, Math.floor(input.ownCities * MAX_WARSHIPS_PER_CITY), Math.floor(budget)),
  );
  const wantTransports = desiredTransports(input);

  let choice: AvailableShip | null = null;
  let reason: string;
  if (!input.bestAvailableShip) {
    reason = 'no ship the civ has the technology for';
  } else if (input.ownTransports < wantTransports) {
    choice = input.cheapestAvailableShip;
    reason = `needs ${wantTransports} transport${wantTransports === 1 ? '' : 's'}, has ${input.ownTransports}`;
  } else if (input.ownWarships < wantWarships) {
    choice = input.bestAvailableShip;
    reason = `fleet pressure ${pressure.toFixed(1)} × budget ${budget.toFixed(1)} = ${wantWarships} warship${wantWarships === 1 ? '' : 's'}, has ${input.ownWarships}`;
  } else {
    reason = `satisfied: ${input.ownTransports}/${wantTransports} transports, ${input.ownWarships}/${wantWarships} warships`;
  }
  return { wantTransports, wantWarships, budget, pressure, choice, reason };
}

// ──────────────────────────────────────────────────────────────────────────
// Warship targeting
// ──────────────────────────────────────────────────────────────────────────

/**
 * What a warship is for, in the order the doctrine prefers to use it.
 *
 * Transports first: a hull full of troops is a landing force the enemy cannot
 * easily replace, and killing it strands the force on the wrong shore. Enemy
 * warships come next — a raider that ignores the fleet sailing at it does not
 * get a second sortie. Then coastal cities (the actual prize), then the small
 * civilian hulls that fund the enemy's treasury, then scouts, which are the
 * least valuable kill.
 */
export const WARSHIP_TARGET_VALUE: Readonly<Record<NavalTargetClass, number>> = {
  transport: 100,
  warship: 90,
  coastal_city: 60,
  fisher_boat: 40,
  other_naval: 35,
  scout: 25,
};

export type NavalTargetClass =
  | 'transport'
  | 'warship'
  | 'coastal_city'
  | 'fisher_boat'
  | 'other_naval'
  | 'scout';

/**
 * How much a tile of distance is worth when comparing naval targets.
 *
 * Deliberately shallow: the class values are spaced 10-25 points apart, so at
 * 0.4 a target has to be roughly 25-60 tiles closer to overturn a whole class.
 * A warship will cross the map for a loaded transport, but it will not cross
 * the map to kill a fisher boat that a sail happened to be standing next to.
 */
const DISTANCE_WEIGHT = 0.4;

export interface NavalTargetScoreInput {
  targetClass: NavalTargetClass;
  /** Chebyshev distance from the considering ship to the target. */
  distance: number;
  /**
   * How much this particular target is worth beyond its class: a loaded
   * transport carries a whole landing force, a defended city is worth more
   * than an empty one. Multiplies the class value.
   */
  valueMultiplier?: number;
  /**
   * Whether the target is a unit (can be sunk and is lost to the enemy) as
   * opposed to a tile (a city, which is a position to be taken). A known, still
   * valid target is more valuable than a stale sighting.
   */
  isFresh?: boolean;
}

export interface NavalTargetScoreResult {
  score: number;
  targetClass: NavalTargetClass;
}

/**
 * Rank naval targets for one warship. Higher is better.
 *
 * The class value dominates and distance only ever breaks a near-tie: a
 * battleship that refuses to sail across the map to sink one transport would
 * simply sit at home.
 */
export function scoreNavalTarget({
  targetClass,
  distance,
  valueMultiplier = 1,
  isFresh = false,
}: NavalTargetScoreInput): NavalTargetScoreResult {
  const base = WARSHIP_TARGET_VALUE[targetClass] * Math.max(0, valueMultiplier);
  const freshness = isFresh ? 8 : 0;
  const score = base + freshness - Math.max(0, distance) * DISTANCE_WEIGHT;
  return { score, targetClass };
}

/** Classify a naval target from its type, cargo and threat. */
export function classifyNavalTarget(opts: {
  type: string;
  transportCapacity?: number;
  cargoCount?: number;
  attack?: number;
}): NavalTargetClass {
  const { type, transportCapacity = 0, cargoCount = 0, attack = 0 } = opts;
  if (transportCapacity > 0) {
    // A hull with troops aboard is a landing force; an empty one is only a
    // means of crossing water, which killing hurts but does not destroy.
    return cargoCount > 0 ? 'transport' : 'other_naval';
  }
  if (type === 'fisher_boat') return 'fisher_boat';
  if (type === 'scout') return 'scout';
  if (attack > 0.5) return 'warship';
  return 'other_naval';
}

// ──────────────────────────────────────────────────────────────────────────
// Landing-site evaluation
// ──────────────────────────────────────────────────────────────────────────

export interface LandingSiteInput {
  /** Chebyshev distance from the hull to the candidate beach. */
  ferryDistance: number;
  /** Attack power of the force aboard. */
  landingForce: number;
  /** Defensive strength of whatever stands on the beach (0 for empty land). */
  beachDefence?: number;
  /** Defensive strength of the city the beach serves (0 if none). */
  targetCityDefence?: number;
  /** Sum of food + production + trade on the beach tile. */
  tileYield?: number;
  /** True when the beach is next to the city we intend to capture. */
  adjacentToTarget?: boolean;
}

export interface LandingSiteScoreResult {
  score: number;
  /** True when this beach is expected to fail against what is defending it. */
  hopeless: boolean;
}

/**
 * Score a candidate beach. Returns `hopeless` when the force would be thrown
 * away: a warship's attack is not enough to storm a walled city, and the AI
 * should sail on rather than feed a landing force into a fortified town.
 *
 * The two distance terms are asymmetric on purpose: a beach that is far from
 * the hull is merely inconvenient, a beach that is close to a defended city is
 * a death trap.
 */
export function scoreLandingSite({
  ferryDistance,
  landingForce,
  beachDefence = 0,
  targetCityDefence = 0,
  tileYield = 0,
  adjacentToTarget = false,
}: LandingSiteInput): LandingSiteScoreResult {
  // The force has to beat what is in front of it. A roughly 1.5:1 margin is
  // the threshold below which an assault is a suicide run.
  const required = beachDefence + targetCityDefence;
  const hopeless = required > 0 && landingForce < required * 1.5;

  let score = 100;
  score -= ferryDistance * 6;        // cost of getting there
  score += adjacentToTarget ? 30 : 0; // a beach next to the prize is the point
  score -= required * 4;             // defended ground is bad ground
  score += Math.min(12, tileYield * 2); // for colonisation: is it worth living on
  return { score, hopeless };
}
