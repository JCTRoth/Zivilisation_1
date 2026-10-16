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
 *     Strategic fix: the budget is ALSO computed for the cheapest warship
 *     (`cheapBudget`). A civ that cannot feed a battleship but can feed a
 *     trireme gets the trireme — the old code answered 0 and built nothing,
 *     so late-game fleets never bootstrapped from cheap screens to heavies.
 *
 *  2. **Pressure.** Budget says what we *can* have; pressure says how much of it
 *     is *warranted*:
 *
 *         pressure = min(3, enemyFleet / max(1, ownFleet))        // fleet ratio
 *                   + min(2, enemyCoastalCities / max(1, ownCities))  // spoils
 *                   + min(2, threatenedOwnCoast / max(1, ownCoastal)) // defence
 *                   + archipelago baseline (1.0 when split world + coast)
 *                   + war across water (+1.0) + colony/invasion escort (+0.5…)
 *                   + dark-water pickets (+0.5) + fishing protection (+0.5)
 *         wantWarships = clamp(round(max(budget, cheap*0.5) * pressure), …)
 *
 *     The archipelago terms are the point: a sea world needs a fleet to
 *     FUNCTION (find islands, meet enemies, guard fishing), not just to answer
 *     one. Without them pressure is 0 until contact — and contact needs hulls,
 *     so the fleet never starts (the naval chicken-egg).
 *
 *  3. **Sealift.** Transports scale with parallelism, not binary presence:
 *     1 hull for 1-3 islands, 2 for 4-6, 3 for 7+, plus 1 per invasion target
 *     (and +1 per two further targets for reinforcement waves). A sea world
 *     with dark water still wants 1 scout-transport to go and chart it.
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
  /** Warships split by role, when the caller tracks them (else 0). */
  ownScouts?: number;
  ownHeavies?: number;
  ownRaiders?: number;
  ownCarriers?: number;
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

  // ── strategic context (all optional; absent = old land-map behaviour) ──
  /** Total landmasses on the map (1 = one continent). */
  landmassCount?: number;
  /** True when the world is split by water and needs a fleet to function. */
  needsNavy?: boolean;
  /** Share of the map's water the civ has NOT yet explored (0..1). */
  unexploredWaterShare?: number;
  /** Own fishing grounds that need protection (0 when none/fleet handles it). */
  fishingGrounds?: number;
  /** Enemy fleet quality: summed attack power (defaults to hull count). */
  enemyFleetPower?: number;
  /** Own fleet quality: summed attack power (defaults to hull count). */
  ownFleetPower?: number;

  /** The strongest hull the civ has the technology for; null = cannot build ships. */
  bestAvailableShip: AvailableShip | null;
  /** The cheapest hull the civ has the technology for; null = no ships at all. */
  cheapestAvailableShip: AvailableShip | null;
  /** Every warship hull the tech allows, strongest last (for affordable choice). */
  warshipOptions?: AvailableShip[];
  /** Every transport hull the tech allows, cheapest first. */
  transportOptions?: AvailableShip[];
}

export interface NavalDoctrineResult {
  /** Hulls carrying landing forces the civ should own in total. */
  wantTransports: number;
  /** Warships the civ should own in total. */
  wantWarships: number;
  /** Scout hulls wanted (fast, cheap, for exploration/picket). */
  wantScouts?: number;
  /** Heavy line-of-battle ships wanted (for sea control/siege). */
  wantHeavies?: number;
  /** Escorts wanted to screen the sealift (1 per 2 transports, min 1). */
  wantEscorts?: number;
  /** Warships simultaneously affordable (see equation above). 0 = bankrupt. */
  budget: number;
  /** Cheapest-warship budget: hulls affordable even when the best is not. */
  cheapBudget?: number;
  /** Raw pressure figure, for logging. */
  pressure: number;
  /** Which hull to build next, or null to build no ship at all. */
  choice: AvailableShip | null;
  /** Why the doctrine decided what it did — surfaced in the AI log. */
  reason: string;
}

/** Cap on transports: a sealift per coastal city, so a naval civ still builds cities. */
const MAX_TRANSPORTS_PER_CITY = 1.0;
/** Absolute ceiling on transports: parallel colony + invasion + shuttle waves. */
const MAX_TRANSPORTS_ABSOLUTE = 6;
/** Warships per coastal city on a sea map: a screen plus a heavy per harbour. */
const MAX_WARSHIPS_PER_CITY = 2;
/** Never answer a capital-sized fleet even if the maths allows it. */
const MAX_WARSHIPS_ABSOLUTE = 16;
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
  return navalShipBudgetFor(ship, input.treasury, input.incomePerTurn, input.upkeepPerTurn, input.reservePerTurn);
}

/**
 * Budget for ONE hull type: min(what we can buy now, what we can feed forever).
 * Split out so the doctrine can ask "the battleship is out of reach, but is a
 * trireme affordable?" instead of answering 0 for the whole fleet.
 */
function navalShipBudgetFor(
  ship: AvailableShip,
  treasury: number,
  incomePerTurn: number,
  upkeepPerTurn: number,
  reservePerTurn: number,
): number {
  if (!ship || ship.cost <= 0) return 0;
  const surplus = incomePerTurn - upkeepPerTurn - reservePerTurn;
  const economyMeasured = incomePerTurn > 0 || upkeepPerTurn > 0 || reservePerTurn > 0;
  if (surplus <= 0) {
    if (!economyMeasured) return ECONOMY_UNMEASURED_BUDGET;
    return 0;
  }
  const sustain = surplus / Math.max(1, ship.maintenance);
  const buy = treasury / ship.cost;
  return Math.max(0, Math.min(sustain, buy));
}

/** Cheapest warship budget: what the civ can field even when the best is dear. */
function navalCheapBudget(input: NavalDoctrineInput): number {
  const options = (input.warshipOptions ?? []).filter((s) => s.cost > 0);
  if (options.length === 0) return navalShipBudget(input);
  let best = 0;
  for (const ship of options) {
    best = Math.max(best, navalShipBudgetFor(ship, input.treasury, input.incomePerTurn, input.upkeepPerTurn, input.reservePerTurn));
  }
  return best;
}

/**
 * How many landing-force hulls the civ should own.
 *
 * Not one hull per objective: a colony mission ends when the settler is put
 * ashore, so the same hull serves every island in turn. What forces MORE hulls
 * is parallelism — several islands to seed at once, an invasion running beside
 * the colony run, and a shuttle wave behind the first landing. The hold size is
 * deliberately not a factor: a bigger hold means a bigger force per crossing,
 * not more crossings to make.
 *
 * Strategic scaling (the "significant improvement" over the old 1-or-2 rule):
 *   islands 1-3 → 1 hull (reused in turn, as before)
 *   islands 4-6 → 2 hulls (parallel seeding)
 *   islands 7+  → 3 hulls
 *   invasion targets add their own lift: 1 hull for the first target, +1 per
 *   two further targets (a second beach, a reinforcement wave).
 *   an archipelago that NEEDS a navy but shows no island yet (unexplored fog)
 *   still wants 1 hull: the scout-transport that finds the islands. Without
 *   this the fleet never bootstraps — no hull to explore means no island ever
 *   seen means no hull ever built.
 */
export function desiredTransports(input: NavalDoctrineInput): number {
  const islands = Math.max(0, Math.floor(input.colonisableIslands));
  const invasions = Math.max(0, Math.floor(input.seaInvasionTargets));
  const archipelago = (input.landmassCount ?? 1) > 1 || input.needsNavy === true;
  const unexplored = input.unexploredWaterShare ?? 0;

  let want = 0;
  if (islands > 0) {
    if (islands <= 3) want += 1;
    else if (islands <= 6) want += 2;
    else want += 3;
  }
  if (invasions > 0) {
    want += 1 + Math.floor((invasions - 1) / 2);
  }
  // Proactive sealift: a sea world with a coast but nothing charted yet still
  // needs a hull to go and chart it. Gated on troops (nothing to carry = no
  // hull) and on coastal access (no port = no hull).
  if (want === 0 && archipelago && input.troopsAvailable && input.ownCoastalCities > 0) {
    if (unexplored > 0.15 || islands === 0) want = 1;
  }
  if (want === 0) return 0;
  const cap = Math.min(
    MAX_TRANSPORTS_ABSOLUTE,
    Math.max(1, Math.ceil(input.ownCities * MAX_TRANSPORTS_PER_CITY)),
  );
  return clamp(want, 0, cap);
}

/** Escorts to screen the sealift: 1 per 2 transports, at least 1 once we sail troops. */
export function desiredEscorts(wantTransports: number, ownTransports: number): number {
  const sailing = Math.max(wantTransports, ownTransports);
  if (sailing <= 0) return 0;
  return clamp(Math.ceil(sailing / 2), 1, 4);
}

/** Scout hulls for a sea world: one picket per 2 coastal cities while water is dark. */
export function desiredScouts(input: NavalDoctrineInput): number {
  const archipelago = (input.landmassCount ?? 1) > 1 || input.needsNavy === true;
  if (!archipelago || input.ownCoastalCities === 0) return 0;
  const unexplored = input.unexploredWaterShare ?? 0;
  if (unexplored < 0.1 && input.colonisableIslands === 0 && input.seaInvasionTargets === 0) return 0;
  return clamp(Math.ceil(input.ownCoastalCities / 2), 1, 3);
}

/** How much of a fleet the situation warrants. See the module docblock. */
export function navalPressure(input: NavalDoctrineInput): number {
  const ownFleetPower = input.ownFleetPower ?? (input.ownTransports + input.ownWarships);
  const enemyFleetPower = input.enemyFleetPower ?? (input.enemyTransports + input.enemyWarships);
  const fleetRatio = Math.min(3, enemyFleetPower / Math.max(1, ownFleetPower));
  const spoils = Math.min(2, input.enemyCoastalCities / Math.max(1, input.ownCities));
  const defence = Math.min(
    2,
    input.threatenedOwnCoastalCities / Math.max(1, input.ownCoastalCities),
  );
  let pressure = fleetRatio + spoils + defence;

  // Sea-control baseline: on a split world a coastal civ needs a fleet to
  // FUNCTION (reach islands, meet enemies, protect fishing), not just to
  // answer one. Without this the doctrine is 0 until contact — and contact
  // needs hulls, so the fleet never starts.
  const archipelago = (input.landmassCount ?? 1) > 1 || input.needsNavy === true;
  if (archipelago && input.ownCoastalCities > 0) {
    pressure += 1.0;
    // War across water is a fleet problem even with no hulls counted yet.
    if (input.atWar && (input.seaInvasionTargets > 0 || input.enemyCoastalCities > 0)) {
      pressure += 1.0;
    }
    // Colony sealift without an escort is an undefended supply line.
    if (input.colonisableIslands > 0) pressure += 0.5;
    if (input.seaInvasionTargets > 0) pressure += 0.5 * Math.min(2, input.seaInvasionTargets);
    // Dark water wants pickets: a hull that sees the enemy fleet early is
    // worth more than one built after the landing.
    if ((input.unexploredWaterShare ?? 0) > 0.3) pressure += 0.5;
    // Fishing grounds pay the treasury; a raider that eats them eats the fleet.
    if ((input.fishingGrounds ?? 0) > 0) pressure += 0.5;
  } else {
    // Land world: invasion targets still want a small escort force.
    if (input.seaInvasionTargets > 0) pressure += 0.5 * Math.min(2, input.seaInvasionTargets);
    if (input.colonisableIslands > 0) pressure += 0.5;
  }

  // Floor: a civ moving troops by sea with no warship at all is running an
  // undefended supply line, and fog of war means "I cannot see an enemy fleet"
  // is weak evidence that there is none. One escort hull is always warranted.
  // On an archipelago the floor is higher: a lone transport with no screen
  // dies to the first barbarian sail it meets.
  if (input.ownTransports > 0 && input.ownWarships === 0) return Math.max(pressure, 1);
  if (archipelago && input.ownCoastalCities > 0 && input.ownWarships === 0
    && (input.troopsAvailable || input.colonisableIslands > 0 || input.seaInvasionTargets > 0)) {
    return Math.max(pressure, 1.5);
  }
  return pressure;
}

/** Pick the strongest hull the treasury can actually field (buy + feed). */
export function pickAffordableWarship(
  options: AvailableShip[],
  treasury: number,
  incomePerTurn: number,
  upkeepPerTurn: number,
  reservePerTurn: number,
): AvailableShip | null {
  const ranked = [...options].filter((s) => s.cost > 0).sort((a, b) => b.attack - a.attack);
  // First hull that is affordable both up front and forever.
  for (const ship of ranked) {
    const budget = navalShipBudgetFor(ship, treasury, incomePerTurn, upkeepPerTurn, reservePerTurn);
    if (budget >= 1) return ship;
  }
  return null;
}

/** Classify a warship hull into a tactical role for fleet-mix decisions. */
export type WarshipRole = 'scout' | 'screen' | 'heavy' | 'raider' | 'carrier';
export function classifyWarshipRole(ship: AvailableShip): WarshipRole {
  const type = ship.type.toLowerCase();
  if (type === 'submarine') return 'raider';
  if (type === 'carrier') return 'carrier';
  if (type === 'sail' || type === 'caravel') return 'scout';
  if (ship.attack >= 8 || ship.cost >= 150) return 'heavy';
  return 'screen';
}

/** The full doctrine decision. */
export function navalDoctrine(input: NavalDoctrineInput): NavalDoctrineResult {
  const budget = navalShipBudget(input);
  const cheapBudget = navalCheapBudget(input);
  const pressure = navalPressure(input);
  const coastalBase = Math.max(input.ownCities, input.ownCoastalCities);
  const wantWarships = clamp(
    Math.round(Math.max(budget, cheapBudget * 0.5) * pressure),
    0,
    Math.min(MAX_WARSHIPS_ABSOLUTE, Math.floor(coastalBase * MAX_WARSHIPS_PER_CITY), Math.floor(Math.max(budget, cheapBudget))),
  );
  const wantTransports = desiredTransports(input);
  const wantEscorts = desiredEscorts(wantTransports, input.ownTransports);
  const wantScouts = desiredScouts(input);
  // Heavies are the battle line: half the fleet once it exceeds 2 hulls.
  const wantHeavies = wantWarships > 2 ? Math.ceil(wantWarships / 2) : wantWarships;

  let choice: AvailableShip | null = null;
  let reason: string;
  if (!input.bestAvailableShip) {
    reason = 'no ship the civ has the technology for';
  } else if (input.ownTransports < wantTransports) {
    // Transports first: a fleet of warships can neither settle nor invade.
    // Prefer the cheapest transport (ferry) — it is the sealift, not the fight.
    const transports = (input.transportOptions ?? []).filter((s) => s.cost > 0);
    const affordableTransport = transports.find((s) =>
      navalShipBudgetFor(s, input.treasury, input.incomePerTurn, input.upkeepPerTurn, input.reservePerTurn) >= 1,
    ) ?? transports[0];
    choice = affordableTransport ?? input.cheapestAvailableShip;
    // A bankrupt sealift builds nothing rather than a hull it cannot feed —
    // UNLESS the archipelago needs the bootstrap hull (the chicken-egg fix is
    // upstream in AutoProduction; here we stay honest about affordability).
    if (choice && navalShipBudgetFor(choice, input.treasury, input.incomePerTurn, input.upkeepPerTurn, input.reservePerTurn) < 1
      && cheapBudget < 1 && budget < 1) {
      // Still express intent when the economy was never measured (tests/stubs).
      const measured = input.incomePerTurn > 0 || input.upkeepPerTurn > 0 || input.reservePerTurn > 0;
      if (measured) choice = null;
    }
    reason = choice
      ? `needs ${wantTransports} transport${wantTransports === 1 ? '' : 's'}, has ${input.ownTransports}`
      : `sealift wanted (${wantTransports}) but unaffordable`;
  } else if (input.ownWarships < wantWarships) {
    // Warships: strongest AFFORDABLE hull, not blindly the strongest hull.
    // A civ that can feed a trireme but not a battleship gets the trireme —
    // the old code answered 0 warships and built nothing.
    const options = (input.warshipOptions ?? []).filter((s) => s.cost > 0);
    const affordable = (ships: AvailableShip[]): AvailableShip | null =>
      ships.length > 0
        ? pickAffordableWarship(ships, input.treasury, input.incomePerTurn, input.upkeepPerTurn, input.reservePerTurn)
        : null;
    // "More units": carriers and raiders join the line once it exists. A
    // carrier (attack 1) never wins "strongest affordable", so without this no
    // civ ever builds air cover; a submarine (raider) is the answer to enemy
    // fishing/transport prey. One of each per battle line, then heavies.
    // Exploration first: while water is dark and no scouts sail, the cheapest
    // fast scout (sail/caravel) outranks the strongest affordable heavy. An
    // ironclad that cannot find the enemy charts nothing; a sail finds the
    // islands and the wars that order the rest of the fleet (seed-19 fix: the
    // bootstrap built ironclads, made no contact, planned no missions, and the
    // civ finished with zero ferries).
    const carrier = options.find((s) => s.type.toLowerCase() === 'carrier');
    const submarine = options.find((s) => s.type.toLowerCase() === 'submarine');
    const ownCarriers = input.ownCarriers ?? 0;
    const ownRaiders = input.ownRaiders ?? 0;
    const scoutOptions = options.filter((s) => classifyWarshipRole(s) === 'scout');
    const ownScouts = input.ownScouts ?? 0;
    const darkWater = (input.unexploredWaterShare ?? 0) > 0.4;
    if (darkWater && scoutOptions.length > 0 && ownScouts < wantScouts) {
      const scout = affordable(scoutOptions);
      if (scout) {
        choice = scout;
      }
    }
    if (!choice) {
      if (carrier && ownCarriers === 0 && input.ownWarships >= 3
        && navalShipBudgetFor(carrier, input.treasury, input.incomePerTurn, input.upkeepPerTurn, input.reservePerTurn) >= 1) {
        choice = carrier;
      } else if (submarine && ownRaiders === 0 && input.ownWarships >= 2
        && (input.enemyTransports + (input.fishingGrounds ?? 0) > 0 || input.ownWarships >= 4)
        && navalShipBudgetFor(submarine, input.treasury, input.incomePerTurn, input.upkeepPerTurn, input.reservePerTurn) >= 1) {
        choice = submarine;
      } else {
        choice = affordable(options) ?? (budget >= 1 ? input.bestAvailableShip : null);
      }
    }
    // Escort urgency: the first escort for a sailing sealift outranks waiting
    // for the perfect heavy. A cheap screen now beats a battleship never.
    if (!choice && cheapBudget >= 1 && options.length > 0) {
      choice = [...options].sort((a, b) => a.cost - b.cost)[0];
    }
    reason = choice
      ? `fleet pressure ${pressure.toFixed(1)} × budget ${Math.max(budget, cheapBudget).toFixed(1)} = ${wantWarships} warship${wantWarships === 1 ? '' : 's'} (escort ${wantEscorts}, scouts ${wantScouts}, heavies ${wantHeavies}), has ${input.ownWarships}`
      : `fleet wanted (${wantWarships}) but unaffordable (budget ${budget.toFixed(1)}, cheap ${cheapBudget.toFixed(1)})`;
  } else {
    reason = `satisfied: ${input.ownTransports}/${wantTransports} transports, ${input.ownWarships}/${wantWarships} warships`;
  }
  return { wantTransports, wantWarships, wantScouts, wantHeavies, wantEscorts, budget, cheapBudget, pressure, choice, reason };
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
  trade_ship: 40,
  other_naval: 35,
  scout: 25,
};

/**
 * Whether a naval hull counts as a warship.
 *
 * A warship is a hull that can sink things. Transports are excluded because
 * their job is carrying troops, and fishermen because a Fisher Boat is naval,
 * attacks nothing and carries nothing — counting it as an escort let a civ's
 * entire fishing fleet satisfy the warship quota, so it stopped buying escorts
 * exactly when it started moving troops by sea, and read an enemy fishing
 * fleet as a war fleet it had to answer with hulls of its own.
 *
 * Submarines are the exception: they carry one nuclear warhead (capacity 1)
 * AND hunt (attack 14). They count as warships — a fleet of subs is screened,
 * and an empty sub is never mistaken for a transport.
 */
export function isWarshipHull(props: {
  attack?: number;
  transportCapacity?: number;
} | undefined, type?: string): boolean {
  if (!props) return false;
  if ((props.transportCapacity ?? 0) > 0 && type !== 'submarine') return false;
  return (props.attack ?? 0) > 0;
}

/**
 * Whether a hull is sealift (ferries troops): carries units and is not a
 * submarine launch platform. Centralizes the submarine exception so fleet
 * counts, doctrine inputs and production splits never mistake a sub for a
 * ferry — or leave it out of the warship line.
 */
export function isSealiftHull(
  type: string,
  props?: { transportCapacity?: number },
): boolean {
  const capacity = props?.transportCapacity ?? 0;
  if (capacity <= 0) return false;
  return String(type ?? '').trim().toLowerCase() !== 'submarine';
}

export type NavalTargetClass =
  | 'transport'
  | 'warship'
  | 'coastal_city'
  | 'fisher_boat'
  | 'trade_ship'
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
  /** Role of the hunting hull (raiders prefer merchants, heavies prefer fleets). */
  attackerRole?: WarshipRole;
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
 *
 * Role bonuses (the "more units" doctrine): raiders (submarines) prefer soft
 * merchant prey, heavies prefer the enemy battle line, scouts prefer to shadow
 * rather than suicide into heavies. Small (±10) so class order never flips —
 * a scout still will not cross the map for a fisher boat past a transport.
 */
export function scoreNavalTarget({
  targetClass,
  distance,
  valueMultiplier = 1,
  isFresh = false,
  attackerRole,
}: NavalTargetScoreInput): NavalTargetScoreResult {
  const base = WARSHIP_TARGET_VALUE[targetClass] * Math.max(0, valueMultiplier);
  const freshness = isFresh ? 8 : 0;
  let roleBonus = 0;
  if (attackerRole === 'raider') {
    if (targetClass === 'transport' || targetClass === 'fisher_boat') roleBonus = 10;
    else if (targetClass === 'warship') roleBonus = -6;
  } else if (attackerRole === 'heavy') {
    if (targetClass === 'warship') roleBonus = 8;
    else if (targetClass === 'coastal_city') roleBonus = 4;
  } else if (attackerRole === 'scout') {
    if (targetClass === 'scout' || targetClass === 'other_naval') roleBonus = 6;
    else if (targetClass === 'warship') roleBonus = -8;
  } else if (attackerRole === 'carrier') {
    if (targetClass === 'coastal_city') roleBonus = 6;
    else if (targetClass === 'warship') roleBonus = -4;
  }
  const score = base + freshness + roleBonus - Math.max(0, distance) * DISTANCE_WEIGHT;
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
  if (type === 'trade_ship') return 'trade_ship';
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
  /** Siege power aboard (catapult/cannon/artillery attack); cracks walls. */
  siegePower?: number;
  /** Whether the target city has walls (siege matters twice as much). */
  walledTarget?: boolean;
  /** Fast units aboard that can exploit a far beach (cavalry/tank count). */
  fastUnits?: number;
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
 *
 * Siege and speed ("more units" ashore): a force with siege guns cracks a
 * walled city the same infantry cannot, so walls discount siege power rather
 * than raw force; fast units forgive a distant beach because they close the
 * last miles overland.
 */
export function scoreLandingSite({
  ferryDistance,
  landingForce,
  beachDefence = 0,
  targetCityDefence = 0,
  tileYield = 0,
  adjacentToTarget = false,
  siegePower = 0,
  walledTarget = false,
  fastUnits = 0,
}: LandingSiteInput): LandingSiteScoreResult {
  // The force has to beat what is in front of it. A roughly 1.5:1 margin is
  // the threshold below which an assault is a suicide run — but siege guns
  // count double against a walled target (they are built to crack it).
  const effectiveForce = landingForce + (walledTarget ? siegePower : siegePower * 0.5);
  const required = beachDefence + targetCityDefence;
  const hopeless = required > 0 && effectiveForce < required * 1.5;

  let score = 100;
  // Fast units forgive distance: a beach 6 away with cavalry ashore is worth
  // more than the same beach with legions.
  const distanceCost = Math.max(1, 6 - Math.min(4, fastUnits));
  score -= ferryDistance * distanceCost;
  score += adjacentToTarget ? 30 : 0; // a beach next to the prize is the point
  score -= required * 4;             // defended ground is bad ground
  if (walledTarget) score += Math.min(20, siegePower * 2); // guns want walls
  score += Math.min(12, tileYield * 2); // for colonisation: is it worth living on
  return { score, hopeless };
}

// ──────────────────────────────────────────────────────────────────────────
// Island colonisation + island guard: where to land, settle and stand
// ──────────────────────────────────────────────────────────────────────────

export interface ColonyIslandScoreInput {
  /** Tiles on the island (larger = room for a real city). */
  size: number;
  /** Chebyshev distance from the civ's nearest city to the island. */
  distance: number;
  /** Food + production + trade of the prospective founding tile (0 unknown). */
  siteYield?: number;
  /** Whether a rival is already ferrying to this island (claimed). */
  claimed?: boolean;
}

/**
 * Rank colonisable islands for ONE settler. Nearer beats bigger only up to a
 * point: a 2-tile rock next door is a worse city than a 12-tile island a day
 * further out. Size wins at ~2 tiles of sailing per extra land tile.
 * A claimed island is never chosen (rival ferry converging = pile-up).
 */
export function scoreColonyIsland({ size, distance, siteYield = 0, claimed = false }: ColonyIslandScoreInput): number {
  if (claimed) return -Infinity;
  return size * 2 - Math.max(0, distance) * 1.0 + Math.min(12, siteYield * 2);
}

export interface GuardTileScoreInput {
  /** Terrain defence bonus of the tile (1 open … 3 mountains). */
  terrainDefence: number;
  /** True when the tile carries a fortress improvement (×2, applied last). */
  fortress?: boolean;
  /** True when the tile is on/adjacent to a friendly city (supply + retreat). */
  nearFriendlyCity?: boolean;
  /** Chebyshev distance to the beach/water the guard watches (0 = the beach). */
  beachDistance?: number;
  /** True when an enemy unit or hostile city is within striking distance. */
  threatened?: boolean;
}

/**
 * Rank a tile as an island guard post. Fortresses dominate (Civ1 ×2 applied
 * last in combat), then high ground, then proximity to the beach watched and
 * to a friendly city to fall back on. A threatened beach outranks a quiet
 * hill inland: guards watch water, not scenery.
 */
export function scoreGuardTile({
  terrainDefence,
  fortress = false,
  nearFriendlyCity = false,
  beachDistance = 3,
  threatened = false,
}: GuardTileScoreInput): number {
  let score = terrainDefence * 10;
  if (fortress) score += 40;
  if (nearFriendlyCity) score += 12;
  score -= Math.max(0, beachDistance) * 3;
  if (threatened) score += 15;
  return score;
}

// ──────────────────────────────────────────────────────────────────────────
// Fleet-mix helper: which hull should the next shields buy?
// ──────────────────────────────────────────────────────────────────────────

/** Which tactical slot the fleet is shortest on. */
export type FleetNeed = 'transport' | 'escort' | 'scout' | 'heavy' | 'screen' | 'raider' | 'satisfied';

/**
 * The fleet's single biggest deficit, in build order. Transports first (no
 * sealift = no invasion/colonisation), then the escort screen for the troops
 * at sea, then scouts while water is dark, then heavies for the battle line,
 * then raiders/carriers once the line exists. Pure — the caller maps the need
 * to a hull it can actually build.
 */
export function fleetNeed(input: NavalDoctrineInput & { wantTransports: number; wantWarships: number }): FleetNeed {
  if (input.ownTransports < input.wantTransports) return 'transport';
  const wantEscorts = desiredEscorts(input.wantTransports, input.ownTransports);
  if (input.ownWarships < Math.min(wantEscorts, input.wantWarships)) return 'escort';
  const wantScouts = desiredScouts(input);
  if ((input.ownScouts ?? 0) < wantScouts && input.ownWarships < input.wantWarships) return 'scout';
  if (input.ownWarships < input.wantWarships) {
    const heavies = input.ownHeavies ?? 0;
    const wantHeavies = input.wantWarships > 2 ? Math.ceil(input.wantWarships / 2) : input.wantWarships;
    if (heavies < wantHeavies) return 'heavy';
    return 'screen';
  }
  return 'satisfied';
}
