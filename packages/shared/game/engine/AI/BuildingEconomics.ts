/**
 * BuildingEconomics — the cost/usage equation.
 *
 * A building is not worth keeping because it is on the list; it is worth
 * keeping because of what it *does to this city right now*, and only if that is
 * worth more than it costs. This module answers that with an explicit
 * equation:
 *
 *   net gold/turn = (trade→gold) + (science→beakers) + (happiness→disorder
 *                   avoided) + (defence→city loss avoided)  −  upkeep
 *
 * and it is deliberately strict about *live* effects. The building table
 * declares far more effects than the engine actually consumes — `production`,
 * `culture`, `health`, `pollution`, `unitProduction`, `veteranUnits`,
 * `growthBonus`, `foodStorage`, `corruptionReduction`, `missileDefense`,
 * `defense` are all read nowhere or read only for a score. Scoring those as
 * income would tell the AI to keep a Factory and an SDI Defense forever: 200
 * shields and 4 gold a turn for literally nothing.
 *
 * So the two questions are kept apart:
 *   - does the engine act on this effect at all? (`hasAnyLiveEffect`)
 *   - if so, does it pay here, in this city, under these tax rates?
 *
 * The two headline cases the audit turns on:
 *   - **SDI Defense** (4 gold/turn, the most expensive building in the game) is
 *     only ever worth keeping while a rival can actually field an atomic
 *     weapon. Otherwise it has no live effect at all and is pure upkeep.
 *   - **Stock Exchange** (+3 trade) earns `3 × TRADE_GOLD_MULTIPLIER × taxRate`
 *     against 2 upkeep, so it is a good buy at a high tax rate and a bad one
 *     under Democracy's 10% cap — the same building, opposite verdicts.
 */

import { BUILDING_PROPERTIES } from '@/data/BuildingConstants';
import { PURCHASE_GOLD_PER_SHIELD } from '@/data/GameConstants';
import { TRADE_GOLD_MULTIPLIER } from '../EconomicManager';

/**
 * Gold-equivalent of one beaker per turn.
 *
 * Science does not become gold, so comparing it to gold upkeep needs an
 * exchange rate. One beaker ≈ one gold is roughly where the engine's early
 * tech costs (140–250) and a typical research rate meet, and it is the single
 * knob to turn if the research economy is ever rebalanced.
 */
export const BEAKER_GOLD_EQUIVALENT = 1;

/**
 * Gold-equivalent of one shield per turn of steady production.
 *
 * The treasury charges `PURCHASE_GOLD_PER_SHIELD` gold to RUSH a shield, but
 * produced shields arrive gradually and only toward whatever the city queues,
 * so they are credited at half the rush price — the same rough gold-for-works
 * exchange the beaker uses for science. Holds the Factory (+2 shields, 3 gold
 * upkeep) at a slight loss instead of at "worth exactly nothing", which is
 * what let the sell audit liquidate an industrial empire on a hunch.
 */
export const SHIELD_GOLD_EQUIVALENT = PURCHASE_GOLD_PER_SHIELD / 2;

/** Gold-equivalent of one declared `health` point (disease down, lives longer). */
export const HEALTH_GOLD_EQUIVALENT = 0.5;

/** Gold-equivalent of one `growthBonus` / `foodStorage` point (faster growth). */
export const GROWTH_GOLD_EQUIVALENT = 0.5;

/** Gold-equivalent of one `culture` point (tracked in the demographics). */
export const CULTURE_GOLD_EQUIVALENT = 0.25;

/** Worth of a Barracks' veteran workshop: units roll out at ×1.25 strength. */
export const VETERAN_UNITS_GOLD_EQUIVALENT = 1;

/** Worth of lifting the size-10 housing cap (the Aqueduct's main job). */
export const HOUSING_CAP_GOLD_EQUIVALENT = 1;

/**
 * Share of the city's gold output that distance corruption plausibly eats,
 * times `(1 − corruptionReduction)` — a deliberately conservative stand-in for
 * the gold CityUtils keeps from being stolen, since the equation has no
 * distance input of its own.
 */
export const CORRUPTION_PROTECTED_SHARE = 0.1;

/**
 * Effects that are declared but still not implemented anywhere.
 *
 * Listed explicitly rather than derived, because "absent from the table" and
 * "declared but ignored" are different mistakes. Everything else the engine
 * now consumes through `BuildingEffects` (production, culture, health,
 * growthBonus, foodStorage, unitProduction, veteranUnits, corruptionReduction,
 * missileDefense, isPalace, defense, housingCap) or through WonderEffects —
 * those are priced in the switch below instead of being marked dead.
 *
 * NOTE: `navalMovement` used to be here — the Lighthouse and Magellan's
 * Expedition now grant their +1 ship movement for real (WonderEffects), so
 * the engine acts on it. `pollution` is handled in the switch: the engine
 * reads it for the Civ1 score, never for a yield.
 */
export const INERT_EFFECTS: ReadonlySet<string> = new Set([
  'gold',
  'food',
  'wonder',
  'globalDefense',
  'exploration',
  'diplomacy',
]);

/**
 * `globalHappiness` is deliberately NOT in this list: it is a real, wired
 * effect — a wonder that grants content in every city of its civ — so the audit
 * must price it rather than call the building inert.
 */

/** Technology that unlocks the `nuclear` unit — the only atomic weapon. */
export const NUCLEAR_WEAPON_TECH = 'nuclear_power';

/**
 * How many happiness points of slack a city has before losing one costs it
 * nothing at all. Past this margin the drain on the city's output is priced
 * linearly, so walls in a content city are close to free and walls in a city
 * one point from disorder are almost not worth having.
 */
const HAPPINESS_SHADOW_RANGE = 6;

/**
 * Floor on what keeping a city out of disorder is worth, in gold/turn.
 *
 * Disorder does not only stop tax — it stops growth and production as well — so
 * a city is worth something even in the first turns before it earns anything.
 * Without a floor a Temple in a brand-new, revenue-less city reads as worthless
 * purely because its `tax` has not started accumulating yet, and the audit
 * sells exactly the buildings that are holding the city together.
 */
export const MIN_DISORDER_CITY_WORTH = 3;

/** What a building is worth, per turn, in this city. */
type BuildingVerdict =
  /** Earns more than it costs. */
  | 'profitable'
  /** Roughly covers its own upkeep. */
  | 'break_even'
  /** Costs more than it earns — a candidate for liquidation. */
  | 'draining'
  /** Does nothing the engine can see. */
  | 'inert';

export interface BuildingEconomics {
  buildingType: string;
  /** Gold/turn this building actually produces here. */
  incomePerTurn: number;
  /** Gold/turn it costs to keep. */
  upkeepPerTurn: number;
  /** income − upkeep. Negative = a net drain on the treasury. */
  netPerTurn: number;
  /** The effects the engine really acts on, e.g. `['trade:3']`. */
  liveEffects: string[];
  /** The effects that are declared but inert, e.g. `['production:2']`. */
  inertEffects: string[];
  /** Any effect at all that the engine consumes. */
  hasAnyLiveEffect: boolean;
  /** How the income was earned — one clause per contribution. */
  reasons: string[];
  verdict: BuildingVerdict;
}

/** The city facts the equation needs. Nothing here is an engine handle. */
export interface CityEconomics {
  /** Civilization tax rate, 0..100. */
  taxRate: number;
  /** Gold/turn this city currently produces (tax + trade deals). */
  cityOutputPerTurn: number;
  /** happiness − unhappiness *without* this building. */
  happinessSlackWithout: number;
  /** Whether an enemy force is bearing on the city right now. */
  isThreatened: boolean;
  /** Whether the city sits on water and could field/use a navy. */
  isCoastal: boolean;
  /** This civ has ever put a warship to sea. */
  civUsesShips: boolean;
  /** A living rival can field an atomic weapon. */
  rivalCanBuildAtomicWeapons: boolean;
}

export const NEUTRAL_CITY_ECONOMICS: CityEconomics = {
  taxRate: 50,
  cityOutputPerTurn: 0,
  happinessSlackWithout: 0,
  isThreatened: false,
  isCoastal: false,
  civUsesShips: false,
  rivalCanBuildAtomicWeapons: false,
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Run the equation for one building.
 *
 * `happinessSlackWithout` must be measured with the building ALREADY REMOVED —
 * otherwise a Temple is credited with the happiness it created itself and every
 * happiness building looks like it is saving the city from itself.
 */
export function evaluateBuildingEconomics(
  buildingType: string,
  city: CityEconomics,
): BuildingEconomics {
  const props = BUILDING_PROPERTIES[buildingType];
  const effects = props?.effects ?? {};
  const upkeepPerTurn = props?.maintenance ?? 0;

  const liveEffects: string[] = [];
  const inertEffects: string[] = [];
  const reasons: string[] = [];
  let incomePerTurn = 0;

  for (const [effect, raw] of Object.entries(effects)) {
    const magnitude = typeof raw === 'number' ? raw : 1;
    // Render a flag as `true`, not as the number it was coerced to.
    const label = typeof raw === 'number' ? String(raw) : String(raw === true);

    if (INERT_EFFECTS.has(effect)) {
      inertEffects.push(`${effect}:${label}`);
      continue;
    }

    switch (effect) {
      case 'trade': {
        // Commerce → gold: the engine pays TRADE_GOLD_MULTIPLIER gold per point
        // of after-corruption commerce at 100% tax.
        const gold = magnitude * TRADE_GOLD_MULTIPLIER * (clamp(city.taxRate, 0, 100) / 100);
        incomePerTurn += gold;
        liveEffects.push(`trade:${magnitude}`);
        reasons.push(`+${magnitude} trade = +${round1(gold)} gold/turn at ${city.taxRate}% tax`);
        break;
      }

      case 'science': {
        const gold = magnitude * BEAKER_GOLD_EQUIVALENT;
        incomePerTurn += gold;
        liveEffects.push(`science:${magnitude}`);
        reasons.push(`+${magnitude} science = +${round1(gold)} gold/turn equivalent`);
        break;
      }

      case 'production': {
        // Flat shields added to the city's yields every turn (BuildingEffects).
        const gold = magnitude * SHIELD_GOLD_EQUIVALENT;
        incomePerTurn += gold;
        liveEffects.push(`production:${magnitude}`);
        reasons.push(`+${magnitude} shields/turn = +${round1(gold)} gold/turn equivalent`);
        break;
      }

      case 'unitProduction': {
        // Extra shields while a COMBAT unit is under construction (Barracks).
        const gold = magnitude * SHIELD_GOLD_EQUIVALENT;
        incomePerTurn += gold;
        liveEffects.push(`unitProduction:${magnitude}`);
        reasons.push(`+${magnitude} shields on military builds = +${round1(gold)} gold/turn equivalent`);
        break;
      }

      case 'veteranUnits': {
        // Units built here start Seasoned (rank ×1.25) instead of Rookie.
        incomePerTurn += VETERAN_UNITS_GOLD_EQUIVALENT;
        liveEffects.push('veteranUnits:true');
        reasons.push(`combat units roll out Seasoned (×1.25 from the first round) = +${VETERAN_UNITS_GOLD_EQUIVALENT} gold/turn equivalent`);
        break;
      }

      case 'foodStorage': {
        // Each point keeps a quarter of the food box on growth (Granary: 2 → half).
        const gold = magnitude * GROWTH_GOLD_EQUIVALENT;
        incomePerTurn += gold;
        liveEffects.push(`foodStorage:${magnitude}`);
        reasons.push(`keeps ${magnitude * 25}% of the food box when the city grows = +${round1(gold)} gold/turn equivalent`);
        break;
      }

      case 'growthBonus': {
        const gold = magnitude * GROWTH_GOLD_EQUIVALENT;
        incomePerTurn += gold;
        liveEffects.push(`growthBonus:${magnitude}`);
        reasons.push(`+${magnitude} food credited on every growth step = +${round1(gold)} gold/turn equivalent`);
        break;
      }

      case 'health': {
        // Demographics: disease down, life expectancy up (DemographicsManager).
        const gold = magnitude * HEALTH_GOLD_EQUIVALENT;
        incomePerTurn += gold;
        liveEffects.push(`health:${magnitude}`);
        reasons.push(`+${magnitude} health — less disease, longer lives = +${round1(gold)} gold/turn equivalent`);
        break;
      }

      case 'housingCap': {
        // The Aqueduct's main job: the city may grow past the size-10 cap.
        incomePerTurn += HOUSING_CAP_GOLD_EQUIVALENT;
        liveEffects.push('housingCap:true');
        reasons.push(`lifts the size-10 housing cap = +${HOUSING_CAP_GOLD_EQUIVALENT} gold/turn equivalent`);
        break;
      }

      case 'culture': {
        // Tracked in the world demographics; a small credit, never a yield.
        const gold = magnitude * CULTURE_GOLD_EQUIVALENT;
        incomePerTurn += gold;
        liveEffects.push(`culture:${magnitude}`);
        reasons.push(`+${magnitude} culture in the demographics = +${round1(gold)} gold/turn equivalent`);
        break;
      }

      case 'corruptionReduction': {
        // CityUtils multiplies the corruption rate by this value, compounding
        // across buildings: the city keeps `(1 − r)` of what distance
        // corruption would have stolen.
        const gold = city.cityOutputPerTurn * (1 - magnitude) * CORRUPTION_PROTECTED_SHARE;
        incomePerTurn += gold;
        liveEffects.push(`corruptionReduction:${magnitude}`);
        reasons.push(`cuts distance corruption by ${Math.round((1 - magnitude) * 100)}% = +${round1(gold)} gold/turn at today's output`);
        break;
      }

      case 'missileDefense': {
        // Worth its upkeep only against a rival that can actually field one.
        if (city.rivalCanBuildAtomicWeapons) {
          incomePerTurn += city.cityOutputPerTurn;
          liveEffects.push('missileDefense');
          reasons.push('a rival can field an atomic weapon — the battery is earning its keep');
        } else {
          reasons.push('no rival can build an atomic weapon — nothing to intercept');
        }
        break;
      }

      case 'isPalace': {
        liveEffects.push('isPalace:true');
        reasons.push('seat of government — the capital must never be liquidated');
        break;
      }

      case 'happiness': {
        if (magnitude > 0) {
          // A happiness building is worth exactly the disorder it prevents:
          // if losing it would tip the city into disorder, it is saving the
          // city's entire output. If the city stays content without it, it is
          // buying nothing at all.
          const wouldDisorder = city.happinessSlackWithout - magnitude < 0;
          liveEffects.push(`happiness:+${magnitude}`);
          if (wouldDisorder) {
            const worth = disorderAvoidanceWorth(city);
            incomePerTurn += worth;
            reasons.push(`prevents disorder — saves ${round1(worth)} gold/turn of city output`);
          } else {
            reasons.push(`city stays content without it — ${magnitude} happiness buys nothing here`);
          }
        } else {
          // City Walls' -1 happiness is an ongoing drag, priced by how close it
          // brings the city to disorder rather than at a flat rate. A single
          // rate would be wrong in both directions: a city with plenty of slack
          // loses nothing at all, while a city one point from disorder risks its
          // entire output. The ramp is linear in the slack that remains.
          const cost = Math.abs(magnitude);
          const slack = city.happinessSlackWithout;
          if (slack <= 0) {
            liveEffects.push(`happiness:${label}`);
            reasons.push('-1 happiness costs nothing — the city is already unhappy');
          } else {
            const risk = clamp(1 - (slack - cost) / HAPPINESS_SHADOW_RANGE, 0, 1);
            const penalty = disorderAvoidanceWorth(city) * risk;
            incomePerTurn -= penalty;
            liveEffects.push(`happiness:${label}`);
            reasons.push(risk <= 0
              ? `-${cost} happiness with room to spare — costs nothing`
              : `-${cost} happiness risks ${round1(penalty)} gold/turn of city output at only ${slack} slack`);
          }
        }
        break;
      }

      case 'defense': {
        // The engine multiplies city defence by `1 + 0.25 × N` (BuildingEffects
        // → CombatSystem; City Walls' 2 → ×1.5). What matters for the ledger is
        // not the multiplier but whether the city is actually under attack.
        const multiplier = round1(1 + magnitude * 0.25);
        if (city.isThreatened) {
          incomePerTurn += disorderAvoidanceWorth(city);
          liveEffects.push(`defense:×${multiplier}`);
          reasons.push(`city is threatened — walls multiply its defence ×${multiplier}, risking ${round1(city.cityOutputPerTurn)} gold/turn of output`);
        } else {
          liveEffects.push(`defense:×${multiplier}`);
          reasons.push('nothing is attacking — the walls earn nothing today');
        }
        break;
      }

      case 'pollution': {
        // Pollution only moves the Civ1 score; it never touches a yield.
        inertEffects.push(`pollution:${magnitude}`);
        break;
      }

      default: {
        // An effect nobody has classified. Treated as inert rather than as free
        // income: assuming value we cannot justify is how a 4-gold dead
        // building survives every audit.
        inertEffects.push(`${effect}:${magnitude}`);
        break;
      }
    }
  }

  // ── Effects granted by enabling something, not by adding a stat ─────────
  if (buildingType === 'harbor') {
    if (!city.isCoastal) {
      reasons.push('inland — no ships, no sea food');
    } else if (city.civUsesShips) {
      incomePerTurn += 2;
      liveEffects.push('shipyard');
      reasons.push('a fleet operates from here — the harbour is in use');
    } else {
      incomePerTurn += 1;
      liveEffects.push('shipyard');
      reasons.push('coastal, but the civ has never sailed — a fishing berth');
    }
  }

  // ── SDI Defense: only worth 4 gold/turn against an actual atomic threat ──
  // (handled by the `missileDefense` effect case above — no hardcoded id)

  const hasAnyLiveEffect = liveEffects.length > 0;
  const netPerTurn = round1(incomePerTurn - upkeepPerTurn);

  let verdict: BuildingVerdict;
  if (!hasAnyLiveEffect) verdict = 'inert';
  else if (netPerTurn > 0.5) verdict = 'profitable';
  else if (netPerTurn >= -0.5) verdict = 'break_even';
  else verdict = 'draining';

  if (verdict === 'inert') {
    reasons.push(inertEffects.length > 0
      ? `nothing the engine uses (${inertEffects.join(', ')})`
      : 'nothing the engine uses');
  }

  return {
    buildingType,
    incomePerTurn: round1(incomePerTurn),
    upkeepPerTurn,
    netPerTurn,
    liveEffects,
    inertEffects,
    hasAnyLiveEffect,
    reasons,
    verdict,
  };
}

/**
 * What it is worth to keep this city out of disorder / keep it in one piece —
 * its output, with a floor so a young city is never valued at nothing.
 */
function disorderAvoidanceWorth(city: CityEconomics): number {
  return Math.max(city.cityOutputPerTurn, MIN_DISORDER_CITY_WORTH);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Whether a building may be liquidated to raise money.
 *
 * Only ever true for a building that is not paying its way. A profitable or
 * break-even building is excluded outright — freeing its upkeep would mean
 * paying more than it earns to obtain money, which loses on both sides.
 */
export function isSellableForBudget(economics: BuildingEconomics): boolean {
  return economics.netPerTurn < 0;
}
