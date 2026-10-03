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
 * Buildings whose advantage is not implemented by the engine.
 *
 * Listed explicitly rather than derived, because "absent from the table" and
 * "declared but ignored" are different mistakes. `defense`, `pollution` and
 * `corruptionReduction` are handled separately below because the engine does
 * act on them — but by hardcoding the building id and ignoring the declared
 * value, which is a different (and messier) kind of live.
 */
export const INERT_EFFECTS: ReadonlySet<string> = new Set([
  'production',
  'culture',
  'health',
  'gold',
  'food',
  'growthBonus',
  'foodStorage',
  'unitProduction',
  'veteranUnits',
  'corruptionReduction',
  'missileDefense',
  'isPalace',
  'wonder',
  'globalDefense',
  'navalMovement',
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
export type BuildingVerdict =
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
        // The engine hardcodes a ×3 city defence when the walls are standing,
        // so the declared magnitude is cosmetic; what matters is whether the
        // city is actually under attack.
        if (city.isThreatened) {
          incomePerTurn += disorderAvoidanceWorth(city);
          liveEffects.push('defense:×3');
          reasons.push(`city is threatened — walls multiply its defence, risking ${round1(city.cityOutputPerTurn)} gold/turn of output`);
        } else {
          liveEffects.push('defense:×3');
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

  // ── A city's granary halves stored food on every growth step ────────────
  // Not an `effect` the engine reads (it checks the id), but it is real.
  if (buildingType === 'granary') {
    liveEffects.push('foodStorage:halves-loss-on-growth');
    reasons.push('halves food lost to growth each time the city grows');
  }

  // ── SDI Defense: only worth 4 gold/turn against an actual atomic threat ──
  if (buildingType === 'sdi_defense') {
    if (city.rivalCanBuildAtomicWeapons) {
      incomePerTurn += city.cityOutputPerTurn;
      liveEffects.push('missileDefense');
      reasons.push('a rival can field an atomic weapon — the battery is earning its 4 gold/turn');
    } else {
      reasons.push('no rival can build an atomic weapon — nothing to intercept');
    }
  }

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
