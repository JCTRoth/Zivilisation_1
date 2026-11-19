// Canonical data shapes live in `types/game`.
import type { City, Unit } from '../../../../types/game';

/** Status of a candidate colony site, remembered across turns. */
export type SiteStatus = 'open' | 'colonized' | 'blocked' | 'poor' | 'contested';

/** One remembered candidate colony site. */
export interface SiteMemory {
  /** "col,row" — stable across turns even if a city is later renamed. */
  siteId: string;
  col: number;
  row: number;
  /** Cached 0-100 evaluation of food/production/trade potential. */
  yieldScore: number;
  /** Cached 0-100 threat from hostile units/barbarians nearby. */
  threatScore: number;
  /** Chebyshev distance from the civ's capital (forward-settling pressure). */
  distanceFromCapital: number;
  status: SiteStatus;
  /** Turn the entry was last (re)evaluated; stale entries are pruned. */
  lastEvaluatedTurn: number;
  /** Turn the site was colonized (undefined until then). */
  colonizedTurn?: number;
  /** Civilization that owns/colonized the site. */
  colonizedByCivId?: number;
  /** Why the site is blocked: enemy unit, barb camp, spacing rules… */
  blockedReason?: string;
  /** Settlers lost attempting to reach or colonize this site. */
  settlerLosses: number;
}

/** Effectiveness ledger — the governor's scorecard, used to pace expansion. */
export interface SettlerLedger {
  settlersBuilt: number;
  settlersLost: number;
  sitesColonized: number;
  tilesImproved: number;
  /** Turn of the most recent settler loss, for recency weighting. */
  lastLossTurn?: number;
}

/** One tile a settler has improved, remembered so it isn't re-assigned. */
export interface TileImprovementMemory {
  improvementType: string;
  completedTurn: number;
  settlerId?: string;
}

export interface SettlerMemoryOptions {
  /** Cap on remembered sites per governor (oldest non-colonized pruned first). */
  maxSites?: number;
  /** Turns after which an unevaluated site entry is dropped. */
  siteTtlTurns?: number;
  /** Tiles around a site scanned for hostile units. */
  threatRadius?: number;
}

const DEFAULT_MAX_SITES = 200;
const DEFAULT_SITE_TTL_TURNS = 25;
const DEFAULT_THREAT_RADIUS = 3;

/** Ranking penalty per settler lost at a site — a death is a strong signal. */
const LOSS_RANK_PENALTY = 15;

/**
 * Persistent memory for the settler governor.
 *
 * The engine is the source of truth for cities, units and tiles; this module
 * is a bounded, turn-keyed cache of *evaluations* the governor would otherwise
 * recompute every turn. It exists to make settlers effective, not busy:
 *
 *  * Colonists aren't re-sent to sites where previous settlers died — the loss
 *    ledger paces expansion to survivability instead of raw tile count.
 *  * Site yield/threat is evaluated once and reused — consistent ranking,
 *    less re-scan every turn.
 *  * Improved tiles aren't re-assigned — no duplicate settler work.
 *  * Memory is bounded and time-to-live pruned, so it cannot grow forever or
 *    stale-guard a site that is now safe.
 *
 * All read methods are pure over the current turn; write methods mutate only
 * this instance. The governor runs single-threaded per AI turn, so no locking
 * is required.
 */
export class SettlerMemory {
  private readonly options: Required<SettlerMemoryOptions>;
  private readonly sites = new Map<string, SiteMemory>();
  private readonly tileImprovements = new Map<string, TileImprovementMemory>();
  private ledger: SettlerLedger = {
    settlersBuilt: 0,
    settlersLost: 0,
    sitesColonized: 0,
    tilesImproved: 0,
  };
  private currentTurn = 0;

  constructor(options: SettlerMemoryOptions = {}) {
    this.options = {
      maxSites: options.maxSites ?? DEFAULT_MAX_SITES,
      siteTtlTurns: options.siteTtlTurns ?? DEFAULT_SITE_TTL_TURNS,
      threatRadius: options.threatRadius ?? DEFAULT_THREAT_RADIUS,
    };
  }

  /** Advance the governor's turn clock and prune stale site entries. */
  recordTurn(turn: number): void {
    this.currentTurn = turn;
    this.prune(turn);
  }

  currentTurnNumber(): number {
    return this.currentTurn;
  }

  /** Site id for a tile. */
  static siteId(col: number, row: number): string {
    return `${col},${row}`;
  }

  /**
   * Record (or refresh) a candidate colony site. Call once per site per turn
   * after evaluating yield and threat against the live engine state. Loss
   * history is preserved across re-evaluations.
   */
  recordSite(input: {
    siteId: string;
    col: number;
    row: number;
    yieldScore: number;
    threatScore: number;
    distanceFromCapital: number;
    status: SiteStatus;
    colonizedByCivId?: number;
    blockedReason?: string;
  }): void {
    const existing = this.sites.get(input.siteId);
    const entry: SiteMemory = {
      siteId: input.siteId,
      col: input.col,
      row: input.row,
      yieldScore: Math.max(0, Math.min(100, input.yieldScore)),
      threatScore: Math.max(0, Math.min(100, input.threatScore)),
      distanceFromCapital: Math.max(0, input.distanceFromCapital),
      status: input.status,
      lastEvaluatedTurn: this.currentTurn,
      colonizedByCivId: input.colonizedByCivId,
      blockedReason: input.blockedReason,
      settlerLosses: existing?.settlerLosses ?? 0,
      ...(input.status === 'colonized'
        ? { colonizedTurn: this.currentTurn }
        : existing?.colonizedTurn !== undefined
          ? { colonizedTurn: existing.colonizedTurn }
          : {}),
    };
    this.sites.set(input.siteId, entry);
    this.prune(this.currentTurn);
  }

  /** Retrieve a remembered site, or null if never recorded or pruned. */
  getSite(siteId: string): SiteMemory | null {
    return this.sites.get(siteId) ?? null;
  }

  /** All sites, newest evaluation first. */
  getSites(): readonly SiteMemory[] {
    return [...this.sites.values()].sort(
      (a, b) =>
        b.lastEvaluatedTurn - a.lastEvaluatedTurn || a.siteId.localeCompare(b.siteId),
    );
  }

  /**
   * Rank candidate sites for expansion: open, low-threat, high-yield.
   * Colonized/blocked/poor sites are excluded; high-loss sites are penalized
   * so the governor stops feeding settlers to them.
   */
  rankExpansionSites(input: {
    civId: number;
    limit?: number;
    minYield?: number;
    maxThreat?: number;
  }): readonly SiteMemory[] {
    const limit = input.limit ?? 10;
    const minYield = input.minYield ?? 10;
    const maxThreat = input.maxThreat ?? 60;

    return this.getSites()
      .filter((s) => s.status === 'open')
      .filter((s) => s.yieldScore >= minYield)
      .filter((s) => s.threatScore <= maxThreat)
      .filter(
        (s) =>
          s.colonizedByCivId === undefined || s.colonizedByCivId === input.civId,
      )
      .sort((a, b) => {
        const aLossPenalty = a.settlerLosses * LOSS_RANK_PENALTY;
        const bLossPenalty = b.settlerLosses * LOSS_RANK_PENALTY;
        const aScore =
          a.yieldScore - a.threatScore - a.distanceFromCapital - aLossPenalty;
        const bScore =
          b.yieldScore - b.threatScore - b.distanceFromCapital - bLossPenalty;
        return bScore - aScore || a.lastEvaluatedTurn - b.lastEvaluatedTurn;
      })
      .slice(0, limit);
  }

  /** Mark a site as colonized (by anyone). */
  markColonized(siteId: string, civId: number, turn?: number): void {
    const entry = this.sites.get(siteId);
    if (!entry) return;
    entry.status = 'colonized';
    entry.colonizedByCivId = civId;
    entry.colonizedTurn = turn ?? this.currentTurn;
    entry.blockedReason = undefined;
  }

  /** Mark a site as blocked (enemy unit, barb camp, spacing). */
  markBlocked(siteId: string, reason: string, turn?: number): void {
    const entry = this.sites.get(siteId);
    if (!entry) return;
    entry.status = 'blocked';
    entry.blockedReason = reason;
    entry.lastEvaluatedTurn = turn ?? this.currentTurn;
  }

  /** Mark a site as evaluated but poor (low yield) — skip it for expansion. */
  markPoor(siteId: string, turn?: number): void {
    const entry = this.sites.get(siteId);
    if (!entry) return;
    entry.status = 'poor';
    entry.lastEvaluatedTurn = turn ?? this.currentTurn;
  }

  /** Record that a settler was lost; optionally tie it to a site for pacing. */
  recordSettlerLost(siteId?: string, turn?: number): void {
    this.ledger.settlersLost += 1;
    this.ledger.lastLossTurn = turn ?? this.currentTurn;
    if (siteId) {
      const entry = this.sites.get(siteId);
      if (entry) entry.settlerLosses += 1;
    }
  }

  /** Record that a new settler was built (ledger only). */
  recordSettlerBuilt(): void {
    this.ledger.settlersBuilt += 1;
  }

  /** Record that a site was colonized by us (ledger only). */
  recordSiteColonized(): void {
    this.ledger.sitesColonized += 1;
  }

  /** Record that a settler completed an improvement on a tile. */
  recordTileImproved(
    tileId: string,
    improvementType: string,
    settlerId?: string,
    turn?: number,
  ): void {
    this.tileImprovements.set(tileId, {
      improvementType,
      completedTurn: turn ?? this.currentTurn,
      settlerId,
    });
    this.ledger.tilesImproved += 1;
  }

  /** Whether a tile is already remembered as improved (skip re-assignment). */
  isTileImproved(tileId: string): boolean {
    return this.tileImprovements.has(tileId);
  }

  /** Improvement memory for a tile, or null. */
  getTileImprovement(tileId: string): TileImprovementMemory | null {
    return this.tileImprovements.get(tileId) ?? null;
  }

  /** Read-only ledger. */
  getLedger(): Readonly<SettlerLedger> {
    return { ...this.ledger };
  }

  /**
   * Expansion aggressiveness, 0.0 (stop building settlers — they die) to
   * 1.0 (full expansion). Computed from settler loss rate so the governor
   * paces expansion to survivability instead of raw tile count; recent
   * losses weigh more heavily.
   */
  getExpansionAggressiveness(): number {
    const { settlersBuilt, settlersLost } = this.ledger;
    const total = settlersBuilt + settlersLost;
    if (total === 0) return 1.0; // no data: assume safe
    const lossRate = settlersLost / total;
    const recency =
      this.ledger.lastLossTurn != null &&
      this.currentTurn - this.ledger.lastLossTurn <= 3
        ? 0.5
        : 0.0;
    return Math.max(0.0, Math.min(1.0, 1.0 - lossRate - recency));
  }

  /** Number of sites currently remembered. */
  getSiteCount(): number {
    return this.sites.size;
  }

  /** Threat radius used when scanning for hostiles near a site. */
  getThreatRadius(): number {
    return this.options.threatRadius;
  }

  /** Drop entries not re-evaluated within TTL, then cap at maxSites. */
  private prune(turn: number): void {
    const ttl = this.options.siteTtlTurns;
    for (const [siteId, entry] of this.sites) {
      if (turn - entry.lastEvaluatedTurn > ttl && entry.status !== 'colonized') {
        this.sites.delete(siteId);
      }
    }
    if (this.sites.size > this.options.maxSites) {
      const ordered = [...this.sites.entries()].sort(
        (a, b) =>
          Number(b[1].status === 'colonized') - Number(a[1].status === 'colonized') ||
          a[1].lastEvaluatedTurn - b[1].lastEvaluatedTurn,
      );
      const toDrop = this.sites.size - this.options.maxSites;
      for (let i = 0; i < toDrop; i++) {
        this.sites.delete(ordered[i][0]);
      }
    }
  }

  /**
   * Threat score for a tile based on hostile units within `threatRadius`,
   * 0-100 (0 = empty, 100 = surrounded). Hostile = not this civ and not
   * defeated. Caller supplies the unit list and this civ's id.
   */
  threatScoreAt(
    col: number,
    row: number,
    units: readonly Unit[],
    civId: number,
  ): number {
    const radius = this.options.threatRadius;
    let score = 0;
    let weight = 0;
    for (const u of units) {
      if (u.civilizationId === civId || u.isDefeated) continue;
      const d = Math.max(Math.abs(u.col - col), Math.abs(u.row - row));
      if (d > radius) continue;
      const strength = (u.attack ?? 1) + (u.defense ?? 1);
      const w = Math.max(0, radius - d + 1);
      score += strength * w;
      weight += w;
    }
    if (weight === 0) return 0;
    // Normalize to 0-100 assuming a stack of ~6 average (2/1) units is "full".
    return Math.min(100, Math.round((score / weight) * 10));
  }
}

/**
 * Evaluate a candidate colony site from live engine state, returning the
 * fields `SettlerMemory.recordSite` expects. Pure helper — callers own the
 * engine calls.
 */
export function evaluateColonySite(input: {
  col: number;
  row: number;
  civId: number;
  cities: readonly City[];
  units: readonly Unit[];
  memory: SettlerMemory;
}): {
  siteId: string;
  col: number;
  row: number;
  yieldScore: number;
  threatScore: number;
  distanceFromCapital: number;
  status: SiteStatus;
} {
  const siteId = SettlerMemory.siteId(input.col, input.row);
  const { memory } = input;
  const civCities = input.cities.filter((c) => c.civilizationId === input.civId);
  const capital = civCities.find((c) => c.isCapital === true) ?? civCities[0];
  const distanceFromCapital = capital
    ? Math.max(Math.abs(input.col - capital.col), Math.abs(input.row - capital.row))
    : 0;

  // Yield: terrain-based heuristic read off the working tile if present.
  let yieldScore = 30;
  const cityAtSite = civCities.find((c) => c.col === input.col && c.row === input.row);
  if (cityAtSite) {
    yieldScore = Math.min(
      100,
      40 + Math.max(0, (cityAtSite.population ?? 1) - 2) * 8 +
        Math.max(0, (cityAtSite.yields?.trade ?? 0) + (cityAtSite.yields?.food ?? 0)) * 3,
    );
  } else {
    // Unsettled: guess from nearby city working tiles (a worked tile is good land).
    const workedNearby = civCities.some((c) => {
      const tiles = c.workingTiles ?? new Set<string>();
      return tiles.has(siteId);
    });
    yieldScore = workedNearby ? 55 : 35;
  }

  const threatScore = memory.threatScoreAt(
    input.col,
    input.row,
    input.units,
    input.civId,
  );

  let status: SiteStatus = 'open';
  if (cityAtSite) status = 'colonized';
  else if (threatScore > 60) status = 'contested';
  else if (threatScore > 30) status = 'blocked';

  return {
    siteId,
    col: input.col,
    row: input.row,
    yieldScore,
    threatScore,
    distanceFromCapital,
    status,
  };
}
