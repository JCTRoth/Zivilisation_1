// Canonical data shapes live in `types/game`.
// (No engine object usages — this module stays storage-only and tree-shakeable.)
/** Reason a caravan mission failed to deliver. Mirrors `AbortReason` in CaravanGovernor. */
export type CaravanFailureReason =
  | 'target_gone'
  | 'target_ineligible'
  | 'no_route_patience'
  | 'no_target'
  | 'transit_deadline'
  | 'surplus_over_cap'
  | 'blocked'
  | 'unknown';

/** Snapshot of one delivery partner (home city -> destination city). */
export interface CaravanRouteStat {
  /** "${homeCityId}->${destCityId}". */
  id: string;
  homeCityId: string;
  destCityId: string;
  destCivId: number;
  attempts: number;
  deliveries: number;
  timeouts: number;
  failures: number;
  totalGold: number;
  totalScience: number;
  totalTransitTurns: number;
  /** Best observed transit turns (fastest delivery) for this partner, or null. */
  bestTransitTurns: number | null;
  /** Turn of the most recent delivery (undefined until one succeeds). */
  lastDeliveryTurn?: number;
  /** Turn of the most recent completed attempt. */
  lastAttemptTurn: number;
  blacklisted: boolean;
  blacklistReason?: string;
  /** Reason of the most recent failure, if delivery never succeeded. */
  lastFailureReason?: CaravanFailureReason;
}

/** Effectiveness ledger — the civ-wide scorecard for caravans. */
export interface CaravanMemoryLedger {
  attempts: number;
  deliveries: number;
  timeouts: number;
  failures: number;
  totalGold: number;
  totalScience: number;
  totalTransitTurns: number;
}

export interface CaravanRouteCandidate {
  id: string;
  homeCityId: string;
  destCityId: string;
  destCivId: number;
  baselineValuePerTurn: number;
  foreign: boolean;
}

export interface CaravanRankedCandidate extends CaravanRouteCandidate {
  blacklisted: boolean;
  adjustedValuePerTurn: number;
  memoryReason: string | null;
}

export interface CaravanMemoryOptions {
  /** Max remembered partners (oldest pruned first). */
  maxPartners?: number;
  /** Turns after which an idle partner entry is dropped. */
  partnerTtlTurns?: number;
  /** Persist a blacklist for at least this many turns. */
  blacklistTtlTurns?: number;
}

const DEFAULT_MAX_PARTNERS = 300;
const DEFAULT_PARTNER_TTL = 40;
const DEFAULT_BLACKLIST_TTL = 15;

/**
 * Persistent, turn-keyed memory for the caravan governor.
 *
 * The engine is the source of truth for cities, units and routes; this module
 * caches the *observed outcome* of every delivery attempt so the governor does
 * not re-walk the same hopeless route a second time and so proven (fast)
 * partners surface to the front of the value-per-turn ranking.
 *
 * Caravans are units; their effectiveness is gold+science per turn of walking.
 * Memory directly supports that: partners that delivered in few transit turns
 * rise in the ranking, partners that timed out or were never deliverable sink,
 * and a partner that wasted a caravan is blacklisted for a while so the next
 * caravan built for the same home city pivots to a fresh destination instead
 * of repeating the walk.
 *
 * All read methods are pure over the current turn; writes mutate only this
 * instance.
 */
export class CaravanMemory {
  private readonly options: Required<CaravanMemoryOptions>;
  private readonly partners = new Map<string, CaravanRouteStat>();
  private ledger: CaravanMemoryLedger = {
    attempts: 0,
    deliveries: 0,
    timeouts: 0,
    failures: 0,
    totalGold: 0,
    totalScience: 0,
    totalTransitTurns: 0,
  };
  private currentTurn = 0;

  constructor(options: CaravanMemoryOptions = {}) {
    this.options = {
      maxPartners: options.maxPartners ?? DEFAULT_MAX_PARTNERS,
      partnerTtlTurns: options.partnerTtlTurns ?? DEFAULT_PARTNER_TTL,
      blacklistTtlTurns: options.blacklistTtlTurns ?? DEFAULT_BLACKLIST_TTL,
    };
  }

  /** Advance the memory's turn clock and prune stale entries. */
  recordTurn(turn: number): void {
    this.currentTurn = turn;
    this.prune(turn);
  }

  currentTurnNumber(): number {
    return this.currentTurn;
  }

  /** Stable partner key from a home city + destination city pair. */
  static partnerKey(homeCityId: string, destCityId: string): string {
    return `${homeCityId}->${destCityId}`;
  }

  /** Lift a fresh or reused stat record for a partner. */
  private lift(partnerId: string, homeCityId: string, destCityId: string, destCivId: number): CaravanRouteStat {
    const existing = this.partners.get(partnerId);
    const fresh: CaravanRouteStat = {
      id: partnerId,
      homeCityId,
      destCityId,
      destCivId,
      attempts: 0,
      deliveries: 0,
      timeouts: 0,
      failures: 0,
      totalGold: 0,
      totalScience: 0,
      totalTransitTurns: 0,
      bestTransitTurns: null,
      lastDeliveryTurn: undefined,
      lastAttemptTurn: this.currentTurn,
      blacklisted: false,
    };
    const entry = existing ?? fresh;
    // Refresh the last-attempt timestamp and civ id on every touch; keep
    // delivery history.
    entry.lastAttemptTurn = this.currentTurn;
    entry.destCivId = destCivId;
    entry.homeCityId = homeCityId;
    entry.destCityId = destCityId;
    if (existing) this.partners.set(partnerId, entry);
    else this.partners.set(partnerId, entry);
    return entry;
  }

  /** Record that a caravan set out for a partner (attempt started). */
  recordAttempt(
    homeCityId: string,
    destCityId: string,
    destCivId: number,
  ): CaravanRouteStat {
    const id = CaravanMemory.partnerKey(homeCityId, destCityId);
    const entry = this.lift(id, homeCityId, destCityId, destCivId);
    entry.attempts += 1;
    this.ledger.attempts += 1;
    this.prune(this.currentTurn);
    return entry;
  }

  /** Record a successful delivery: pays gold + science, opens a permanent route. */
  recordDelivery(input: {
    homeCityId: string;
    destCityId: string;
    destCivId: number;
    gold: number;
    science: number;
    transitTurns: number;
  }): CaravanRouteStat {
    const id = CaravanMemory.partnerKey(input.homeCityId, input.destCityId);
    const entry = this.lift(id, input.homeCityId, input.destCityId, input.destCivId);
    entry.deliveries += 1;
    entry.totalGold += input.gold;
    entry.totalScience += input.science;
    entry.totalTransitTurns += Math.max(1, input.transitTurns);
    if (entry.bestTransitTurns === null || input.transitTurns < entry.bestTransitTurns) {
      entry.bestTransitTurns = input.transitTurns;
    }
    entry.lastDeliveryTurn = this.currentTurn;
    entry.blacklisted = false;
    entry.blacklistReason = undefined;
    entry.lastFailureReason = undefined;

    this.ledger.deliveries += 1;
    this.ledger.totalGold += input.gold;
    this.ledger.totalScience += input.science;
    this.ledger.totalTransitTurns += Math.max(1, input.transitTurns);
    return entry;
  }

  /** Record a failed mission (timeout, stall, no target). */
  recordFailure(
    homeCityId: string,
    destCityId: string,
    destCivId: number,
    reason: CaravanFailureReason,
    transitTurns?: number,
  ): CaravanRouteStat {
    const id = CaravanMemory.partnerKey(homeCityId, destCityId);
    const entry = this.lift(id, homeCityId, destCityId, destCivId);
    if (reason === 'transit_deadline') entry.timeouts += 1;
    else entry.failures += 1;
    entry.lastFailureReason = reason;
    this.ledger.timeouts += reason === 'transit_deadline' ? 1 : 0;
    this.ledger.failures += reason === 'transit_deadline' ? 0 : 1;
    if (typeof transitTurns === 'number' && transitTurns > 0) {
      entry.totalTransitTurns += transitTurns;
    }
    return entry;
  }

  /** Get remembered stats for a partner, or null. */
  getPartner(homeCityId: string, destCityId: string): CaravanRouteStat | null {
    return this.partners.get(CaravanMemory.partnerKey(homeCityId, destCityId)) ?? null;
  }

  /** Is a (home, dest) route currently blacklisted by memory? */
  isBlacklisted(homeCityId: string, destCityId: string): boolean {
    const entry = this.partners.get(CaravanMemory.partnerKey(homeCityId, destCityId));
    if (!entry || !entry.blacklisted) return false;
    // Blacklist expires with TTL.
    if (entry.lastAttemptTurn + this.options.blacklistTtlTurns <= this.currentTurn) {
      entry.blacklisted = false;
      entry.blacklistReason = undefined;
      return false;
    }
    return true;
  }

  /** Blacklist a route for `blacklistTtlTurns` turns (transit deadline etc.). */
  blacklist(
    homeCityId: string,
    destCityId: string,
    destCivId: number,
    reason: CaravanFailureReason = 'target_gone',
  ): CaravanRouteStat {
    const id = CaravanMemory.partnerKey(homeCityId, destCityId);
    const entry = this.lift(id, homeCityId, destCityId, destCivId);
    entry.blacklisted = true;
    entry.blacklistReason = reason;
    entry.lastFailureReason = reason;
    return entry;
  }

  /** Read-only snapshot of all remembered partners. */
  getPartners(): readonly CaravanRouteStat[] {
    return [...this.partners.values()].sort(
      (a, b) => b.lastAttemptTurn - a.lastAttemptTurn || a.id.localeCompare(b.id),
    );
  }

  /** Partners for a destination civ (useful for "avoid this civ entirely"). */
  getPartnersByCiv(destCivId: number): readonly CaravanRouteStat[] {
    return [...this.partners.values()].filter((p) => p.destCivId === destCivId);
  }

  /** Read-only ledger. */
  getLedger(): Readonly<CaravanMemoryLedger> {
    return { ...this.ledger };
  }

  /**
   * Success rate 0-1 across all attempts (0 when none). Used to pace caravan
   * production: a civ whose deliveries keep timing out should build fewer
   * caravans and send them to safer partners instead.
   */
  getDeliverySuccessRate(): number {
    if (this.ledger.attempts === 0) return 1.0; // no data: assume safe
    return Math.max(0, Math.min(1, this.ledger.deliveries / this.ledger.attempts));
  }

  /**
   * Caravan aggressiveness 0.0-1.0, combining delivery success rate with a
   * recency clamp so a recent timeout immediately throttles new caravans.
   */
  getCaravanAggressiveness(): number {
    const rate = this.getDeliverySuccessRate();
    const recency =
      this.ledger.timeouts > 0 && this.ledger.timeouts >= this.ledger.deliveries
        ? 0.4
        : 0.0;
    return Math.max(0.0, Math.min(1.0, rate - recency));
  }

  /**
   * Re-rank route candidates using memory: blacklisted partners are dropped
   * entirely, proven fast partners get a value boost, partners that timed out
   * get a penalty. Returns a new array in ranked order; does not mutate input.
   */
  rankPartners(candidates: readonly CaravanRouteCandidate[]): CaravanRankedCandidate[] {
    const out: CaravanRankedCandidate[] = [];
    for (const c of candidates) {
      const entry = this.partners.get(CaravanMemory.partnerKey(c.homeCityId, c.destCityId));
      if (entry?.blacklisted) continue; // blacklisted → never re-sent

      let adjustment = 0;
      let reason: string | null = null;
      if (entry) {
        if (entry.deliveries > 0) {
          const avg = entry.totalTransitTurns / entry.deliveries;
          // A fast proven partner is worth ~30% more than a fresh unknown one.
          if (entry.bestTransitTurns !== null && entry.bestTransitTurns <= 5) {
            adjustment += 0.30;
            reason = 'proven-fast';
          } else if (avg > 0 && avg <= entry.bestTransitTurns! + 3) {
            adjustment += 0.15;
            reason = 'proven';
          }
        }
        if (entry.timeouts > 0) {
          const penalty = Math.min(0.4, entry.timeouts * 0.15);
          adjustment -= penalty;
          reason = reason ? `${reason},lossy` : 'lossy';
        }
        if (entry.failures > 0 && entry.deliveries === 0) {
          adjustment -= 0.5;
          reason = 'always-failed';
        }
      }
      const adjustedValuePerTurn = Math.max(0.1, c.baselineValuePerTurn * (1 + adjustment));
      out.push({
        ...c,
        blacklisted: false,
        adjustedValuePerTurn,
        memoryReason: reason,
      });
    }
    out.sort(
      (a, b) =>
        b.adjustedValuePerTurn - a.adjustedValuePerTurn ||
        (a.foreign ? -1 : 1) - (b.foreign ? -1 : 1) ||
        a.id.localeCompare(b.id),
    );
    return out;
  }

  /** Number of remembered partners. */
  getPartnerCount(): number {
    return this.partners.size;
  }

  /** Drop idle partner entries past TTL and over-cap memories. */
  private prune(turn: number): void {
    const ttl = this.options.partnerTtlTurns;
    for (const [partnerId, entry] of this.partners) {
      if (
        turn - entry.lastAttemptTurn > ttl &&
        entry.deliveries === 0 &&
        !entry.blacklisted
      ) {
        this.partners.delete(partnerId);
      }
    }
    if (this.partners.size > this.options.maxPartners) {
      const ordered = [...this.partners.entries()].sort(
        (a, b) =>
          Number(b[1].blacklisted) - Number(a[1].blacklisted) ||
          Number(b[1].deliveries) - Number(a[1].deliveries) ||
          a[1].lastAttemptTurn - b[1].lastAttemptTurn,
      );
      const toDrop = this.partners.size - this.options.maxPartners;
      for (let i = 0; i < toDrop; i++) {
        this.partners.delete(ordered[i][0]);
      }
    }
  }

}