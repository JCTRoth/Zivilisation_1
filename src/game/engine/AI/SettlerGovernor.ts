// Canonical data shapes live in `types/game`, like every other AI module here.
// (`../../City` exports the engine class, whose fields are `civilization` etc.,
// and `../../Unit` does not export its class at all.)
import type { City, Unit } from '../../../../types/game';
import {
  SettlerMemory,
  type SiteMemory,
  type TileImprovementMemory,
} from './SettlerMemory';

export interface SettlerWorkAssignment {
  unitId: string;
  targetCol: number;
  targetRow: number;
  improvementType: string;
}

export interface ImprovementNeed {
  col: number;
  row: number;
  improvementType: string;
  priority: number;
}

/** Tiles one works-settler is expected to cover before it needs replacing. */
const WORKS_TILES_PER_SETTLER = 4;

/** Ceiling on the public-works corps, however much work is outstanding. */
const MAX_WORKS_CORPS = 3;

/**
 * How the governor learns how much work is outstanding. Injected by its owner
 * (`AIManager`) because the count needs the map, the terrain tables and the
 * city radii — all of which live above this module.
 */
export type OutstandingWorksFn = (civId: number) => number;

export class SettlerGovernor {
  private assignments: Map<string, SettlerWorkAssignment> = new Map();
  private improvementQueue: ImprovementNeed[] = [];
  /** Set by the owner; falls back to the governor's own queue when absent. */
  private outstandingWorks: OutstandingWorksFn | null = null;
  /**
   * Outstanding work the civ's settlers can actually WALK to. Preferred over
   * `outstandingWorks` when present: the raw count includes tiles on other
   * landmasses that no settler may work, and a corps sized for them is a corps
   * standing still.
   */
  private reachableWorks: OutstandingWorksFn | null = null;
  /** Persistent, turn-keyed memory: colony sites, settler losses, improved tiles, ledger. */
  private memory: SettlerMemory;

  constructor(memory?: SettlerMemory) {
    this.memory = memory ?? new SettlerMemory();
  }

  /** Wire the ground-truth work count in (see {@link OutstandingWorksFn}). */
  setOutstandingWorksSource(fn: OutstandingWorksFn | null): void {
    this.outstandingWorks = fn;
  }

  /** Wire the REACHABLE-work count in (see {@link reachableWorks}). */
  setReachableWorksSource(fn: OutstandingWorksFn | null): void {
    this.reachableWorks = fn;
  }

  getAssignment(unitId: string): SettlerWorkAssignment | undefined {
    return this.assignments.get(unitId);
  }

  assignWork(unitId: string, targetCol: number, targetRow: number, improvementType: string): void {
    this.assignments.set(unitId, { unitId, targetCol, targetRow, improvementType });
  }

  completeAssignment(unitId: string): void {
    this.assignments.delete(unitId);
  }

  getAssignedCount(): number {
    return this.assignments.size;
  }

  getQueuedImprovements(): ImprovementNeed[] {
    return [...this.improvementQueue];
  }

  queueImprovement(need: ImprovementNeed): void {
    const exists = this.improvementQueue.some(
      (n) => n.col === need.col && n.row === need.row && n.improvementType === need.improvementType,
    );
    if (!exists) {
      this.improvementQueue.push(need);
      this.improvementQueue.sort((a, b) => b.priority - a.priority);
    }
  }

  dequeueImprovement(): ImprovementNeed | undefined {
    return this.improvementQueue.shift();
  }

  getQueueLength(): number {
    return this.improvementQueue.length;
  }

  updateFromCities(cities: City[], units: Unit[], turn?: number): void {
    if (typeof turn === 'number') this.memory.recordTurn(turn);
    const settlers = units.filter(
      (u: Unit) => u.type === 'settler' && !u.isDefeated,
    );

    for (const settler of settlers) {
      if (!this.assignments.has(settler.id)) {
        const target = this.findBestImprovementTarget(settler, cities, units);
        if (target) {
          this.assignWork(settler.id, target.col, target.row, target.improvementType);
        }
      }
    }

    for (const [unitId, assignment] of this.assignments) {
      const settler = units.find((u: Unit) => u.id === unitId);
      if (!settler || settler.isDefeated) {
        this.assignments.delete(unitId);
        continue;
      }
      if (settler.col === assignment.targetCol && settler.row === assignment.targetRow) {
        this.assignments.delete(unitId);
      }
    }
  }

  private findBestImprovementTarget(
    settler: Unit,
    cities: City[],
    units?: readonly Unit[],
  ): { col: number; row: number; improvementType: string } | null {
    let bestTarget: { col: number; row: number; improvementType: string } | null = null;
    let bestScore = -Infinity;

    for (const city of cities) {
      if (city.civilizationId !== settler.civilizationId) continue;

      const cityCenter = `${city.col},${city.row}`;
      const workingTiles = city.workingTiles ?? new Set<string>();

      for (const key of workingTiles) {
        if (key === cityCenter) continue;
        const parts = key.split(',');
        const col = Number(parts[0]);
        const row = Number(parts[1]);
        if (!Number.isFinite(col) || !Number.isFinite(row)) continue;

        // Memory: a settler already improved this tile — don't send another.
        if (this.memory.isTileImproved(key)) continue;

        const isOccupied = this.assignments.has(`${col},${row}`);
        if (isOccupied) continue;

        const improvementType = this.determineImprovementType(city, col, row);
        if (!improvementType) continue;

        const dist = Math.max(Math.abs(settler.col - col), Math.abs(settler.row - row));
        // Memory: threat near the tile makes the walk costlier — a settler
        // strolling into a barb camp is a wasted settler.
        const threat = units
          ? this.memory.threatScoreAt(col, row, units, settler.civilizationId)
          : 0;
        const score = 100 - dist - threat * 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = { col, row, improvementType };
        }
      }
    }

    return bestTarget;
  }

  private determineImprovementType(city: City, col: number, row: number): string | null {
    const tile = (city as unknown as { getTileAt?: (c: number, r: number) => { type?: string; terrain?: string } }).getTileAt?.(col, row);
    if (!tile) return null;

    const terrain = (tile.terrain ?? tile.type ?? '').toLowerCase();

    if (terrain === 'grassland' || terrain === 'plains' || terrain === 'river') {
      return 'irrigation';
    }
    if (terrain === 'hills' || terrain === 'mountains') {
      return 'mines';
    }
    if (terrain === 'desert') {
      return 'irrigation';
    }

    return 'road';
  }

  getRecommendedSettlerCount(cities: City[], units: Unit[]): number {
    if (cities.length === 0) return 0;

    const civId = cities[0].civilizationId;
    const settlers = units.filter(
      (u: Unit) => u.civilizationId === civId && u.type === 'settler' && !u.isDefeated,
    );
    const aliveSettlers = settlers.length;

    const aggressionFactor = this.memory.getExpansionAggressiveness();

    const hasMatureCity = cities.some((c: City) => (c.population ?? 0) >= 6);
    const hasValidSettlementSpot = this.hasValidSettlementSpot(cities);

    // Forward settling: an empire with exactly one (or zero) cities is locked
    // out of the mature-city rule until its capital grows to 6, which on a
    // single food tile can take many turns — long enough to be flanked by a
    // forward settler from a neighbour. Allow the first satellite even while
    // the home city is small, so long as there is a workable settlement spot.
    const earlyEmpire = cities.length <= 1;

    if (!(earlyEmpire && hasValidSettlementSpot) && (!hasMatureCity || !hasValidSettlementSpot)) {
      // Only settlers that are ACTUALLY heading to a site count against the
      // "one at a time" allowance. A settler with no settlement target —
      // blocked by spacing everywhere, reassigned to field works, or stuck —
      // cannot consume it, or the civ stops expanding the moment one settler
      // gets unlucky: the allowance stays full forever while nobody founds,
      // the empire stays at one city, and (in the pinned AI-vs-AI run) it was
      // overrun before it could garrison anything. Paced by memory: if
      // settlers keep dying on the walk, the allowance drops toward zero so
      // the civ builds guards instead of feeding settlers to the map.
      const expanding = settlers.filter((u) => !!u._aiSettlement).length;
      const allowance = Math.max(0, 1 - expanding);
      return Math.max(0, Math.round(allowance * aggressionFactor));
    }

    const assignedSettlers = this.getAssignedCount();
    const queuedImprovements = this.getQueueLength();

    // How many tiles the civ's settlers can reach and still need work. This is
    // the REAL number, read off the map; the governor's own queue is only what it
    // has personally promised, and nothing fills it — so sizing the works corps
    // from the queue alone left it permanently at zero and the empire never
    // paved a field.
    //
    // Measured REACHABLE work, not the raw outstanding count: `countOutstanding
    // Works` counts every workable tile in every radius, but a settler only works
    // its own landmass. An empire split by water is told to field 5 settlers for
    // 2 jobs, and the surplus idles — the 40% -> 41.1% move in the pinned metric.
    const outstanding = typeof civId === 'number'
      ? (this.reachableWorks?.(civId) ?? this.outstandingWorks?.(civId) ?? queuedImprovements)
      : queuedImprovements;

    const unassignedWork = Math.max(0, outstanding - assignedSettlers);
    // A settler covers a handful of tiles in the time it takes to replace
    // itself, so the corps is sized by outstanding work rather than by the
    // empire's width.
    const workBasedRecommendation = Math.min(
      MAX_WORKS_CORPS,
      Math.ceil(unassignedWork / WORKS_TILES_PER_SETTLER),
    );

    const expansionNeed = cities.length < 5 ? 1 : 0;
    const recommended = Math.max(
      workBasedRecommendation,
      Math.round(expansionNeed * aggressionFactor),
    );

    // Pace the net deficit by memory: when settlers keep dying, the governor
    // recommends fewer of them so the civ builds guards and walls first.
    const netNeed = Math.max(0, recommended - aliveSettlers);
    return Math.max(0, Math.round(netNeed * aggressionFactor));
  }

  /**
   * How many settlers the public-works corps is worth, read off REACHABLE
   * work: a settler can only pave tiles it can walk to, so once the reachable
   * count collapses toward zero the corps does too. `AutoProduction` adds this
   * on top of its expansion quota; when the map is fully settled it is 0, and
   * the civ stops fielding workers that would stand idle (the settler idle-share
   * metric). A civ with no wired work source falls back to the flat default
   * the caller passes, so a test harness without `aiManager` is unchanged.
   */
  reachableWorksCorps(civId: number, fallback: number): number {
    if (typeof civId !== 'number') return fallback;
    const outstanding = this.reachableWorks?.(civId) ?? this.outstandingWorks?.(civId);
    if (typeof outstanding !== 'number') return fallback;
    return Math.min(MAX_WORKS_CORPS, Math.ceil(Math.max(0, outstanding) / WORKS_TILES_PER_SETTLER));
  }

  private hasValidSettlementSpot(cities: City[]): boolean {
    return cities.length < 8;
  }

  // ─── Memory access (delegates to SettlerMemory) ─────────────────────────

  /** The governor's turn clock. */
  currentTurnNumber(): number {
    return this.memory.currentTurnNumber();
  }

  /** Advance the memory's turn clock (call once per AI turn). */
  recordTurn(turn: number): void {
    this.memory.recordTurn(turn);
  }

  /** Remember (or refresh) a candidate colony site with its live evaluation. */
  recordSite(input: Parameters<SettlerMemory['recordSite']>[0]): void {
    this.memory.recordSite(input);
  }

  /** Remembered site, or null. */
  getSite(siteId: string): SiteMemory | null {
    return this.memory.getSite(siteId);
  }

  /** Ranked candidate colony sites for expansion (open, high-yield, low-threat). */
  rankExpansionSites(input: Parameters<SettlerMemory['rankExpansionSites']>[0]): readonly SiteMemory[] {
    return this.memory.rankExpansionSites(input);
  }

  /** Mark a site colonized (by anyone). */
  markColonized(siteId: string, civId: number, turn?: number): void {
    this.memory.markColonized(siteId, civId, turn);
  }

  /** Mark a site blocked (enemy unit, barb camp, spacing). */
  markBlocked(siteId: string, reason: string, turn?: number): void {
    this.memory.markBlocked(siteId, reason, turn);
  }

  /** Mark a site as evaluated but poor (low yield) — skip it for expansion. */
  markPoor(siteId: string, turn?: number): void {
    this.memory.markPoor(siteId, turn);
  }

  /** Record a settler lost, optionally tied to a site for pacing. */
  recordSettlerLost(siteId?: string, turn?: number): void {
    this.memory.recordSettlerLost(siteId, turn);
  }

  /** Record a settler built (ledger only). */
  recordSettlerBuilt(): void {
    this.memory.recordSettlerBuilt();
  }

  /** Record a site colonized by us (ledger only). */
  recordSiteColonized(): void {
    this.memory.recordSiteColonized();
  }

  /** Record that a settler completed an improvement on a tile. */
  recordTileImproved(
    tileId: string,
    improvementType: string,
    settlerId?: string,
    turn?: number,
  ): void {
    this.memory.recordTileImproved(tileId, improvementType, settlerId, turn);
  }

  /** Whether a tile is already remembered as improved (skip re-assignment). */
  isTileImproved(tileId: string): boolean {
    return this.memory.isTileImproved(tileId);
  }

  /** Improvement memory for a tile, or null. */
  getTileImprovement(tileId: string): TileImprovementMemory | null {
    return this.memory.getTileImprovement(tileId);
  }

  /** Read-only effectiveness ledger. */
  getLedger(): Readonly<import('./SettlerMemory').SettlerLedger> {
    return this.memory.getLedger();
  }

  /** Expansion aggressiveness 0-1 from settler-loss memory (0 = stop building settlers). */
  getExpansionAggressiveness(): number {
    return this.memory.getExpansionAggressiveness();
  }

  /** Number of colony sites currently remembered. */
  getSiteCount(): number {
    return this.memory.getSiteCount();
  }

  /** Threat score 0-100 for a tile based on hostile units within the memory radius. */
  threatScoreAt(col: number, row: number, units: readonly Unit[], civId: number): number {
    return this.memory.threatScoreAt(col, row, units, civId);
  }

  /** The underlying memory instance (for tests / advanced wiring). */
  getMemory(): SettlerMemory {
    return this.memory;
  }
}
