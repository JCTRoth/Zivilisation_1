// Canonical data shapes live in `types/game`, like every other AI module here.
import type { City, Unit } from '../../../../types/game';
import type { MapTile } from '../GameEngine';
import { Pathfinding } from '../Pathfinding';
import {
  CARAVAN_BLOCK_PATIENCE,
  CARAVAN_DISBAND_PATIENCE,
  CARAVAN_ESCORT_PATIENCE,
  CARAVAN_ESCORT_RADIUS,
  CARAVAN_ESCORT_RISK_MIN,
  CARAVAN_MAX_SCOUTS,
  CARAVAN_MAX_TRANSIT_TURNS,
  CARAVAN_RISK_THRESHOLD,
  CARAVAN_SAFE_ROUTE_PENALTY,
  CARAVAN_PATH_DANGER_RADIUS,
  CARAVAN_THREAT_RADIUS,
  MAX_CARAVANS_PER_CITY,
  MAX_CARAVAN_TRADE_ROUTES,
} from '../../../data/GameConstants';

// ───────────────────────────────────────────────────────────────────────────
// Concepts
// ───────────────────────────────────────────────────────────────────────────

/** The slice of the engine the governor may look at (GameEngine satisfies it). */
export interface CaravanWorld {
  cities: City[];
  units: Unit[];
  map?: { width: number; height: number } | null;
  squareGrid?: { squareDistance(c1: number, r1: number, c2: number, r2: number): number } | null;
  getTileAt(col: number, row: number): MapTile | null;
  getUnitAt(col: number, row: number): { civilizationId: number } | null;
  getCityAt(col: number, row: number): City | null;
  getCaravanHomeCity(caravan: Unit): City | null;
  diplomacyManager?: { isAtWar(a: number, b: number): boolean } | null;
  getPlayerStorage?(civId: number):
    | {
        visibility: ArrayLike<number> | ArrayLike<boolean>;
        explored: ArrayLike<number> | ArrayLike<boolean>;
        enemyLocations?: Map<number, Array<{ type: string; col: number; row: number }>>;
      }
    | undefined;
}

/**
 * Where a mission is in its life.
 *
 *  - `outbound`   — a target is chosen, the caravan is walking to it;
 *  - `delivering` — the target is in reach this turn (it is on the city tile or
 *                   adjacent to it), one more step completes it;
 *  - `delivered`  — the route exists; the mission is over and will be pruned;
 *  - `scouting`   — there was nothing to deliver and this caravan holds the
 *                   civ's single scout slot;
 *  - `idle`       — nothing to deliver, no scout slot, waiting out its patience.
 */
type MissionPhase =
  | 'outbound'
  | 'delivering'
  | 'delivered'
  | 'scouting'
  | 'idle';

/** Why a mission stopped being a delivery. */
type AbortReason =
  | 'target_gone'
  | 'target_ineligible'
  | 'no_route_patience'
  | 'no_target'
  | 'transit_deadline'
  | 'surplus_over_cap';

/** Why the caravan is standing still this turn. */
type WaitReason =
  | 'blocked'
  | 'escort_pending'
  | 'role_taken';

/**
 * The governor's memory for one caravan.
 *
 * Missions are STICKY on purpose: the pre-governor code re-scored every city
 * every turn, and because longer routes score higher, walking toward a city
 * changed the ranking mid-walk — the caravan turned around, walked back, and
 * repeated forever.
 */
export interface CaravanMission {
  phase: MissionPhase;
  /** Delivery target city tile. */
  targetCol: number;
  targetRow: number;
  targetCityId: string | null;
  /** Round the mission was assigned (for the transit deadline). */
  assignedRound: number;
  /** Consecutive turns without a usable route to the target. */
  stalls: number;
  /** Turns spent outbound so far (the transit clock). */
  transitTurns: number;
  /** Consecutive turns with nothing to do at all (no target, scout role taken). */
  idleTurns: number;
  /** The current route runs next to enemies (taken deliberately, see below). */
  risky: boolean;
  /** Risk score of the current route (0 = clear). */
  risk: number;
  /** True while the caravan is waiting for an escort. */
  escortPending: boolean;
  /** Turns spent waiting for an escort. */
  escortTurns: number;
  /** Targets this caravan proved unable to reach ("col,row"). */
  blacklisted: string[];
}

/** What the AI turn should do with this caravan this turn. */
export type CaravanPlan =
  /** Walk (the governor picked the step, within the unit's movement budget). */
  | {
      kind: 'move';
      step: { col: number; row: number };
      target: { col: number; row: number };
      risky: boolean;
      /** How many tiles this step covers (roads let a caravan do several). */
      distanceCovered: number;
    }
  /** No delivery in reach — fall through to the generic civilian exploration. */
  | { kind: 'scout' }
  /** Skip this turn. */
  | { kind: 'wait'; reason: WaitReason }
  /** Give up on this caravan entirely (the very last resort). */
  | { kind: 'disband'; reason: AbortReason };

/** Everything the governor knows about a route before committing to it. */
export interface RouteValuation {
  cityId: string;
  col: number;
  row: number;
  /** Lump-sum gold+science the delivery pays. */
  routeValue: number;
  /** Per-turn trade the permanent route adds to the home city. */
  routeTrade: number;
  /** Turns of walking the route costs, in the unit's movement terms. */
  travelTurns: number;
  /** routeValue / travelTurns — the number routes are ranked by. */
  valuePerTurn: number;
  /** True when the destination belongs to another civ (pays double). */
  foreign: boolean;
  /** Extra trade the new route adds over the one it would evict (≤0 = pointless). */
  slotGain: number;
  /** Risk score of the chosen path (0 = clear). */
  risk: number;
  /** A* cost of the path, in movement points. */
  pathCost: number;
}

/** Per-civ fleet statistics (diagnostics + the coordinator). */
export interface CaravanLedger {
  civId: number;
  inFlight: number;
  deliveries: number;
  transitTurnsTotal: number;
  lastDeliveryRound: number;
  aborted: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Governor
// ───────────────────────────────────────────────────────────────────────────

/**
 * Caravan Governor — the career manager of one Caravan.
 *
 * A Caravan is a defenceless trade engine: it walks from the city that built it
 * to another city and is consumed by the delivery, opening a permanent trade
 * route (Civ1). The governor owns that career:
 *
 *  1. **Sticky delivery missions** — a target is chosen once (best value per
 *     TURN of travel, not per trip) and kept until delivered, ineligible or
 *     out of patience. Re-scoring every turn made caravans pace back and forth.
 *  2. **Route economics** — a destination is worth taking for its
 *     `routeValue / travelTurns`, and a city whose route slots are full is only
 *     worth taking when the route it would evict is weaker than the new one.
 *  3. **Movement budget** — a step covers as many tiles as the unit can pay
 *     for, so a road (1/3) or a railroad (~1/20) shortens the delivery instead
 *     of leaving the caravan crawling one tile a turn.
 *  4. **Threat profile** — enemies near the route are weighted by distance and
 *     by whether they can catch up; a risky route is answered by a detour, by
 *     waiting for an escort, or (last) by taking it anyway.
 *  5. **Transit deadline** — a mission that has walked longer than
 *     `CARAVAN_MAX_TRANSIT_TURNS` is abandoned and its target blacklisted.
 *  6. **Scout duty, one at a time** — with nothing to deliver, the oldest idle
 *     caravan of a civ may scout; it drops the role the moment a target appears.
 *  7. **Disband as the last resort** — a caravan with no target and no scout
 *     role for `CARAVAN_DISBAND_PATIENCE` turns is disbanded, so it stops
 *     draining upkeep forever. At most `MAX_CARAVANS_PER_CITY` in-transit
 *     caravans per home city; the surplus (newest first) goes.
 *
 * All state lives here (missions, scout roles, the per-civ ledger), keyed by
 * unit id; the engine's unit objects are untouched, so nothing leaks into save
 * games.
 */
export class CaravanGovernor {
  private missions = new Map<string, CaravanMission>();
  /** civId → unitId of the one caravan on scout duty for that civ. */
  private scoutsByCiv = new Map<number, string>();
  /** civId → fleet statistics. */
  private ledgers = new Map<number, CaravanLedger>();

  // ── Public API (used by the AI turn and by tests) ──────────────────────

  /** The mission memory for a caravan, if any (test/diagnostic helper). */
  getMission(unitId: string): CaravanMission | undefined {
    return this.missions.get(unitId);
  }

  /** The unit id holding the scout role for a civ, if any. */
  getScoutHolder(civId: number): string | undefined {
    return this.scoutsByCiv.get(civId);
  }

  /** Fleet statistics for one civ (diagnostics + the coordinator). */
  getLedger(civId: number): CaravanLedger | undefined {
    return this.ledgers.get(civId);
  }

  /** Every unit id that currently holds a delivery mission. */
  activeDeliveries(): string[] {
    return [...this.missions.entries()]
      .filter(([, m]) => m.phase === 'outbound' || m.phase === 'delivering')
      .map(([id]) => id);
  }

  /**
   * Force a delivery mission for this caravan, replacing whatever it was doing.
   *
   * The CaravanCoordinator's hook: it owns the CIV-level answer (where each
   * caravan goes, so two never race for the same route slot) and this is how it
   * hands that answer in. An existing delivery mission is left alone unless
   * `force` is set — the coordinator re-plans every round, and re-targeting a
   * caravan that is already mid-walk is exactly the pacing behaviour the sticky
   * missions exist to prevent.
   */
  assignTarget(unitId: string, col: number, row: number, round: number, force = false): void {
    const existing = this.missions.get(unitId);
    // A delivery already in progress is LEFT ALONE. The instinct to also allow a
    // re-target when the coordinates happen to match is harmless; the mistake is
    // the other way round — falling through when they do not, which re-targeted
    // every walking caravan every single round and defeated the sticky mission
    // the whole governor exists to provide.
    if (existing && (existing.phase === 'outbound' || existing.phase === 'delivering') && !force) {
      return;
    }
    this.missions.set(unitId, this.freshMission(col, row, round, null));
  }

  /** Drop all memory of a unit (called when it dies, delivers or is disbanded). */
  forget(unitId: string): void {
    const mission = this.missions.get(unitId);
    if (mission) {
      const civId = this.civIdOfScoutHolder(unitId);
      if (civId !== null) this.scoutsByCiv.delete(civId);
    }
    this.missions.delete(unitId);
  }

  /** Forget missions of units that no longer exist; free dead scouts. */
  pruneMissing(units: Unit[]): void {
    const alive = new Set(units.map((u) => u.id));
    for (const unitId of [...this.missions.keys()]) {
      if (!alive.has(unitId)) this.forget(unitId);
    }
    for (const [civId, unitId] of [...this.scoutsByCiv.entries()]) {
      if (!alive.has(unitId)) this.scoutsByCiv.delete(civId);
    }
  }

  /** How many in-transit caravans a home city currently has (cap = 3). */
  static caravansOfCity(world: CaravanWorld, cityId: string): number {
    return world.units.filter(
      (u) => u.type === 'caravan' && !u.isDefeated && u.homeCityId === cityId,
    ).length;
  }

  // ── The turn ───────────────────────────────────────────────────────────

  /**
   * Decide what this caravan does this turn. Called once per caravan per round,
   * before the generic AI targeting runs.
   */
  planUnit(unit: Unit, world: CaravanWorld, round: number): CaravanPlan {
    // ── 0. Hard cap: at most MAX_CARAVANS_PER_CITY in-transit caravans per
    //       home city. The surplus (newest arrivals first) is disbanded so a
    //       city can never flood the map with its own caravans.
    const surplus = this.surplusPlan(unit, world);
    if (surplus) return surplus;

    const civId = unit.civilizationId;
    this.ledger(civId).inFlight = CaravanGovernor.caravansOfCity(
      world, String(unit.homeCityId ?? ''),
    );

    let mission = this.missions.get(unit.id) ?? null;
    // Targets this caravan already failed to reach — survives mission drops.
    let blacklist: string[] = mission ? [...mission.blacklisted] : [];

    // ── 1. An existing mission is validated, never re-scored. ──────────────
    if (mission && (mission.phase === 'outbound' || mission.phase === 'delivering')) {
      const target = world.getCityAt(mission.targetCol, mission.targetRow);
      if (!target || !this.isEligibleTarget(unit, target, world)) {
        blacklist = [...mission.blacklisted];
        this.abort(civId, unit.id, 'target_gone');
        mission = null;
      } else {
        // Transit clock: a route that takes forever is not a route.
        mission.transitTurns += 1;
        if (mission.transitTurns > CARAVAN_MAX_TRANSIT_TURNS) {
          blacklist = this.blacklistTarget(mission);
          this.abort(civId, unit.id, 'transit_deadline');
          mission = null;
        } else {
          const plan = this.routePlan(unit, world, mission);
          if (plan) return plan;
          mission.stalls += 1;
          if (mission.stalls >= CARAVAN_BLOCK_PATIENCE) {
            blacklist = this.blacklistTarget(mission);
            this.abort(civId, unit.id, 'no_route_patience');
            mission = null;
            // fall through to a fresh allocation with the new blacklist
          } else {
            return { kind: 'wait', reason: 'blocked' };
          }
        }
      }
    } else if (mission?.phase === 'scouting') {
      // A scout upgrades to a delivery the moment one is reachable.
      const picked = this.pickDeliveryTarget(unit, world, mission.blacklisted);
      if (picked) {
        this.releaseScoutRole(unit);
        mission = this.startDelivery(unit.id, picked, round, mission.blacklisted);
        const plan = this.routePlan(unit, world, mission);
        if (plan) return plan;
        return { kind: 'wait', reason: 'blocked' };
      }
      return { kind: 'scout' };
    }

    // ── 2. No active mission: allocate the best reachable delivery target.
    const picked = this.pickDeliveryTarget(unit, world, blacklist);
    if (picked) {
      const fresh = this.startDelivery(unit.id, picked, round, blacklist);
      const plan = this.routePlan(unit, world, fresh);
      if (plan) return plan;
      // The route vanished between picking and planning (a unit moved into the
      // chokepoint): treat like a blocked mission next turn.
      return { kind: 'wait', reason: 'blocked' };
    }

    // ── 3. Nothing to deliver: scout, but only ONE caravan per civ. ────────
    if (this.acquireScoutRole(unit, world)) {
      this.missions.set(unit.id, {
        phase: 'scouting',
        targetCol: unit.col,
        targetRow: unit.row,
        targetCityId: null,
        assignedRound: round,
        stalls: 0,
        transitTurns: 0,
        idleTurns: 0,
        risky: false,
        risk: 0,
        escortPending: false,
        escortTurns: 0,
        blacklisted: blacklist,
      });
      return { kind: 'scout' };
    }

    // ── 4. Another caravan already scouts: wait — and as the very last
    //       resort, after CARAVAN_DISBAND_PATIENCE turns of doing nothing,
    //       disband so the unit stops draining upkeep forever.
    const idle = this.missions.get(unit.id);
    if (idle && idle.phase === 'idle') {
      idle.idleTurns += 1;
      if (idle.idleTurns >= CARAVAN_DISBAND_PATIENCE) {
        this.forget(unit.id);
        this.ledger(unit.civilizationId).aborted += 1;
        return { kind: 'disband', reason: 'no_target' };
      }
    } else {
      this.missions.set(unit.id, {
        phase: 'idle',
        targetCol: unit.col,
        targetRow: unit.row,
        targetCityId: null,
        assignedRound: round,
        stalls: 0,
        transitTurns: 0,
        idleTurns: 1,
        risky: false,
        risk: 0,
        escortPending: false,
        escortTurns: 0,
        blacklisted: blacklist,
      });
    }
    return { kind: 'wait', reason: 'role_taken' };
  }

  /** A delivery step landed where the governor expected progress but failed. */
  reportMoveFailure(unitId: string): void {
    const mission = this.missions.get(unitId);
    if (mission && (mission.phase === 'outbound' || mission.phase === 'delivering')) {
      mission.stalls += 1;
    }
  }

  /** Progress happened — the blocked-turn counter resets. */
  reportProgress(unitId: string): void {
    const mission = this.missions.get(unitId);
    if (mission) mission.stalls = 0;
  }

  // ── Internals: surplus and lifecycle ───────────────────────────────────

  /** Per-city cap: the newest caravans above MAX_CARAVANS_PER_CITY are disbanded. */
  private surplusPlan(unit: Unit, world: CaravanWorld): CaravanPlan | null {
    if (!unit.homeCityId || unit.isDefeated) return null;
    const siblings = world.units.filter(
      (u) => u.type === 'caravan' && !u.isDefeated && u.homeCityId === unit.homeCityId,
    );
    if (siblings.length <= MAX_CARAVANS_PER_CITY) return null;
    // `world.units` is append-ordered, so the array index approximates age:
    // the caravans with the highest indices are the newest — they go first.
    const byAge = new Map(siblings.map((u) => [u.id, world.units.indexOf(u)]));
    byAge.set(unit.id, world.units.indexOf(unit));
    const surplusIds = new Set(
      [...byAge.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, siblings.length - MAX_CARAVANS_PER_CITY)
        .map(([id]) => id),
    );
    if (!surplusIds.has(unit.id)) return null;
    const ledger = this.ledger(unit.civilizationId);
    ledger.aborted += 1;
    this.missions.delete(unit.id);
    return { kind: 'disband', reason: 'surplus_over_cap' };
  }

  /** A delivery completed: the route exists, the caravan is gone. */
  reportDelivery(civId: number, unitId: string): void {
    const mission = this.missions.get(unitId);
    if (!mission) return;
    const ledger = this.ledger(civId);
    ledger.deliveries += 1;
    ledger.transitTurnsTotal += mission.transitTurns;
    ledger.lastDeliveryRound = mission.assignedRound + mission.transitTurns;
    this.forget(unitId);
  }

  private freshMission(
    col: number,
    row: number,
    round: number,
    blacklisted: readonly string[] | null,
  ): CaravanMission {
    return {
      phase: 'outbound',
      targetCol: col,
      targetRow: row,
      targetCityId: null,
      assignedRound: round,
      stalls: 0,
      transitTurns: 0,
      idleTurns: 0,
      risky: false,
      risk: 0,
      escortPending: false,
      escortTurns: 0,
      // `assignTarget` hands in `null` for "no memory yet" — a mission created by
      // the coordinator has no history of its own. Spreading it used to throw a
      // TypeError inside every AI turn that had an assignment, and the turn's own
      // catch swallowed it, so the civ silently stopped acting at all.
      blacklisted: blacklisted ? [...blacklisted] : [],
    };
  }

  private startDelivery(
    unitId: string,
    picked: { cityId: string; col: number; row: number },
    round: number,
    blacklist: string[],
  ): CaravanMission {
    const mission = this.freshMission(picked.col, picked.row, round, blacklist);
    mission.targetCityId = picked.cityId;
    this.missions.set(unitId, mission);
    return mission;
  }

  private abort(civId: number, unitId: string, reason: AbortReason): void {
    this.ledger(civId).aborted += 1;
    this.missions.delete(unitId);
    void reason;
  }

  private blacklistTarget(mission: CaravanMission): string[] {
    return [...mission.blacklisted, `${mission.targetCol},${mission.targetRow}`];
  }

  private ledger(civId: number): CaravanLedger {
    let ledger = this.ledgers.get(civId);
    if (!ledger) {
      ledger = { civId, inFlight: 0, deliveries: 0, transitTurnsTotal: 0, lastDeliveryRound: 0, aborted: 0 };
      this.ledgers.set(civId, ledger);
    }
    return ledger;
  }

  // ── Internals: routing ─────────────────────────────────────────────────

  /**
   * Route check for a delivery mission: pick this turn's step within the unit's
   * movement budget, or hand back a reason to stand still.
   */
  private routePlan(
    unit: Unit,
    world: CaravanWorld,
    mission: CaravanMission,
  ): CaravanPlan | null {
    const target = { col: mission.targetCol, row: mission.targetRow };
    const plain = this.findRoute(unit, world, target, undefined, undefined);
    if (plain.length <= 1) return null; // no route (or already on the target)

    const risk = this.riskOf(unit, world, plain);
    mission.risk = risk;
    mission.risky = risk >= CARAVAN_RISK_THRESHOLD;
    mission.stalls = 0;

    // "Take risks to reach the target — but if too risky, look for another
    //  route to the same target first."
    let route = plain;
    if (mission.risky) {
      const saferRoute = this.findRoute(unit, world, target, undefined, (col, row) =>
        this.dangerAt(world, col, row, unit) ? CARAVAN_SAFE_ROUTE_PENALTY : 0,
      );
      if (saferRoute.length > 1 && this.riskOf(unit, world, saferRoute) < risk) {
        route = saferRoute;
        mission.risky = this.riskOf(unit, world, route) >= CARAVAN_RISK_THRESHOLD;
        mission.risk = this.riskOf(unit, world, route);
      }
      // No safer route exists — the risky one is still a route: take it.
    }

    // Escort: a risky route with a friendly hull nearby is worth waiting for
    // rather than feeding a defenceless unit to the threat.
    if (mission.risk >= CARAVAN_ESCORT_RISK_MIN && this.hasEscortNearby(unit, world)) {
      if (mission.escortTurns < CARAVAN_ESCORT_PATIENCE) {
        mission.escortPending = true;
        mission.escortTurns += 1;
        return { kind: 'wait', reason: 'escort_pending' };
      }
      mission.escortPending = false;
    }

    // The step is as far along the route as this unit can pay for.
    const step = this.stepWithinBudget(unit, world, route);
    if (!step) return null; // cannot afford the first tile this turn
    return {
      kind: 'move',
      step,
      target,
      risky: mission.risky,
      distanceCovered: Math.max(Math.abs(step.col - unit.col), Math.abs(step.row - unit.row)),
    };
  }

  /** Movement points the whole path costs, tile by tile (roads included). */
  private walkCostOf(
    path: Array<{ col: number; row: number }>,
    unit: Unit,
    world: CaravanWorld,
  ): number {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const tile = world.getTileAt(path[i].col, path[i].row);
      total += Pathfinding.getMovementCost(tile as MapTile, unit.type);
    }
    return total;
  }

  /** The furthest tile along `path` the unit can pay for with its movement. */
  private stepWithinBudget(
    unit: Unit,
    world: CaravanWorld,
    path: Array<{ col: number; row: number }>,
  ): { col: number; row: number } | null {
    const budget = this.movementOf(unit);
    let remaining = budget;
    let chosen = path[0];
    for (let i = 1; i < path.length; i++) {
      const tile = world.getTileAt(path[i].col, path[i].row);
      const cost = Pathfinding.getMovementCost(tile as MapTile, unit.type);
      if (!Number.isFinite(cost) || cost > remaining) break;
      const occupant = world.getUnitAt(path[i].col, path[i].row);
      if (occupant && occupant.civilizationId !== unit.civilizationId) break;
      remaining -= cost;
      chosen = path[i];
    }
    // Standing still is not a step.
    return chosen.col === unit.col && chosen.row === unit.row ? null : chosen;
  }

  private movementOf(unit: Unit): number {
    const movement = (unit as unknown as { movement?: number }).movement;
    return typeof movement === 'number' && movement > 0 ? movement : 1;
  }

  // ── Internals: target selection ────────────────────────────────────────

  /**
   * The best delivery target this caravan can actually reach, ranked by
   * **value per turn of travel** — the number that matters for a unit with
   * movement 1. Distance no longer multiplies value; it divides it.
   */
  private pickDeliveryTarget(
    unit: Unit,
    world: CaravanWorld,
    blacklist: string[],
  ): { cityId: string; col: number; row: number } | null {
    const home = world.getCaravanHomeCity(unit) ?? null;
    const homePop = home?.population ?? 1;

    const scored: Array<{ cityId: string; col: number; row: number; score: number }> = [];
    const consider = (city: City, foreign: boolean): void => {
      if (blacklist.includes(`${city.col},${city.row}`)) return;
      if (!this.isEligibleTarget(unit, city, world)) return;
      const valuation = this.valueRoute(unit, world, city, homePop, foreign);
      if (!valuation) return;                 // unreachable, or not worth a slot
      scored.push({ cityId: city.id, col: city.col, row: city.row, score: valuation.valuePerTurn });
    };

    // Own cities first (always legal, no war risk), then foreign ones.
    for (const city of world.cities) {
      if (city.civilizationId === unit.civilizationId) consider(city, false);
    }
    for (const city of world.cities) {
      if (city.civilizationId !== unit.civilizationId) consider(city, true);
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.length > 0
      ? { cityId: scored[0].cityId, col: scored[0].col, row: scored[0].row }
      : null;
  }

  /**
   * Everything a route is worth, or null when it is not worth taking.
   *
   * A destination is refused when:
   *  - no route exists at all;
   *  - the route would take longer than `CARAVAN_MAX_TRANSIT_TURNS`;
   *  - its route slots are full AND the route it would evict is at least as
   *    strong as the new one (`slotGain <= 0`).
   */
  private valueRoute(
    unit: Unit,
    world: CaravanWorld,
    city: City,
    homePop: number,
    foreign: boolean,
  ): RouteValuation | null {
    const path = this.findRoute(unit, world, { col: city.col, row: city.row }, undefined, undefined);
    if (path.length <= 1) return null;

    const pathCost = path.length - 1;
    // Turns of WALKING, counted the way the step above counts them: a roaded tile
    // costs a third of a turn and open ground a whole one. Dividing the tile
    // count by 3 always assumed the whole route was paved, which flattered every
    // route threefold on a clean map — and the value-per-turn ranking is what the
    // target choice is driven by, so the AI reached for the far cities.
    const travelTurns = Math.max(1, Math.ceil(this.walkCostOf(path, unit, world) / this.movementOf(unit)));
    if (travelTurns > CARAVAN_MAX_TRANSIT_TURNS) return null;

    const destPop = city.population ?? 1;
    const intercontinental = false; // land routes only; ships handle the rest
    const routeValue = Math.max(
      1,
      Math.round((homePop + destPop) * (1 + pathCost / 4) * (foreign ? 2 : 1)),
    );
    const routeTrade = Math.max(1, Math.round((homePop + destPop) / 2));

    // Route slots: the engine evicts the OLDEST when a new one arrives, so a
    // full city is still worth a visit when the route being evicted is weaker.
    const routes = city.tradeRoutes ?? [];
    const slotsUsed = routes.length;
    let evictedTrade = 0;
    if (slotsUsed >= MAX_CARAVAN_TRADE_ROUTES) {
      let oldestIdx = 0;
      for (let i = 1; i < routes.length; i++) {
        if ((routes[i].round ?? 0) < (routes[oldestIdx].round ?? 0)) oldestIdx = i;
      }
      evictedTrade = routes[oldestIdx]?.trade ?? 0;
    }
    const slotGain = routeTrade - evictedTrade;
    if (slotsUsed >= MAX_CARAVAN_TRADE_ROUTES && slotGain <= 0) return null;

    void intercontinental;
    const risk = this.riskOf(unit, world, path);
    return {
      cityId: city.id,
      col: city.col,
      row: city.row,
      routeValue,
      routeTrade,
      travelTurns,
      valuePerTurn: routeValue / travelTurns,
      foreign,
      slotGain,
      risk,
      pathCost,
    };
  }

  /** Civ1 delivery rules: own home city is excluded, foreign needs peace + knowledge. */
  private isEligibleTarget(unit: Unit, city: City, world: CaravanWorld): boolean {
    if ((city.tradeRoutes?.length ?? 0) >= MAX_CARAVAN_TRADE_ROUTES) {
      // Full slots are only a stop when the new route would be an upgrade —
      // decided in `valueRoute`, which needs the path and both trade values.
      // Here we only refuse cities that are full AND owned by us without any
      // prospect of improvement.
      const routes = city.tradeRoutes ?? [];
      // Only a route with a KNOWN, tiny trade counts as evictable. A route
      // with no trade value is malformed, and gambling a caravan on it is how
      // a fleet ends up churning routes between two full cities.
      const hasWeak = routes.some((r) => typeof r.trade === 'number' && r.trade <= 1);
      if (!hasWeak) return false;
    }
    if (city.civilizationId === unit.civilizationId) {
      const home = world.getCaravanHomeCity(unit);
      if (home && home.id === city.id) return false;
      return true;
    }
    if (world.diplomacyManager?.isAtWar?.(unit.civilizationId, city.civilizationId)) return false;
    return this.isCityKnown(unit, city, world);
  }

  /** The same "known city" rule the old chooser used (visible or scouted). */
  private isCityKnown(unit: Unit, city: City, world: CaravanWorld): boolean {
    const storage = world.getPlayerStorage?.(unit.civilizationId);
    if (storage) {
      const idx = city.row * (world.map?.width ?? 0) + city.col;
      if (storage.visibility[idx] || storage.explored[idx]) return true;
      if (storage.enemyLocations instanceof Map) {
        for (const [enemyCivId, locations] of storage.enemyLocations.entries()) {
          if (enemyCivId === unit.civilizationId) continue;
          if (locations.some((loc) => loc.type === 'city' && loc.col === city.col && loc.row === city.row)) {
            return true;
          }
        }
      }
      return false;
    }
    const tile = world.getTileAt(city.col, city.row);
    return !!tile && (tile.visible || tile.explored);
  }

  // ── Internals: threat ──────────────────────────────────────────────────

  /**
   * Enemy units within `CARAVAN_THREAT_RADIUS` of the route, weighted by
   * distance and by whether they can catch a caravan at all.
   */
  private riskOf(
    unit: Unit,
    world: CaravanWorld,
    path: Array<{ col: number; row: number }>,
  ): number {
    const near = new Set(path.map((p) => `${p.col},${p.row}`));
    let risk = 0;
    for (const other of world.units) {
      if (other.civilizationId === unit.civilizationId || other.isDefeated) continue;
      const speed = (other as unknown as { movement?: number }).movement ?? 1;
      // A unit that cannot move cannot catch a caravan; one that is slower
      // than a third of the caravan's pace never will either.
      if (speed < 1) continue;
      for (const key of near) {
        const sep = key.indexOf(',');
        if (sep === -1) continue;
        const col = Number(key.slice(0, sep));
        const row = Number(key.slice(sep + 1));
        const d = Math.max(Math.abs(other.col - col), Math.abs(other.row - row));
        if (d > CARAVAN_THREAT_RADIUS) continue;
        // Only an enemy that can END ITS TURN on a route tile can actually eat
        // the caravan: with movement 1 on both sides that means d ≤ 1. An enemy
        // two tiles out closes no net ground, so it contributes nothing —
        // counting it made every route near any enemy "risky", and then no
        // detour ever looked safer than the direct one.
        const weight = (d === 0 ? 2 : 1) * (speed >= 1 ? 1 : 0.5);
        risk += weight;
      }
    }
    return risk;
  }

  /**
   * Whether this tile is dangerous to WALK ON — an enemy close enough to step
   * onto it. Tight by design: see `CARAVAN_PATH_DANGER_RADIUS`.
   */
  private dangerAt(world: CaravanWorld, col: number, row: number, unit: Unit): boolean {
    return world.units.some((other) => {
      if (other.civilizationId === unit.civilizationId || other.isDefeated) return false;
      const d = Math.max(Math.abs(other.col - col), Math.abs(other.row - row));
      return d <= CARAVAN_PATH_DANGER_RADIUS;
    });
  }

  /** Whether a friendly military unit close enough to escort is available. */
  private hasEscortNearby(unit: Unit, world: CaravanWorld): boolean {
    return world.units.some((other) => {
      if (other.civilizationId !== unit.civilizationId || other.isDefeated) return false;
      if (other.id === unit.id) return false;
      const attack = (other as unknown as { attack?: number }).attack ?? 0;
      if (attack <= 0) return false;
      const d = Math.max(Math.abs(other.col - unit.col), Math.abs(other.row - unit.row));
      return d <= CARAVAN_ESCORT_RADIUS;
    });
  }

  private findRoute(
    unit: Unit,
    world: CaravanWorld,
    target: { col: number; row: number },
    blocked: Set<string> | undefined,
    extraCost: ((col: number, row: number) => number) | undefined,
  ): { col: number; row: number }[] {
    const map = world.map;
    const grid = world.squareGrid;
    if (!map || !grid) return [];
    const result = Pathfinding.findPath(
      unit.col, unit.row, target.col, target.row,
      (c, r) => world.getTileAt(c, r),
      unit.type,
      map.width, map.height,
      (c, r) => world.getUnitAt(c, r),
      unit.civilizationId,
      (c, r) => world.getCityAt(c, r),
      blocked,
      extraCost,
    );
    return result.path;
  }

  // ── Internals: scout arbitration ───────────────────────────────────────

  private acquireScoutRole(unit: Unit, world: CaravanWorld): boolean {
    const holder = this.scoutsByCiv.get(unit.civilizationId);
    if (holder !== undefined && holder !== unit.id) {
      const alive = world.units.some((u) => u.id === holder && !u.isDefeated);
      if (alive) return false; // another caravan already scouts
      this.scoutsByCiv.delete(unit.civilizationId); // dead scout frees the role
    }
    if (this.countScouts(world, unit.civilizationId) >= CARAVAN_MAX_SCOUTS) return false;
    this.scoutsByCiv.set(unit.civilizationId, unit.id);
    return true;
  }

  private countScouts(world: CaravanWorld, civId: number): number {
    let n = 0;
    for (const unit of world.units) {
      if (unit.civilizationId !== civId || unit.type !== 'caravan' || unit.isDefeated) continue;
      if (this.missions.get(unit.id)?.phase === 'scouting') n += 1;
    }
    return n;
  }

  private releaseScoutRole(unit: Unit): void {
    if (this.scoutsByCiv.get(unit.civilizationId) === unit.id) {
      this.scoutsByCiv.delete(unit.civilizationId);
    }
    this.missions.delete(unit.id);
  }

  private civIdOfScoutHolder(unitId: string): number | null {
    for (const [civId, holder] of this.scoutsByCiv.entries()) {
      if (holder === unitId) return civId;
    }
    return null;
  }
}
