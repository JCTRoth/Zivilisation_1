// Canonical data shapes live in `types/game`, like every other AI module here.
import type { City, Unit } from '../../../../types/game';
import type { MapTile } from '../GameEngine';
import { Pathfinding } from '../Pathfinding';
import {
  CARAVAN_BLOCK_PATIENCE,
  CARAVAN_DISBAND_PATIENCE,
  CARAVAN_MAX_SCOUTS,
  CARAVAN_RISK_THRESHOLD,
  CARAVAN_SAFE_ROUTE_PENALTY,
  MAX_CARAVANS_PER_CITY,
  MAX_CARAVAN_TRADE_ROUTES,
} from '../../../data/GameConstants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
 * The governor's memory for one caravan. Missions are STICKY on purpose: the
 * pre-governor code re-scored every city every turn, and because longer routes
 * score higher, walking toward a city changed the ranking mid-walk — the
 * caravan turned around, walked back, and repeated forever.
 */
export interface CaravanMission {
  kind: 'deliver' | 'scout' | 'idle';
  /** Delivery target city tile (kind 'deliver' only). */
  targetCol: number;
  targetRow: number;
  assignedRound: number;
  /** Consecutive turns without a usable route to the target. */
  stalls: number;
  /** Consecutive turns with nothing to do at all (no target, scout role taken). */
  idleTurns: number;
  /** The current route runs next to enemies (taken deliberately, see below). */
  risky: boolean;
  /** Targets this caravan proved unable to reach ("col,row"). */
  blacklisted: string[];
}

/** What the AI turn should do with this caravan this turn. */
export type CaravanPlan =
  /** Walk one step (the governor picked the step, risk-aware). */
  | { kind: 'move'; step: { col: number; row: number }; target: { col: number; row: number }; risky: boolean }
  /** No delivery in reach — fall through to the generic civilian exploration. */
  | { kind: 'scout' }
  /** Skip this turn (transient blockage, or another caravan holds the scout role). */
  | { kind: 'wait'; reason: 'blocked' | 'role_taken' }
  /** Give up on this caravan entirely (the very last resort). */
  | { kind: 'disband'; reason: 'surplus_over_cap' | 'no_target' };

// ---------------------------------------------------------------------------
// Governor
// ---------------------------------------------------------------------------

/**
 * Caravan Governor — the comprehensive manager of every Caravan's life.
 *
 * A Caravan is a defenceless trade engine: it walks from the city that built it
 * to another city and is consumed by the delivery, opening a permanent trade
 * route (Civ1). The governor owns the whole career of such a unit:
 *
 *  1. **Sticky delivery missions** — a target is chosen once (best reachable
 *     value) and kept until delivered, blocked for patience, or made
 *     ineligible. Re-scoring every turn made caravans pace back and forth.
 *  2. **Risk-taking routing** — caravans never detour out of fear; the plain
 *     A* route is taken even when it runs past enemy units. Only when a route
 *     is *very* risky (many enemies alongside) does the governor look for a
 *     safer alternate route to the SAME target — and if none exists, the
 *     risky route is still taken. Reaching the target matters more than the
 *     occasional loss.
 *  3. **Retarget only when the target is truly lost** — the city vanished, is
 *     no longer eligible (now at war, routes full), or no route exists for
 *     {@link CARAVAN_BLOCK_PATIENCE} turns (a chokepoint held by an enemy, a
 *     wide river discovered late). Then a fresh target is allocated; targets
 *     this caravan already failed to reach are blacklisted for it.
 *  4. **Scout duty, one at a time** — with nothing to deliver, the oldest
 *     idle caravan of a civ may scout ({@link CARAVAN_MAX_SCOUTS}); it falls
 *     through to the generic exploration. The moment a delivery target
 *     appears it drops the scout role and delivers again.
 *  5. **Disband as the last resort** — a caravan with no target and no scout
 *     role for {@link CARAVAN_DISBAND_PATIENCE} turns is disbanded, so it
 *     stops draining upkeep forever. Also enforced: at most
 *     {@link MAX_CARAVANS_PER_CITY} in-transit caravans per home city — the
 *     surplus (newest first) is disbanded and production is capped to match.
 *
 * All state lives here (missions, scout roles), keyed by unit id; the engine's
 * unit objects are untouched, so nothing leaks into save games.
 */
export class CaravanGovernor {
  private missions = new Map<string, CaravanMission>();
  /** civId → unitId of the one caravan on scout duty for that civ. */
  private scoutsByCiv = new Map<number, string>();

  // ── Public API (used by the AI turn and by tests) ──────────────────────

  /** The mission memory for a caravan, if any (test/diagnostic helper). */
  getMission(unitId: string): CaravanMission | undefined {
    return this.missions.get(unitId);
  }

  /** The unit id holding the scout role for a civ, if any. */
  getScoutHolder(civId: number): string | undefined {
    return this.scoutsByCiv.get(civId);
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
    if (existing?.kind === 'deliver' && !force) {
      if (existing.targetCol === col && existing.targetRow === row) return;
    }
    this.missions.set(unitId, {
      kind: 'deliver',
      targetCol: col,
      targetRow: row,
      assignedRound: round,
      stalls: 0,
      idleTurns: 0,
      risky: false,
      blacklisted: existing?.blacklisted ?? [],
    });
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

  /**
   * Decide what this caravan does this turn. Called once per caravan per
   * round, before the generic AI targeting runs.
   */
  planUnit(unit: Unit, world: CaravanWorld, round: number): CaravanPlan {
    // ── 0. Hard cap: at most MAX_CARAVANS_PER_CITY in-transit caravans per
    //       home city. The surplus (newest arrivals first) is disbanded so a
    //       city can never flood the map with its own caravans.
    const surplus = this.surplusPlan(unit, world);
    if (surplus) return surplus;

    // Danger map for risk decisions: enemy tiles and their neighbourhood.
    const danger = this.buildDangerMap(unit, world);
    const riskOf = (path: { col: number; row: number }[]): number =>
      path.reduce((n, step) => n + (danger.has(`${step.col},${step.row}`) ? 1 : 0), 0);

    let mission = this.missions.get(unit.id) ?? null;
    // Targets this caravan already failed to reach — survives mission drops.
    let blacklist: string[] = mission ? [...mission.blacklisted] : [];

    // ── 1. An existing mission is validated, never re-scored. ────────────
    if (mission?.kind === 'deliver') {
      const target = world.getCityAt(mission.targetCol, mission.targetRow);
      if (!target || !this.isEligibleTarget(unit, target, world)) {
        // The target is gone or no longer worth/allowed (routes full, now at
        // war, …) — drop the mission and allocate a fresh one below.
        blacklist = [...mission.blacklisted];
        this.missions.delete(unit.id);
        mission = null;
      } else {
        const plan = this.routePlan(unit, world, mission, danger, riskOf);
        if (plan) return plan;
        // No route right now. Hold the position for a few turns — chokepoint
        // blockers move on — and only then give the target up.
        mission.stalls += 1;
        if (mission.stalls >= CARAVAN_BLOCK_PATIENCE) {
          mission.blacklisted.push(`${mission.targetCol},${mission.targetRow}`);
          blacklist = [...mission.blacklisted];
          this.missions.delete(unit.id);
          mission = null;
          // fall through to a fresh allocation with the new blacklist
        } else {
          return { kind: 'wait', reason: 'blocked' };
        }
      }
    } else if (mission?.kind === 'scout') {
      // A scout upgrades to a delivery the moment one is reachable.
      const blacklist = mission.blacklisted;
      const picked = this.pickDeliveryTarget(unit, world, blacklist);
      if (picked) {
        this.releaseScoutRole(unit);
        mission = null;
        const fresh = this.startDeliveryMission(unit, picked, round, blacklist);
        const plan = this.routePlan(unit, world, fresh, danger, riskOf);
        if (plan) return plan;
        return { kind: 'wait', reason: 'blocked' };
      } else {
        return { kind: 'scout' };
      }
    }

    // ── 2. No active mission: allocate the best reachable delivery target.
    //       (Missions are sticky from here on — no per-turn re-ranking.)
    if (mission?.kind === 'idle') blacklist = [...mission.blacklisted];
    const picked = this.pickDeliveryTarget(unit, world, blacklist);
    if (picked) {
      const fresh = this.startDeliveryMission(unit, picked, round, blacklist);
      const plan = this.routePlan(unit, world, fresh, danger, riskOf);
      if (plan) return plan;
      // Route vanished between picking and planning (a unit moved into the
      // chokepoint): treat like a blocked mission next turn.
      return { kind: 'wait', reason: 'blocked' };
    }

    // ── 3. Nothing to deliver: scout, but only ONE caravan per civ. ──────
    if (this.acquireScoutRole(unit, world)) {
      this.missions.set(unit.id, {
        kind: 'scout',
        targetCol: unit.col,
        targetRow: unit.row,
        assignedRound: round,
        stalls: 0,
        idleTurns: 0,
        risky: false,
        blacklisted: blacklist,
      });
      return { kind: 'scout' };
    }

    // ── 4. Another caravan already scouts: wait — and as the very last
    //       resort, after CARAVAN_DISBAND_PATIENCE turns of doing nothing,
    //       disband so the unit stops draining upkeep forever.
    const idle = this.missions.get(unit.id);
    if (idle && idle.kind === 'idle') {
      idle.idleTurns += 1;
      if (idle.idleTurns >= CARAVAN_DISBAND_PATIENCE) {
        this.forget(unit.id);
        return { kind: 'disband', reason: 'no_target' };
      }
    } else {
      this.missions.set(unit.id, {
        kind: 'idle',
        targetCol: unit.col,
        targetRow: unit.row,
        assignedRound: round,
        stalls: 0,
        idleTurns: 1,
        risky: false,
        blacklisted: blacklist,
      });
    }
    return { kind: 'wait', reason: 'role_taken' };
  }

  /** A delivery step landed where the governor expected progress but failed. */
  reportMoveFailure(unitId: string): void {
    const mission = this.missions.get(unitId);
    if (mission && mission.kind === 'deliver') mission.stalls += 1;
  }

  /** Progress happened — the blocked-turn counter resets. */
  reportProgress(unitId: string): void {
    const mission = this.missions.get(unitId);
    if (mission) mission.stalls = 0;
  }

  // ── Internals ──────────────────────────────────────────────────────────

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
    return surplusIds.has(unit.id)
      ? { kind: 'disband', reason: 'surplus_over_cap' }
      : null;
  }

  /**
   * Route check for a delivery mission. Returns the 'move' plan (taking the
   * risky route, or a safer alternate when one clearly exists), or null when
   * there is no route at all right now.
   */
  private routePlan(
    unit: Unit,
    world: CaravanWorld,
    mission: CaravanMission,
    danger: Set<string>,
    riskOf: (path: { col: number; row: number }[]) => number,
  ): CaravanPlan | null {
    const target = { col: mission.targetCol, row: mission.targetRow };
    const plain = this.findRoute(unit, world, target, undefined, undefined);
    if (plain.length <= 1) {
      // No route (or already standing on the target — nothing to walk).
      return null;
    }
    const risk = riskOf(plain);
    mission.risky = risk >= CARAVAN_RISK_THRESHOLD;
    mission.stalls = 0;

    // "Take risks to reach the target — but if too risky, look for another
    //  route to the same target first."
    if (mission.risky) {
      const saferRoute = this.findRoute(unit, world, target, undefined, (col, row) =>
        danger.has(`${col},${row}`) ? CARAVAN_SAFE_ROUTE_PENALTY : 0,
      );
      if (saferRoute.length > 1 && riskOf(saferRoute) < risk) {
        mission.risky = riskOf(saferRoute) >= CARAVAN_RISK_THRESHOLD;
        return { kind: 'move', step: saferRoute[1], target, risky: mission.risky };
      }
      // No safer route exists — the risky one is still a route: take it.
    }
    return { kind: 'move', step: plain[1], target, risky: mission.risky };
  }

  private startDeliveryMission(
    unit: Unit,
    picked: { col: number; row: number },
    round: number,
    blacklist: string[],
  ): CaravanMission {
    const mission: CaravanMission = {
      kind: 'deliver',
      targetCol: picked.col,
      targetRow: picked.row,
      assignedRound: round,
      stalls: 0,
      idleTurns: 0,
      risky: false,
      blacklisted: [...blacklist],
    };
    this.missions.set(unit.id, mission);
    return mission;
  }

  /**
   * The best DELIVERY target this caravan can actually reach: candidates are
   * scored exactly as Civ1 did (bigger cities and longer routes pay more,
   * foreign routes double), but an unreachable candidate never wins — the
   * next-best reachable one is used instead.
   */
  private pickDeliveryTarget(
    unit: Unit,
    world: CaravanWorld,
    blacklist: string[],
  ): { col: number; row: number } | null {
    const civId = unit.civilizationId;
    const squareDistance = (c1: number, r1: number, c2: number, r2: number) =>
      world.squareGrid?.squareDistance(c1, r1, c2, r2) ?? Infinity;
    const home = world.getCaravanHomeCity(unit) ?? null;
    const homePop = home?.population ?? 1;

    const candidates: Array<{ col: number; row: number; value: number }> = [];
    const consider = (city: City, foreign: boolean): void => {
      if (blacklist.includes(`${city.col},${city.row}`)) return;
      if (!this.isEligibleTarget(unit, city, world)) return;
      const dist = Math.max(1, squareDistance(unit.col, unit.row, city.col, city.row));
      const value = (homePop + (city.population ?? 1)) * (1 + dist / 4) * (foreign ? 2 : 1);
      candidates.push({ col: city.col, row: city.row, value });
    };

    for (const city of world.cities) {
      if (city.civilizationId === civId) consider(city, false);
    }
    for (const city of world.cities) {
      if (city.civilizationId !== civId) consider(city, true);
    }

    candidates.sort((a, b) => b.value - a.value);
    for (const candidate of candidates) {
      const path = this.findRoute(unit, world, { col: candidate.col, row: candidate.row }, undefined, undefined);
      if (path.length > 1) return { col: candidate.col, row: candidate.row };
    }
    return null;
  }

  /** Civ1 delivery rules: own home city is excluded, foreign needs peace + knowledge. */
  private isEligibleTarget(unit: Unit, city: City, world: CaravanWorld): boolean {
    if ((city.tradeRoutes?.length ?? 0) >= MAX_CARAVAN_TRADE_ROUTES) return false;
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

  /** All enemy tiles plus their 8-neighbourhood — "danger" for risk scoring. */
  private buildDangerMap(unit: Unit, world: CaravanWorld): Set<string> {
    const danger = new Set<string>();
    for (const other of world.units) {
      if (other.civilizationId === unit.civilizationId || other.isDefeated) continue;
      for (let dc = -1; dc <= 1; dc += 1) {
        for (let dr = -1; dr <= 1; dr += 1) {
          danger.add(`${other.col + dc},${other.row + dr}`);
        }
      }
    }
    return danger;
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
      if (this.missions.get(unit.id)?.kind === 'scout') n += 1;
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
