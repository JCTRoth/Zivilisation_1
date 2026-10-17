/**
 * NavalPatrolMemory — what the fleet remembers between turns.
 *
 * Roadmap item 3 in `doc/AI_MEMORY.adoc`. Two memory modules already exist
 * (`ScoutMemory` for enemy sightings on land, `SettlerMemory` for colonies) and
 * both solve the same shape of problem: the engine knows where things are *now*,
 * and can derive very little about where they *were*. A warship that loses sight
 * of a raider over the horizon has no idea which way to sail next turn, so it
 * falls through to "patrol somewhere", which is how two hulls end up milling
 * about in the same corner of the ocean forever (see the note on
 * `findNavalPatrolTarget`).
 *
 * Four things are worth remembering, in descending order of value:
 *
 *  1. **Swept water** — a tile this civ has already patrolled. Never-swept and
 *     least-recently-swept water is what an idle hull should pick, so a fleet
 *     spreads across the ocean instead of converging on one spot. This is the
 *     direct fix for the milling bug, and it is deterministic: no two hulls get
 *     the same suggestion because the pick is offset per hull.
 *  2. **Contacts** — enemy hulls seen and then lost. A warship can sail to the
 *     last known position instead of re-deriving targets from scratch. Freshness
 *     decays the value, so a two-turn-old contact beats nothing but does not beat
 *     a live sighting. The caller must still gate on hostility: sailing to a
 *     remembered contact is not the same as attacking it, but an unguarded
 *     `combatUnit` at that tile declares war.
 *  3. **Danger water** — where our hulls died. Remembered kill zones make the
 *     fleet route around known ambush ground for a while.
 *  4. **Sealift runs in flight** — which ferry is loaded, for which landing,
 *     and which escort is paired with it, so two transports do not converge on
 *     one beach and an escort does not follow a transport that has already
 *     sailed.
 *
 * Design rules, identical to the other memory modules:
 *
 *  * the engine stays the source of truth. This records *observations*, never
 *    units, cities or tiles, and never mutates them;
 *  * turn-keyed: `recordTurn` drives every expiry, so nothing here depends on a
 *    wall clock;
 *  * bounded: every map has a cap and a TTL, so a thousand-round game cannot
 *    grow without limit;
 *  * pure reads: `score()`-style helpers are functions over memory state and can
 *    be unit-tested without an engine.
 *
 * One instance belongs to one civilization. `AIManager` keeps them in a map
 * keyed by civ id, because every record here is civ-relative.
 */

/** An enemy hull this civ has seen. */
export interface NavalContact {
  enemyCivId: number;
  col: number;
  row: number;
  /** Hull type, when the sighting knew it. */
  type: string;
  /** How many land units the hull carries; 0 for a pure warship. */
  transportCapacity: number;
  /** Attack power of the hull when it was seen. */
  strength: number;
  /** Turn of the most recent sighting. */
  turn: number;
  /** How many separate sightings have merged into this record. */
  sightings: number;
}

/** Water where one of our hulls was lost. */
export interface NavalDangerZone {
  col: number;
  row: number;
  /** Turn of the most recent loss here. */
  turn: number;
  /** Chebyshev radius the zone covers around (col,row). */
  radius: number;
  /** Hulls lost here (counted per loss). */
  losses: number;
}

/** A ferry run the civ has in flight. */
export interface SealiftRun {
  transportId: string;
  col: number;
  row: number;
  targetCol: number;
  targetRow: number;
  /** Land units aboard. */
  cargo: number;
  /** Turn the run was committed. */
  startedTurn: number;
  /** Escort hull paired with this transport, if any. */
  escortId?: string;
  mission: 'colony' | 'invasion' | 'escort' | 'other';
}

/** Per-hull navigation intent — which objective it is sailing to, and whether it is closing. */
export interface HullIntent {
  col: number;
  row: number;
  /** Where the hull itself was when the intent was written (its last known tile). */
  fromCol?: number;
  fromRow?: number;
  /**
   * Cargo state at the moment the intent was written:
   * `undefined` = not a transport hull, `false` = empty ferry, `true` = loaded.
   * This is what separates "sunk on the high seas" from "landed its troops and
   * was consumed": only an empty ferry vanishing is treated as a success.
   */
  loaded?: boolean;
  dist: number;
  /** Consecutive turns the hull failed to reduce its distance. */
  stalled: number;
  turn: number;
}

/** Turn-keyed counters, for diagnostics and for the tests that bound growth. */
export interface NavalMemoryLedger {
  turns: number;
  sweeps: number;
  contacts: number;
  dangerZones: number;
  sealifts: number;
  intents: number;
  /** Records dropped by TTL/cap since construction. */
  pruned: number;
}

export interface NavalPatrolMemoryOptions {
  /** Cap on remembered patrol tiles. */
  maxSweeps?: number;
  /** Turns after which an unremarkable swept tile is forgotten. */
  sweepTtlTurns?: number;
  /** Cap on contacts per enemy civ. */
  maxContactsPerCiv?: number;
  /** Turns after which a contact is too old to sail to. */
  contactTtlTurns?: number;
  /** Cap on danger zones. */
  maxDangerZones?: number;
  /** Cap on sealift runs in flight. */
  maxSealifts?: number;
  /** Turns after which a kill zone stops steering hulls around it. */
  dangerTtlTurns?: number;
  /** Turns after which an unfinished sealift run is considered lost. */
  sealiftTtlTurns?: number;
  /** Chebyshev radius within which two sightings merge into one contact. */
  contactMergeRadius?: number;
  /** Default radius of a kill zone. */
  defaultDangerRadius?: number;
}

const DEFAULTS = {
  maxSweeps: 600,
  sweepTtlTurns: 60,
  maxContactsPerCiv: 12,
  contactTtlTurns: 8,
  maxDangerZones: 40,
  maxSealifts: 8,
  dangerTtlTurns: 20,
  sealiftTtlTurns: 30,
  contactMergeRadius: 2,
  defaultDangerRadius: 1,
} as const;

/** Maps in this codebase are far below 4096 per side; anything else is rejected. */
const SIDE_LIMIT = 4096;

/**
 * Tile key for the sweep/danger maps. `null` for coordinates outside the map,
 * which callers treat as "no memory" rather than as an error — the grid check
 * upstream is what actually guarantees the tile is sailable.
 */
function tileKey(col: number, row: number): number | null {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  if (col < 0 || row < 0 || col >= SIDE_LIMIT || row >= SIDE_LIMIT) return null;
  return col * SIDE_LIMIT + row;
}

const chebyshev = (a: number, b: number, c: number, d: number): number =>
  Math.max(Math.abs(a - c), Math.abs(b - d));

export class NavalPatrolMemory {
  private readonly options: Required<NavalPatrolMemoryOptions>;

  /** tileKey → turn the civ last patrolled that tile. */
  private readonly sweeps = new Map<number, number>();

  /** enemyCivId → contacts, newest first. */
  private readonly contacts = new Map<number, NavalContact[]>();

  /** tileKey → kill zone. */
  private readonly danger = new Map<number, NavalDangerZone>();

  /** transportId → run in flight. */
  private readonly sealifts = new Map<string, SealiftRun>();

  /** unitId → navigation intent. */
  private readonly intents = new Map<string, HullIntent>();

  private currentTurn = 0;
  private pruned = 0;

  constructor(options: NavalPatrolMemoryOptions = {}) {
    this.options = {
      maxSweeps: options.maxSweeps ?? DEFAULTS.maxSweeps,
      sweepTtlTurns: options.sweepTtlTurns ?? DEFAULTS.sweepTtlTurns,
      maxContactsPerCiv: options.maxContactsPerCiv ?? DEFAULTS.maxContactsPerCiv,
      contactTtlTurns: options.contactTtlTurns ?? DEFAULTS.contactTtlTurns,
      dangerTtlTurns: options.dangerTtlTurns ?? DEFAULTS.dangerTtlTurns,
      maxDangerZones: options.maxDangerZones ?? DEFAULTS.maxDangerZones,
      maxSealifts: options.maxSealifts ?? DEFAULTS.maxSealifts,
      sealiftTtlTurns: options.sealiftTtlTurns ?? DEFAULTS.sealiftTtlTurns,
      contactMergeRadius: options.contactMergeRadius ?? DEFAULTS.contactMergeRadius,
      defaultDangerRadius: options.defaultDangerRadius ?? DEFAULTS.defaultDangerRadius,
    };
  }

  // ── clock ────────────────────────────────────────────────────────────────

  /**
   * Advance the turn clock and expire everything that has gone stale. Cheap
   * enough to call once per turn: the maps are bounded, so this is O(cap).
   */
  recordTurn(turn: number): void {
    this.currentTurn = turn;
    this.expireSweeps(turn);
    this.expireContacts(turn);
    this.expireDanger(turn);
  }

  currentTurnNumber(): number {
    return this.currentTurn;
  }

  // ── 1. swept water ───────────────────────────────────────────────────────

  /** Remember that this civ has patrolled a tile. */
  recordSweep(col: number, row: number, turn: number = this.currentTurn): void {
    const key = tileKey(col, row);
    if (key === null) return;
    this.sweeps.set(key, turn);
    this.capSweeps();
  }

  /** Turn this tile was last patrolled, or null when memory has none of it. */
  lastSweptTurn(col: number, row: number): number | null {
    const key = tileKey(col, row);
    if (key === null) return null;
    const turn = this.sweeps.get(key);
    return turn === undefined ? null : turn;
  }

  /**
   * Patrol priority for a tile: **lower is better**.
   *
   * Never swept is `0`, so it always beats memory of a tile that was swept
   * during the current turn. Everything else is "turns since last sweep", which
   * makes an idle hull drift back to water nobody has looked at lately — and,
   * because the value only ties for tiles swept in the same turn, the caller's
   * per-hull offset is what separates two hulls standing side by side.
   */
  sweepPriority(col: number, row: number): number {
    const last = this.lastSweptTurn(col, row);
    if (last === null) return 0;
    return 1 + Math.max(0, this.currentTurn - last);
  }

  /** Number of distinct tiles this civ remembers patrolling. */
  sweepCount(): number {
    return this.sweeps.size;
  }

  // ── 2. enemy contacts ────────────────────────────────────────────────────

  /**
   * Remember a sighting. A second sighting of the same civ within
   * `contactMergeRadius` merges into the existing record rather than piling up
   * a list of near-identical positions: repeated sightings raise confidence
   * (`sightings`) and slide the remembered position toward the newest one.
   */
  recordContact(input: {
    enemyCivId: number;
    col: number;
    row: number;
    type?: string;
    transportCapacity?: number;
    strength?: number;
    turn?: number;
  }): NavalContact | null {
    const turn = input.turn ?? this.currentTurn;
    if (tileKey(input.col, input.row) === null) return null;
    const list = this.contacts.get(input.enemyCivId) ?? [];
    const near = list.find((c) =>
      chebyshev(c.col, c.row, input.col, input.row) <= this.options.contactMergeRadius,
    );
    if (near) {
      near.turn = turn;
      near.sightings += 1;
      // Newest position wins outright: a hull that is still visible has not
      // teleported, and averaging would lag behind a fleeing raider.
      near.col = input.col;
      near.row = input.row;
      near.type = input.type ?? near.type;
      near.transportCapacity = input.transportCapacity ?? near.transportCapacity;
      near.strength = input.strength ?? near.strength;
      return near;
    }
    const contact: NavalContact = {
      enemyCivId: input.enemyCivId,
      col: input.col,
      row: input.row,
      type: input.type ?? '',
      transportCapacity: input.transportCapacity ?? 0,
      strength: input.strength ?? 0,
      turn,
      sightings: 1,
    };
    list.push(contact);
    list.sort((a, b) => b.turn - a.turn);
    if (list.length > this.options.maxContactsPerCiv) {
      list.length = this.options.maxContactsPerCiv;
    }
    this.contacts.set(input.enemyCivId, list);
    return contact;
  }

  /** Contacts remembered for one enemy civ (or all civs when omitted). */
  contactsFor(enemyCivId?: number): readonly NavalContact[] {
    if (enemyCivId !== undefined) return this.contacts.get(enemyCivId) ?? [];
    const all: NavalContact[] = [];
    for (const list of this.contacts.values()) all.push(...list);
    all.sort((a, b) => b.turn - a.turn);
    return all;
  }

  /** Drop a contact that turned out to be gone or was a mis-identification. */
  forgetContact(enemyCivId: number, col: number, row: number): boolean {
    const list = this.contacts.get(enemyCivId);
    if (!list) return false;
    const next = list.filter((c) => !(c.col === col && c.row === row));
    if (next.length === list.length) return false;
    if (next.length === 0) this.contacts.delete(enemyCivId);
    else this.contacts.set(enemyCivId, next);
    return true;
  }

  /** Drop every contact the civ holds on an enemy (peace, or the civ died). */
  forgetEnemy(enemyCivId: number): void {
    this.contacts.delete(enemyCivId);
  }

  /**
   * How good a remembered contact is as a thing to sail toward: **higher is
   * better, 0 means "do not bother"**.
   *
   * Value decays linearly with age and dies at the TTL, so contact memory is a
   * tie-breaker against live sightings, never a replacement for them. A loaded
   * transport is worth roughly a warship: it is a landing force that is expensive
   * to replace, which is the same ordering `scoreNavalTarget` applies live.
   */
  contactScore(contact: NavalContact, turn: number = this.currentTurn): number {
    const age = Math.max(0, turn - contact.turn);
    if (age > this.options.contactTtlTurns) return 0;
    const freshness = 1 - age / (this.options.contactTtlTurns + 1);
    const value = contact.transportCapacity > 0
      ? 10 + Math.min(10, contact.transportCapacity)
      : 6 + Math.min(6, contact.strength);
    // Confidence from repeat sightings, capped so a hull stared at for a dozen
    // turns cannot outrank a fresh, valuable sighting outright.
    const confidence = Math.min(1.5, 1 + (contact.sightings - 1) * 0.15);
    return value * freshness * confidence;
  }

  /**
   * The best remembered enemy hull worth sailing toward, or null when memory is
   * empty or entirely stale. `hostileTo` is applied to every candidate: sailing
   * toward a civ we are at peace with is pointless and, per the naval-targeting
   * notes in `AIManager`, acting on it starts a war.
   */
  bestContact(opts: {
    turn?: number;
    maxAgeTurns?: number;
    hostileTo?: (enemyCivId: number) => boolean;
  } = {}): NavalContact | null {
    const turn = opts.turn ?? this.currentTurn;
    let best: NavalContact | null = null;
    let bestScore = 0;
    for (const list of this.contacts.values()) {
      for (const contact of list) {
        if (contact.turn < turn - (opts.maxAgeTurns ?? this.options.contactTtlTurns)) continue;
        if (opts.hostileTo && !opts.hostileTo(contact.enemyCivId)) continue;
        const score = this.contactScore(contact, turn);
        if (score > bestScore) {
          bestScore = score;
          best = contact;
        }
      }
    }
    return best;
  }

  // ── 3. danger water ─────────────────────────────────────────────────────

  /** Remember that a hull of ours was lost at this tile. */
  recordDanger(
    col: number,
    row: number,
    turn: number = this.currentTurn,
    radius: number = this.options.defaultDangerRadius,
  ): NavalDangerZone | null {
    const key = tileKey(col, row);
    if (key === null) return null;
    const existing = this.danger.get(key);
    const zone: NavalDangerZone = existing ?? { col, row, turn, radius, losses: 0 };
    zone.turn = turn;
    zone.radius = Math.max(zone.radius, radius);
    zone.losses += 1;
    this.danger.set(key, zone);
    this.capDanger();
    return zone;
  }

  /**
   * How much remembered danger sits on this tile: **0 is safe**, and each active
   * kill zone covering the tile adds its (decayed) loss count. Callers subtract
   * it from a candidate's score; it is never on its own a reason to refuse a
   * tile, because a fleet that refuses to fight is a fleet that loses.
   */
  dangerPressure(col: number, row: number, turn: number = this.currentTurn): number {
    let total = 0;
    for (const zone of this.danger.values()) {
      if (zone.turn < turn - this.options.dangerTtlTurns) continue;
      if (chebyshev(zone.col, zone.row, col, row) > zone.radius) continue;
      const age = Math.max(0, turn - zone.turn);
      total += zone.losses * (1 - age / (this.options.dangerTtlTurns + 1));
    }
    return Math.max(0, total);
  }

  /** Danger zones still within their TTL. */
  activeDangerZones(turn: number = this.currentTurn): readonly NavalDangerZone[] {
    return [...this.danger.values()].filter((z) => z.turn >= turn - this.options.dangerTtlTurns);
  }

  // ── 4. sealift runs ─────────────────────────────────────────────────────

  /** Remember a ferry run in flight. */
  recordSealift(run: SealiftRun): void {
    if (!run.transportId) return;
    this.sealifts.set(run.transportId, { ...run });
    this.capSealifts();
  }

  /** Update a run in place (position, cargo, escort). */
  updateSealift(transportId: string, patch: Partial<SealiftRun>): SealiftRun | null {
    const run = this.sealifts.get(transportId);
    if (!run) return null;
    const next = { ...run, ...patch, transportId };
    this.sealifts.set(transportId, next);
    return next;
  }

  sealiftFor(transportId: string): SealiftRun | null {
    return this.sealifts.get(transportId) ?? null;
  }

  /** Runs in flight, newest first. */
  activeSealifts(turn: number = this.currentTurn): readonly SealiftRun[] {
    return [...this.sealifts.values()]
      .filter((r) => r.startedTurn >= turn - this.options.sealiftTtlTurns)
      .sort((a, b) => b.startedTurn - a.startedTurn);
  }

  /**
   * The transport a hull is escorting, or null when it is escorting nothing.
   * This is the memory half of fleet cohesion: the live pairing lives in
   * `turnData.navalFleets`, this remembers it across turns so an escort does not
   * lose its charge when the turn data is rebuilt.
   */
  transportEscortedBy(escortId: string): SealiftRun | null {
    for (const run of this.sealifts.values()) {
      if (run.escortId === escortId) return run;
    }
    return null;
  }

  /** Pair an escort with a transport. */
  assignEscort(transportId: string, escortId: string): SealiftRun | null {
    return this.updateSealift(transportId, { escortId });
  }

  /** A run is over: delivered, sunk, or called off. */
  clearSealift(transportId: string): boolean {
    return this.sealifts.delete(transportId);
  }

  /** Drop runs whose transport is no longer in the roster. Returns the count. */
  pruneSealifts(liveTransportIds: Iterable<string>): number {
    const live = new Set(liveTransportIds);
    let dropped = 0;
    for (const id of [...this.sealifts.keys()]) {
      if (!live.has(id)) {
        this.sealifts.delete(id);
        dropped += 1;
      }
    }
    this.pruned += dropped;
    return dropped;
  }

  // ── per-hull intent (replaces `unit._navalIntent`) ──────────────────────

  /**
   * Why a hull was told where to sail last turn, and whether it got closer.
   *
   * This used to hang off the `Unit` object as `_navalIntent`, which meant AI
   * bookkeeping was being written into a unit that the save serialiser copies.
   * Keeping it here makes it (a) prunable, (b) absent from save games, and
   * (c) testable without an engine.
   */
  intentFor(unitId: string): HullIntent | undefined {
    return this.intents.get(unitId);
  }

  setIntent(unitId: string, intent: Omit<HullIntent, 'turn'> & { turn?: number }): HullIntent {
    const stored: HullIntent = { ...intent, turn: intent.turn ?? this.currentTurn };
    this.intents.set(unitId, stored);
    return stored;
  }

  clearIntent(unitId: string): boolean {
    return this.intents.delete(unitId);
  }

  /** Drop intents for hulls that are no longer in the roster. Returns the count. */
  pruneIntents(liveUnitIds: Iterable<string>): number {
    const live = new Set(liveUnitIds);
    let dropped = 0;
    for (const id of [...this.intents.keys()]) {
      if (!live.has(id)) {
        this.intents.delete(id);
        dropped += 1;
      }
    }
    this.pruned += dropped;
    return dropped;
  }

  /**
   * Turn-boundary reconciliation: match remembered intents against the hulls
   * that are actually sailing.
   *
   * A hull that held an intent and is no longer in the roster did not simply
   * finish its business. Whether that means "sunk" or "landed" is decided by the
   * intent's `loaded` flag, because an EMPTY ferry is consumed on a successful
   * landing: marking those as kill zones would make the fleet route around its
   * own landing beaches, which is worse than not having the feature at all.
   *
   * Returns the ids of hulls lost since the last call.
   */
  reconcileHulls(
    liveHulls: Iterable<{ id: string }>,
    turn: number = this.currentTurn,
  ): string[] {
    const live = new Set<string>();
    for (const hull of liveHulls) live.add(hull.id);
    const lost: string[] = [];
    for (const [id, intent] of [...this.intents]) {
      if (live.has(id)) continue;
      const landedEmptyFerry = intent.loaded === false;
      if (!landedEmptyFerry && typeof intent.fromCol === 'number' && typeof intent.fromRow === 'number') {
        this.recordDanger(intent.fromCol, intent.fromRow, turn);
        lost.push(id);
      }
      this.intents.delete(id);
      this.pruned += 1;
    }
    return lost;
  }

  // ── diagnostics ─────────────────────────────────────────────────────────

  getLedger(): Readonly<NavalMemoryLedger> {
    let contacts = 0;
    for (const list of this.contacts.values()) contacts += list.length;
    return {
      turns: this.currentTurn,
      sweeps: this.sweeps.size,
      contacts,
      dangerZones: this.danger.size,
      sealifts: this.sealifts.size,
      intents: this.intents.size,
      pruned: this.pruned,
    };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private expireSweeps(turn: number): void {
    for (const [key, turn_] of this.sweeps) {
      if (turn - turn_ > this.options.sweepTtlTurns) {
        this.sweeps.delete(key);
        this.pruned += 1;
      }
    }
  }

  private expireContacts(turn: number): void {
    const ttl = this.options.contactTtlTurns;
    for (const [civId, list] of this.contacts) {
      const kept = list.filter((c) => turn - c.turn <= ttl);
      this.pruned += list.length - kept.length;
      if (kept.length === 0) this.contacts.delete(civId);
      else this.contacts.set(civId, kept);
    }
  }

  private expireDanger(turn: number): void {
    for (const [key, zone] of this.danger) {
      if (turn - zone.turn > this.options.dangerTtlTurns) {
        this.danger.delete(key);
        this.pruned += 1;
      }
    }
  }

  /** Oldest-first eviction keeps the most useful patrol history. */
  private capSweeps(): void {
    if (this.sweeps.size <= this.options.maxSweeps) return;
    const ordered = [...this.sweeps.entries()].sort((a, b) => a[1] - b[1]);
    const excess = this.sweeps.size - this.options.maxSweeps;
    for (let i = 0; i < excess; i++) {
      this.sweeps.delete(ordered[i][0]);
      this.pruned += 1;
    }
  }

  /** Zones with the most losses survive the cap; the rest are forgotten. */
  private capDanger(): void {
    if (this.danger.size <= this.options.maxDangerZones) return;
    const ordered = [...this.danger.entries()].sort(
      (a, b) => a[1].losses - b[1].losses || a[1].turn - b[1].turn,
    );
    const excess = this.danger.size - this.options.maxDangerZones;
    for (let i = 0; i < excess; i++) {
      this.danger.delete(ordered[i][0]);
      this.pruned += 1;
    }
  }

  /** The oldest run is dropped first: a long-haul ferry is the most stale. */
  private capSealifts(): void {
    if (this.sealifts.size <= this.options.maxSealifts) return;
    const ordered = [...this.sealifts.entries()].sort((a, b) => a[1].startedTurn - b[1].startedTurn);
    const excess = this.sealifts.size - this.options.maxSealifts;
    for (let i = 0; i < excess; i++) {
      this.sealifts.delete(ordered[i][0]);
      this.pruned += 1;
    }
  }
}
