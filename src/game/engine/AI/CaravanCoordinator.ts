/**
 * CaravanCoordinator — the per-civilization brain above the CaravanGovernor.
 *
 * The governor (`CaravanGovernor.ts`) owns ONE caravan's career: a sticky
 * delivery mission, risk-aware stepping, patience, disband. It answers "how does
 * this caravan get where it is going". It deliberately knows nothing about the
 * other caravans, and that is the gap: three caravans from the same city all
 * head for the same rich foreign capital, the first fills a route slot, and the
 * other two arrive at a city that has none left and are wasted. Nothing in the
 * per-unit view can see that.
 *
 * This module is the civ-level view. Once per round per civ it answers:
 *
 *  1. **Which city builds the next caravan** — a city with empty route slots and
 *     the population to make the route pay, so production is not scattered over
 *     cities that cannot use a caravan.
 *  2. **Where each in-flight caravan delivers** — one destination per caravan,
 *     de-duplicated across the civ's caravans, so two caravans never compete for
 *     the same slot unless the destination genuinely has two slots free.
 *  3. **How many caravans is the right number** — the free route slots the civ
 *     actually has, not more. A caravan above that is disbanded, because it
 *     drains 1 gold a turn forever to walk somewhere it is not needed.
 *
 * The rules it plans against, both bottom-up in the engine:
 *
 *  * a city holds at most `MAX_TRADE_ROUTES` (3) routes, and when a new one
 *    arrives the **oldest** is dropped (`GameEngine.addTradeRoute`);
 *  * a caravan is consumed by its delivery (`establishTradeRoute`).
 *
 * Everything here is pure: the caller passes a read-only view of the world, and
 * gets back a plan. Nothing in this file mutates game state.
 */

import { MAX_TRADE_ROUTES } from '../GameEngine';

/** The slice of the engine the coordinator reads (GameEngine satisfies it). */
export interface CaravanCoordinatorWorld {
  cities: ReadonlyArray<{
    id: string;
    name?: string;
    col: number;
    row: number;
    population?: number;
    civilizationId: number;
    tradeRoutes?: ReadonlyArray<{ cityId: string; trade?: number; round?: number }>;
  }>;
  units: ReadonlyArray<{
    id: string;
    type: string;
    civilizationId: number;
    homeCityId?: string | null;
    isDefeated?: boolean;
  }>;
  /** Whether this civ is at war with that one. */
  isAtWar(a: number, b: number): boolean;
  /** Whether the civ has met the other (foreign routes need knowledge). */
  hasContacted?(a: number, b: number): boolean;
}

/** One assignment: this caravan walks to this city. */
interface CaravanAssignment {
  unitId: string;
  targetCityId: string;
  targetCol: number;
  targetRow: number;
  /** Rough value of the route, for logging and tests. */
  value: number;
  /** True when the destination belongs to another civ (pays double). */
  foreign: boolean;
}

/** What the civ should do with its caravans this round. */
export interface CaravanCivPlan {
  civId: number;
  /** Where each unassigned/stranded caravan should go. */
  assignments: CaravanAssignment[];
  /** Caravan ids the civ does not need (over cap) — disband them. */
  surplus: string[];
  /** Cities that should build a caravan, best first, with the reason. */
  producers: Array<{ cityId: string; urgency: number; freeSlots: number }>;
  /** Free route slots across the civ's cities. */
  freeSlots: number;
  /** Caravans already in flight (all of them, assigned or not). */
  inFlight: number;
}

/** In-transit caravans one city may have at once (per home city). */
const MAX_IN_TRANSIT_PER_CITY = 3;

/** Distance weight: a longer route is worth more, but not enough to starve. */
const DISTANCE_WEIGHT = 0.05;

/**
 * The civ's caravan plan for this round.
 *
 * `committed` is the set of target city ids already claimed this round by other
 * caravans of this civ; the caller passes the previous round's assignments (or
 * the governor's live missions) so slots are not double-booked.
 */
export function planCaravansForCiv(
  world: CaravanCoordinatorWorld,
  civId: number,
  committedTargets: ReadonlySet<string> = new Set(),
): CaravanCivPlan {
  const ownCities = world.cities.filter((c) => c.civilizationId === civId);
  const myCaravans = world.units.filter(
    (u) => u.type === 'caravan' && u.civilizationId === civId && !u.isDefeated,
  );

  // ── 1. Route slots the civ actually has ─────────────────────────────────
  const slotsOf = (cityId: string): number => {
    const city = ownCities.find((c) => c.id === cityId);
    return Math.max(0, MAX_TRADE_ROUTES - (city?.tradeRoutes?.length ?? 0));
  };
  const freeSlots = ownCities.reduce((n, c) => n + slotsOf(c.id), 0);

  // ── 2. Which cities should build a caravan ──────────────────────────────
  // A city with a free slot and enough population to make the route worth the
  // walk. Pop 1 routes pay almost nothing; the caravan is not free (50 shields
  // and a turn of the city's production).
  const producers = ownCities
    .map((city) => {
      const free = slotsOf(city.id);
      const pop = city.population ?? 1;
      // Urgency: empty slots first, then the size of the city.
      const urgency = (free >= MAX_TRADE_ROUTES ? 3 : free) + Math.min(3, pop / 4);
      return { cityId: city.id, urgency, freeSlots: free, population: pop };
    })
    .filter((p) => p.freeSlots > 0 && p.population >= 2)
    .sort((a, b) => b.urgency - a.urgency)
    .map(({ cityId, urgency, freeSlots: slots }) => ({ cityId, urgency, freeSlots: slots }));

  // ── 3. How many caravans the civ should have in flight ──────────────────
  // One per free slot, so a caravan is never produced for a slot that does not
  // exist. Above that, the surplus is disbanded — not left to wander.
  const inTransitByCity = new Map<string, number>();
  for (const u of myCaravans) {
    const key = u.homeCityId ?? '__none__';
    inTransitByCity.set(key, (inTransitByCity.get(key) ?? 0) + 1);
  }
  const wanted = Math.min(freeSlots, MAX_IN_TRANSIT_PER_CITY * Math.max(1, ownCities.length));
  const surplus: string[] = [];
  if (myCaravans.length > wanted) {
    // The newest go first: `world.units` is append-ordered, so a higher index is
    // a later production. (Same approximation the governor's cap uses.)
    const byAge = myCaravans
      .map((u) => ({ u, idx: world.units.indexOf(u) }))
      .sort((a, b) => b.idx - a.idx)
      .slice(0, myCaravans.length - wanted);
    for (const { u } of byAge) surplus.push(u.id);
  }

  // ── 4. Assign the survivors a destination ───────────────────────────────
  const assignments: CaravanAssignment[] = [];
  const claimed = new Set(committedTargets);
  for (const u of myCaravans) {
    if (surplus.includes(u.id)) continue;
    const home = ownCities.find((c) => c.id === u.homeCityId) ?? ownCities[0];
    const target = pickTarget(world, civId, home, claimed);
    if (!target) continue;
    claimed.add(target.cityId);
    assignments.push({
      unitId: u.id,
      targetCityId: target.cityId,
      targetCol: target.col,
      targetRow: target.row,
      value: target.value,
      foreign: target.foreign,
    });
  }

  return {
    civId,
    assignments,
    surplus,
    producers,
    freeSlots,
    inFlight: myCaravans.length,
  };
}

/**
 * The best destination for one caravan: highest route value among cities with a
 * free slot that no other caravan of this civ is already walking to.
 *
 * "Free slot" is per TARGET city — a city whose routes are full is not a
 * candidate, and one slot is only claimed once per round so two caravans do not
 * race for it. A city with several free slots may take several caravans.
 */
function pickTarget(
  world: CaravanCoordinatorWorld,
  civId: number,
  home: { col: number; row: number; population?: number } | undefined,
  claimed: ReadonlySet<string>,
): { cityId: string; col: number; row: number; value: number; foreign: boolean } | null {
  const homePop = home?.population ?? 1;
  const dist = (c: { col: number; row: number }): number =>
    Math.max(Math.abs(c.col - (home?.col ?? c.col)), Math.abs(c.row - (home?.row ?? c.row)));

  const candidates: Array<{ cityId: string; col: number; row: number; value: number; foreign: boolean }> = [];
  for (const city of world.cities) {
    if (city.civilizationId === civId && city.id === (home as { id?: string } | undefined)?.id) continue;
    const used = city.tradeRoutes?.length ?? 0;
    if (used >= MAX_TRADE_ROUTES) continue;
    const foreign = city.civilizationId !== civId;
    if (foreign) {
      if (world.isAtWar(civId, city.civilizationId)) continue;
      if (world.hasContacted && !world.hasContacted(civId, city.civilizationId)) continue;
    }
    // One caravan per slot this round: a city with 2 free slots may take 2.
    const claimsOnThisCity = [...claimed].filter((id) => id === city.id).length;
    if (claimsOnThisCity >= MAX_TRADE_ROUTES - used) continue;

    const d = dist(city);
    const value =
      (homePop + (city.population ?? 1)) * (1 + DISTANCE_WEIGHT * d) * (foreign ? 2 : 1);
    candidates.push({ cityId: city.id, col: city.col, row: city.row, value, foreign });
  }

  candidates.sort((a, b) => b.value - a.value);
  for (const candidate of candidates) {
    if (claimed.has(candidate.cityId)) continue;
    return candidate;
  }
  return null;
}
