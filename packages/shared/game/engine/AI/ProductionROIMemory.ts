/**
 * ProductionROIMemory — what this civ learned from what it actually built.
 *
 * Roadmap item 5 in `doc/AI_MEMORY.adoc`.
 *
 * Every production decision in this game is a FORECAST. `BuildingEconomics`
 * runs an honest equation — income the engine really credits, upkeep the engine
 * really charges, effects the engine really consumes — and calls the result
 * `profitable`, `break_even`, `draining` or `inert`. Then it throws the answer
 * away and re-runs it from scratch for the next city, the next turn and the
 * next civ, having learned nothing from the last thousand buildings.
 *
 * That is the gap this closes. It is not a cache of forecasts: it is the record
 * of a forecast being **re-observed**. A building is scored when it is chosen,
 * scored again once it is standing and the city has settled around it, and the
 * two answers are compared:
 *
 *  * a building forecast `profitable` that re-observes as `draining` is a miss,
 *    and repeated misses make the AI cautious about it;
 *  * a building forecast `draining` or `inert` that keeps turning out to pay —
 *    an aqueduct holding a city content, a barracks feeding the war machine —
 *    is the more valuable lesson, because the equation cannot see content. It
 *    is exactly the case where the "cost/usage equation has the casting vote"
 *    rule in `BuildingAnalyzer` would otherwise liquidate a building that works;
 *  * a building that takes far longer to build than its shield cost implies is
 *    recorded, because a building that only exists a third of the time is not
 *    worth the same priority as one that lands every time.
 *
 * Design rules, identical to the other memory modules:
 *
 *  * the engine stays the source of truth — this records *comparisons*, never
 *    units, cities or buildings, and mutates nothing;
 *  * turn-keyed: `recordTurn` drives expiry, so nothing depends on a wall clock;
 *  * bounded: capped key count with least-recently-used eviction;
 *  * pure reads: the scoring helpers are functions over memory state, testable
 *    without an engine;
 *  * **symmetric**: an adjustment can raise a priority as well as lower it. A
 *    memory that could only ever subtract would quietly learn to build nothing.
 *
 * One instance per civilization — every record is a statement about what THIS
 * civ built and what happened to it. `AIManager` owns them in a map by civ id.
 */

/** The four readings `BuildingEconomics` can return. Mirrored as a loose union. */
export type ProductionVerdict = 'profitable' | 'break_even' | 'draining' | 'inert';

/** What a civ can queue. Wonders are buildings that happen to be unique. */
export type ProductionKind = 'building' | 'unit' | 'wonder';

/** How well a forecast held up once the thing it was about was standing. */
export interface ProductionAccuracy {
  /** Times a forecast was recorded. */
  forecasts: number;
  /** Times a re-observation was recorded. */
  observations: number;
  /** Observations that agreed with the forecast, 0..1. Null before any. */
  hitRate: number | null;
  /** Mean realized − projected net gold/turn. Positive = forecasts too pessimistic. */
  netBias: number;
}

/** Everything remembered about one production key. */
export interface ProductionRecord {
  kind: ProductionKind;
  key: string;
  /** Times this civ completed one. */
  built: number;
  /** Times a forecast was taken before building. */
  forecasts: number;
  /** Times it was re-observed after building. */
  observations: number;
  /** Re-observations that agreed with the forecast. */
  hits: number;
  /** The most recent forecast verdict, so an observation can be held to it. */
  lastForecastVerdict?: ProductionVerdict;
  /** Sum of (observed rung − forecast rung) across comparisons. */
  verdictDeltaTotal: number;
  /** How many comparisons were actually made (both verdicts known). */
  comparisons: number;
  /** Sum of projected net gold/turn across forecasts. */
  projectedNetTotal: number;
  /** Sum of observed net gold/turn across observations. */
  observedNetTotal: number;
  /**
   * Sum of observed net gold/turn from MEASURED observations only.
   *
   * Kept apart from `observedNetTotal` on purpose: when a caller supplies no
   * measured figure the observation falls back to the projection, and a fallback
   * must never be allowed to masquerade as a result. "Has this ever paid for
   * itself?" is a claim about reality, so it reads this field.
   */
  measuredNetTotal: number;
  /** How many observations carried a real measured figure. */
  measuredObservations: number;
  /** Sum of observed gold-equivalent value (the equation's own currency). */
  observedValueTotal: number;
  /** Sum of observed build turns, for the average below. */
  buildTurnsTotal: number;
  /** How many builds we have a measured duration for. */
  measuredBuilds: number;
  /** How many times the projection read `profitable` / `inert`. */
  profitableForecasts: number;
  inertForecasts: number;
  /** Mean realized − projected net gold/turn. */
  netBias: number;
  /** Turn of the most recent forecast or observation. */
  lastTouchedTurn: number;
  /** Turn the last one was built on, when known. */
  lastBuiltTurn?: number;
}

/** What memory contributes to one production decision. */
export interface ProductionAdjustment {
  /** Multiplier for a projected priority. 1 = memory has nothing to say. */
  multiplier: number;
  /** Whether this key has ever paid for itself in practice. */
  hasPaidBefore: boolean;
  /** How many times it has been built. */
  built: number;
  /** Why memory is adjusting (or not). Surfaced in the AI log. */
  reason: string;
}

export interface ProductionROIMemoryOptions {
  /** Cap on remembered keys. */
  maxRecords?: number;
  /** Turns after which an untouched key is forgotten. */
  recordTtlTurns?: number;
  /** Forecasts needed before memory will move a priority at all. */
  minSamples?: number;
  /** Clamp on the multiplier, so one bad building cannot rewrite a strategy. */
  maxAdjustment?: number;
}

const DEFAULTS = {
  maxRecords: 160,
  recordTtlTurns: 200,
  minSamples: 2,
  maxAdjustment: 0.6,
} as const;

/** Verdicts ordered worst → best, so "better than forecast" is a positive. */
const VERDICT_RANK: Record<ProductionVerdict, number> = {
  inert: 0,
  draining: 1,
  break_even: 2,
  profitable: 3,
};

/**
 * A re-observation has to be at least this many rungs worse than the forecast
 * before it counts as a miss. The equation is noisy — a city can be threatened,
 * unhappy or poor on any given turn — so demanding exact agreement would make
 * every building look like a forecasting failure.
 *
 * Two rungs, because the ladder is `inert < draining < break_even < profitable`:
 * one rung is noise, and "a bit less good than promised" is not a failure worth
 * learning from.
 */
const MISS_RUNG_DELTA = -2;

const MISS_PENALTY = 0.25;
const HIT_REWARD = 0.15;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** `building:aqueduct` / `unit:warrior`, so the two namespaces cannot collide. */
export function productionKey(kind: ProductionKind, key: string): string {
  return `${kind}:${key}`;
}

export class ProductionROIMemory {
  private readonly options: Required<ProductionROIMemoryOptions>;
  private readonly records = new Map<string, ProductionRecord>();
  private currentTurn = 0;

  constructor(options: ProductionROIMemoryOptions = {}) {
    this.options = {
      maxRecords: options.maxRecords ?? DEFAULTS.maxRecords,
      recordTtlTurns: options.recordTtlTurns ?? DEFAULTS.recordTtlTurns,
      minSamples: options.minSamples ?? DEFAULTS.minSamples,
      maxAdjustment: options.maxAdjustment ?? DEFAULTS.maxAdjustment,
    };
  }

  // ── clock ────────────────────────────────────────────────────────────────

  /** Advance the turn clock and forget keys nobody has touched in a long while. */
  recordTurn(turn: number): void {
    this.currentTurn = turn;
    for (const [id, record] of this.records) {
      if (turn - record.lastTouchedTurn > this.options.recordTtlTurns) {
        this.records.delete(id);
      }
    }
  }

  currentTurnNumber(): number {
    return this.currentTurn;
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /**
   * Record the forecast taken BEFORE building something, and that it was built.
   *
   * This is the moment the AI had a number in its hand and acted on it, so it is
   * the only point at which the forecast is genuinely a forecast.
   */
  recordForecast(input: {
    kind: ProductionKind;
    key: string;
    /** The verdict the equation gave at planning time, when available. */
    verdict?: ProductionVerdict;
    /** Projected net gold/turn at planning time. */
    projectedNetPerTurn?: number;
    /** Turns the build actually took, when the caller can measure it. */
    buildTurns?: number;
    turn?: number;
  }): ProductionRecord {
    const turn = input.turn ?? this.currentTurn;
    const record = this.lift(input.kind, input.key, turn);
    record.forecasts += 1;
    record.built += 1;
    record.lastBuiltTurn = turn;
    if (typeof input.projectedNetPerTurn === 'number') {
      record.projectedNetTotal += input.projectedNetPerTurn;
    }
    if (input.verdict) record.lastForecastVerdict = input.verdict;
    if (input.verdict === 'profitable') record.profitableForecasts += 1;
    if (input.verdict === 'inert') record.inertForecasts += 1;
    if (typeof input.buildTurns === 'number' && input.buildTurns > 0) {
      record.buildTurnsTotal += input.buildTurns;
      record.measuredBuilds += 1;
    }
    this.cap();
    return record;
  }

  /**
   * Record a re-observation: the equation run again, now that the building is
   * standing and the city has had time to show what it is worth.
   *
   * `projectedNetPerTurn` defaults to the stored mean of past forecasts for this
   * key, which is the honest comparison: what we expected, on average, versus
   * what we are seeing now.
   */
  recordObservation(input: {
    kind: ProductionKind;
    key: string;
    verdict?: ProductionVerdict;
    /** Measured net gold/turn. Defaults to the mean projection. */
    observedNetPerTurn?: number;
    /** The equation's own value figure, in gold-equivalent. */
    observedValue?: number;
    turn?: number;
  }): ProductionRecord {
    const turn = input.turn ?? this.currentTurn;
    const record = this.lift(input.kind, input.key, turn);
    const projectedMean = record.forecasts > 0
      ? record.projectedNetTotal / record.forecasts
      : 0;
    const observed = typeof input.observedNetPerTurn === 'number'
      ? input.observedNetPerTurn
      : projectedMean;

    record.observations += 1;
    record.observedNetTotal += observed;
    if (typeof input.observedValue === 'number') {
      record.observedValueTotal += input.observedValue;
    }
    if (typeof input.observedNetPerTurn === 'number') {
      record.measuredNetTotal += input.observedNetPerTurn;
      record.measuredObservations += 1;
    }

    // Recompute the bias as a mean of per-observation deltas, so a later small
    // observation cannot be swamped by an early large one.
    const delta = observed - projectedMean;
    record.netBias = (record.netBias * (record.observations - 1) + delta) / record.observations;

    // Hold the re-observation to the forecast: a forecast is a promise, and the
    // only fair test is whether the thing kept it. Being BETTER than promised is
    // not a failure — it is precisely the lesson a stateless equation cannot
    // teach itself, and it is counted as a hit.
    if (input.verdict && record.lastForecastVerdict) {
      const rungDelta = VERDICT_RANK[input.verdict] - VERDICT_RANK[record.lastForecastVerdict];
      record.verdictDeltaTotal += rungDelta;
      record.comparisons += 1;
      if (rungDelta >= MISS_RUNG_DELTA) record.hits += 1;
    }

    this.cap();
    return record;
  }

  /** Mark a build as having completed, with its measured duration. */
  recordBuildTime(kind: ProductionKind, key: string, buildTurns: number, turn: number = this.currentTurn): void {
    if (!(buildTurns > 0)) return;
    const record = this.lift(kind, key, turn);
    record.buildTurnsTotal += buildTurns;
    record.measuredBuilds += 1;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  getRecord(kind: ProductionKind, key: string): ProductionRecord | null {
    return this.records.get(productionKey(kind, key)) ?? null;
  }

  /** Every remembered key, most recently touched first. */
  getRecords(): readonly ProductionRecord[] {
    return [...this.records.values()].sort((a, b) => b.lastTouchedTurn - a.lastTouchedTurn);
  }

  recordCount(): number {
    return this.records.size;
  }

  /** Forecast accuracy for one key. */
  accuracy(kind: ProductionKind, key: string): ProductionAccuracy {
    const record = this.getRecord(kind, key);
    if (!record) {
      return { forecasts: 0, observations: 0, hitRate: null, netBias: 0 };
    }
    return {
      forecasts: record.forecasts,
      observations: record.observations,
      // Only counts comparisons where both a forecast and an observation existed.
      hitRate: record.comparisons > 0 ? record.hits / record.comparisons : null,
      netBias: record.netBias,
    };
  }

  /** Mean turns this civ has actually spent building a key; null if unmeasured. */
  averageBuildTurns(kind: ProductionKind, key: string): number | null {
    const record = this.getRecord(kind, key);
    if (!record || record.measuredBuilds === 0) return null;
    return record.buildTurnsTotal / record.measuredBuilds;
  }

  /**
   * Has this key ever earned more than it cost, IN PRACTICE?
   *
   * Requires at least one real measurement: a projection that was optimistic on
   * paper is not evidence that the building pays, and treating it as such would
   * let a civ convince itself that every money pit was a gold mine.
   */
  hasPaidBefore(kind: ProductionKind, key: string): boolean {
    const record = this.getRecord(kind, key);
    if (!record || record.measuredObservations === 0) return false;
    return record.measuredNetTotal > 0;
  }

  /** Mean MEASURED net gold/turn; null when nothing was ever measured. */
  averageMeasuredNet(kind: ProductionKind, key: string): number | null {
    const record = this.getRecord(kind, key);
    if (!record || record.measuredObservations === 0) return null;
    return record.measuredNetTotal / record.measuredObservations;
  }

  /**
   * How much memory wants to move a projected priority. **1 means "no opinion"**,
   * above 1 raises it, below 1 lowers it — and the two are not symmetric: a key
   * is only ever lifted when the evidence is genuinely positive, while a single
   * pattern of misses is enough to dampen it.
   *
   * Nothing is said until `minSamples` forecasts exist, because one bad building
   * in a bad city is noise. The result is clamped by `maxAdjustment` so a key can
   * never be deleted from consideration by memory alone.
   */
  valueAdjustment(kind: ProductionKind, key: string): ProductionAdjustment {
    const record = this.getRecord(kind, key);
    if (!record || record.forecasts < this.options.minSamples) {
      return { multiplier: 1, hasPaidBefore: false, built: record?.built ?? 0, reason: 'no-sample' };
    }
    const limit = this.options.maxAdjustment;
    let delta = 0;

    if (record.comparisons > 0) {
      const missRate = 1 - record.hits / record.comparisons;
      delta -= missRate * MISS_PENALTY;
      // Positive bias means the equation under-rates this key: the realised net
      // is better than projected, which is the case the equation structurally
      // cannot see (content, veteran supply, freed-up trade).
      if (record.netBias > 0) delta += clamp(record.netBias / 10, 0, HIT_REWARD);
      else if (record.netBias < 0) delta += clamp(record.netBias / 20, -HIT_REWARD, 0);
    }
    // A key we have never managed to finish quickly is worth less patience.
    if (record.measuredBuilds > 1 && record.buildTurnsTotal / record.measuredBuilds > 20) {
      delta -= 0.1;
    }

    if (delta === 0) {
      return { multiplier: 1, hasPaidBefore: this.hasPaidBefore(kind, key), built: record.built, reason: 'no-opinion' };
    }
    return {
      multiplier: clamp(1 + delta, 1 - limit, 1 + limit),
      hasPaidBefore: this.hasPaidBefore(kind, key),
      built: record.built,
      reason: delta > 0 ? 'under-rated-by-forecast' : 'forecast-has-been-optimistic',
    };
  }

  /**
   * Re-rank build candidates with memory applied.
   *
   * Pure over its input, and total: every candidate comes back, multiplied.
   * Memory never removes a candidate from consideration — that is the
   * coordinator's job, and a memory that could delete options would be a
   * strategy, not a memory.
   */
  rankCandidates<T>(
    kind: ProductionKind,
    candidates: readonly T[],
    priorityOf: (candidate: T) => number,
    keyOf: (candidate: T) => string,
  ): Array<{ candidate: T; priority: number; reason: string }> {
    const scored = candidates.map((candidate) => {
      const adjustment = this.valueAdjustment(kind, keyOf(candidate));
      const priority = priorityOf(candidate) * adjustment.multiplier;
      return { candidate, priority, reason: adjustment.reason };
    });
    scored.sort((a, b) => b.priority - a.priority);
    return scored;
  }

  // ── internals ───────────────────────────────────────────────────────────

  private lift(kind: ProductionKind, key: string, turn: number): ProductionRecord {
    const id = productionKey(kind, key);
    const existing = this.records.get(id);
    if (existing) {
      existing.lastTouchedTurn = turn;
      return existing;
    }
    const record: ProductionRecord = {
      kind,
      key,
      built: 0,
      forecasts: 0,
      observations: 0,
      hits: 0,
      verdictDeltaTotal: 0,
      comparisons: 0,
      projectedNetTotal: 0,
      observedNetTotal: 0,
      measuredNetTotal: 0,
      measuredObservations: 0,
      observedValueTotal: 0,
      buildTurnsTotal: 0,
      measuredBuilds: 0,
      profitableForecasts: 0,
      inertForecasts: 0,
      netBias: 0,
      lastTouchedTurn: turn,
    };
    this.records.set(id, record);
    return record;
  }

  /** Least-recently-touched keys go first: stale experience is worth least. */
  private cap(): void {
    if (this.records.size <= this.options.maxRecords) return;
    const ordered = [...this.records.entries()].sort(
      (a, b) => a[1].lastTouchedTurn - b[1].lastTouchedTurn,
    );
    const excess = this.records.size - this.options.maxRecords;
    for (let i = 0; i < excess; i++) this.records.delete(ordered[i][0]);
  }
}
