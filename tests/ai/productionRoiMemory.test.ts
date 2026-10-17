/**
 * ProductionROIMemory — roadmap item 5 in `doc/AI_MEMORY.adoc`.
 *
 * The module's whole claim is that a FORECAST should be held to what actually
 * happened. These tests pin that claim down: the noise floor, the asymmetry
 * between optimism and pessimism, the symmetry of the adjustment (memory must be
 * able to raise a priority, not only lower one), and the bounds.
 */
import { describe, it, expect } from 'vitest';
import {
  ProductionROIMemory,
  productionKey,
  type ProductionVerdict,
} from '@/game/engine/AI/ProductionROIMemory';

/** A civ that forecasts X and gets Y, `n` times. */
function experience(
  memory: ProductionROIMemory,
  kind: 'building' | 'unit' | 'wonder',
  key: string,
  forecast: ProductionVerdict,
  observed: ProductionVerdict,
  times: number,
  options: { projectedNet?: number; observedNet?: number; startTurn?: number } = {},
): void {
  for (let i = 0; i < times; i++) {
    const turn = (options.startTurn ?? 1) + i * 2;
    memory.recordTurn(turn);
    memory.recordForecast({
      kind, key, verdict: forecast,
      projectedNetPerTurn: options.projectedNet ?? 0,
      turn,
    });
    memory.recordTurn(turn + 1);
    memory.recordObservation({
      kind, key, verdict: observed,
      observedNetPerTurn: options.observedNet,
      turn: turn + 1,
    });
  }
}

describe('namespacing — a unit and a building never share a record', () => {
  it('keys by kind as well as by name', () => {
    expect(productionKey('building', 'aqueduct')).toBe('building:aqueduct');
    expect(productionKey('unit', 'aqueduct')).toBe('unit:aqueduct');
  });

  it('keeps them apart inside one memory', () => {
    const m = new ProductionROIMemory();
    m.recordForecast({ kind: 'building', key: 'granary', verdict: 'profitable', turn: 1 });
    m.recordForecast({ kind: 'unit', key: 'granary', verdict: 'inert', turn: 1 });
    expect(m.getRecord('building', 'granary')?.forecasts).toBe(1);
    expect(m.getRecord('unit', 'granary')?.verdict).toBeUndefined();
    expect(m.recordCount()).toBe(2);
  });
});

describe('a forecast is held to what happened', () => {
  it('counts a building that keeps its promise', () => {
    const m = new ProductionROIMemory();
    experience(m, 'building', 'marketplace', 'profitable', 'profitable', 4);
    const accuracy = m.accuracy('building', 'marketplace');
    expect(accuracy).toMatchObject({ forecasts: 4, observations: 4, hitRate: 1 });
  });

  it('counts a building that keeps breaking its promise', () => {
    const m = new ProductionROIMemory();
    // Forecast profitable, actually inert: two rungs worse every time.
    experience(m, 'building', 'temple', 'profitable', 'inert', 4);
    expect(m.accuracy('building', 'temple').hitRate).toBe(0);
  });

  it('tolerates one rung of drift as noise', () => {
    const m = new ProductionROIMemory();
    // break_even → draining is one rung. The equation is noisy; that is not a
    // forecasting failure worth learning from.
    experience(m, 'building', 'library', 'break_even', 'draining', 4);
    expect(m.accuracy('building', 'library').hitRate).toBe(1);
  });

  it('treats doing BETTER than promised as keeping the promise', () => {
    const m = new ProductionROIMemory();
    // The interesting case: an aqueduct the equation calls inert keeps the city
    // content. Memory must not punish the civ for a pessimistic forecast.
    experience(m, 'building', 'aqueduct', 'inert', 'break_even', 4);
    expect(m.accuracy('building', 'aqueduct').hitRate).toBe(1);
  });

  it('reports no hit rate before anything has been compared', () => {
    const m = new ProductionROIMemory();
    m.recordForecast({ kind: 'building', key: 'walls', verdict: 'profitable', turn: 1 });
    expect(m.accuracy('building', 'walls').hitRate).toBeNull();
    expect(m.accuracy('building', 'unknown').hitRate).toBeNull();
  });

  it('ignores an observation that has no forecast to be held to', () => {
    const m = new ProductionROIMemory();
    m.recordTurn(1);
    m.recordObservation({ kind: 'building', key: 'orphan', verdict: 'inert', turn: 1 });
    expect(m.accuracy('building', 'orphan')).toMatchObject({ observations: 1, hitRate: null });
  });
});

describe('realized value is measured against the projection', () => {
  it('records a positive bias when reality beat the forecast', () => {
    const m = new ProductionROIMemory();
    experience(m, 'building', 'bank', 'break_even', 'profitable', 3, {
      projectedNet: 1, observedNet: 6,
    });
    expect(m.accuracy('building', 'bank').netBias).toBeCloseTo(5);
    expect(m.hasPaidBefore('building', 'bank')).toBe(true);
  });

  it('records a negative bias when the forecast was too optimistic', () => {
    const m = new ProductionROIMemory();
    experience(m, 'building', 'colosseum', 'profitable', 'draining', 3, {
      projectedNet: 8, observedNet: -2,
    });
    expect(m.accuracy('building', 'colosseum').netBias).toBeCloseTo(-10);
    expect(m.hasPaidBefore('building', 'colosseum')).toBe(false);
  });

  it('compares an observation against the MEAN forecast, not the last one', () => {
    const m = new ProductionROIMemory();
    m.recordTurn(1);
    m.recordForecast({ kind: 'building', key: 'stable', projectedNetPerTurn: 4, turn: 1 });
    m.recordTurn(2);
    m.recordForecast({ kind: 'building', key: 'stable', projectedNetPerTurn: 6, turn: 2 });
    m.recordTurn(3);
    m.recordObservation({ kind: 'building', key: 'stable', observedNetPerTurn: 5, turn: 3 });
    // Mean forecast is 5, observed 5 → no bias.
    expect(m.accuracy('building', 'stable').netBias).toBeCloseTo(0);
  });
});

describe('the adjustment memory applies to a projected priority', () => {
  it('says nothing until it has enough samples', () => {
    const m = new ProductionROIMemory({ minSamples: 3 });
    experience(m, 'building', 'late', 'profitable', 'inert', 2);
    expect(m.valueAdjustment('building', 'late')).toMatchObject({
      multiplier: 1, reason: 'no-sample',
    });
  });

  it('says nothing at all about a key it has never seen', () => {
    const m = new ProductionROIMemory();
    expect(m.valueAdjustment('building', 'never_built')).toMatchObject({
      multiplier: 1, reason: 'no-sample', built: 0, hasPaidBefore: false,
    });
  });

  it('dampens a building whose forecasts keep failing', () => {
    const m = new ProductionROIMemory({ minSamples: 2 });
    experience(m, 'building', 'flop', 'profitable', 'inert', 4);
    const adjustment = m.valueAdjustment('building', 'flop');
    expect(adjustment.multiplier).toBeLessThan(1);
    expect(adjustment.reason).toBe('forecast-has-been-optimistic');
  });

  it('LIFTS a building the equation under-rates', () => {
    const m = new ProductionROIMemory({ minSamples: 2 });
    // Forecast inert with no gold, repeatedly turns out to earn.
    experience(m, 'building', 'underrated', 'inert', 'profitable', 4, {
      projectedNet: 0, observedNet: 4,
    });
    const adjustment = m.valueAdjustment('building', 'underrated');
    expect(adjustment.multiplier).toBeGreaterThan(1);
    expect(adjustment.reason).toBe('under-rated-by-forecast');
    expect(adjustment.hasPaidBefore).toBe(true);
  });

  it('stays out of the way for a building that does what it promised', () => {
    const m = new ProductionROIMemory({ minSamples: 2 });
    experience(m, 'building', 'reliable', 'profitable', 'profitable', 4, {
      projectedNet: 3, observedNet: 3,
    });
    expect(m.valueAdjustment('building', 'reliable')).toMatchObject({ multiplier: 1 });
  });

  it('never moves a priority by more than the configured clamp', () => {
    const m = new ProductionROIMemory({ minSamples: 1, maxAdjustment: 0.2 });
    experience(m, 'building', 'awful', 'profitable', 'inert', 6, {
      projectedNet: 20, observedNet: -20,
    });
    const adjustment = m.valueAdjustment('building', 'awful');
    expect(adjustment.multiplier).toBeGreaterThanOrEqual(0.8);
    expect(adjustment.multiplier).toBeLessThan(1);
  });

  it('demands a decision about a key it has never finished quickly', () => {
    const m = new ProductionROIMemory({ minSamples: 2 });
    for (let i = 0; i < 3; i++) {
      m.recordForecast({ kind: 'building', key: 'slow', verdict: 'profitable', buildTurns: 40, turn: i + 1 });
    }
    // No observations: only the build-time penalty applies, and it must be a
    // dampening, never a bonus.
    const adjustment = m.valueAdjustment('building', 'slow');
    expect(adjustment.multiplier).toBeLessThan(1);
    expect(m.averageBuildTurns('building', 'slow')).toBe(40);
  });

  it('averages build turns and refuses to invent one', () => {
    const m = new ProductionROIMemory();
    expect(m.averageBuildTurns('building', 'nothing')).toBeNull();
    m.recordBuildTime('building', 'walls', 10, 1);
    m.recordBuildTime('building', 'walls', 20, 2);
    expect(m.averageBuildTurns('building', 'walls')).toBe(15);
    // A nonsense measurement is ignored rather than poisoning the average.
    m.recordBuildTime('building', 'walls', 0, 3);
    expect(m.averageBuildTurns('building', 'walls')).toBe(15);
  });
});

describe('rankCandidates multiplies — it never deletes', () => {
  const candidates = [
    { type: 'marketplace', priority: 20 },
    { type: 'flop', priority: 18 },
    { type: 'temple', priority: 10 },
  ];

  it('returns every candidate, re-ordered by adjusted priority', () => {
    const m = new ProductionROIMemory({ minSamples: 2 });
    experience(m, 'building', 'flop', 'profitable', 'inert', 4);
    const ranked = m.rankCandidates(
      'building',
      candidates,
      (c) => c.priority,
      (c) => c.type,
    );
    expect(ranked).toHaveLength(3);
    // A reliable 20 still beats a discredited 18 only if memory says so; the
    // point is that nothing was removed and the order changed.
    expect(ranked[0].candidate.type).toBe('marketplace');
    expect(ranked.map((r) => r.candidate.type)).toContain('flop');
  });

  it('promotes an under-rated building above a nominally better one', () => {
    const m = new ProductionROIMemory({ minSamples: 2 });
    experience(m, 'building', 'underrated', 'inert', 'profitable', 5, {
      projectedNet: 0, observedNet: 6,
    });
    const withUnderrated = [...candidates, { type: 'underrated', priority: 10 }];
    const ranked = m.rankCandidates(
      'building',
      withUnderrated,
      (c) => c.priority,
      (c) => c.type,
    );
    const underrated = ranked.find((r) => r.candidate.type === 'underrated');
    expect(underrated).toBeDefined();
    expect(underrated!.reason).toBe('under-rated-by-forecast');
    // 10 × (1 + reward) overtakes the temple's untouched 10, but not the
    // marketplace's 20 — memory adjusts a forecast, it does not invent a plan.
    expect(ranked.map((r) => r.candidate.type).indexOf('underrated'))
      .toBeLessThan(ranked.map((r) => r.candidate.type).indexOf('temple'));
    expect(ranked[0].candidate.type).toBe('marketplace');
  });

  it('carries the memory reason through for the AI log', () => {
    const m = new ProductionROIMemory();
    const ranked = m.rankCandidates('building', candidates, (c) => c.priority, (c) => c.type);
    expect(ranked.every((r) => r.reason === 'no-sample')).toBe(true);
  });

  it('is a pure function of its input', () => {
    const m = new ProductionROIMemory();
    const input = [...candidates];
    m.rankCandidates('building', input, (c) => c.priority, (c) => c.type);
    expect(input).toEqual(candidates);
  });
});

describe('bounded over a long game', () => {
  it('caps records and forgets the least recently touched', () => {
    const m = new ProductionROIMemory({ maxRecords: 5 });
    m.recordTurn(1);
    for (let i = 0; i < 20; i++) {
      m.recordForecast({ kind: 'building', key: `b${i}`, verdict: 'profitable', turn: 1 });
    }
    expect(m.recordCount()).toBe(5);
    // Later keys survived; the very first did not.
    expect(m.getRecord('building', 'b19')).not.toBeNull();
    expect(m.getRecord('building', 'b0')).toBeNull();
  });

  it('expires a key nobody has touched for a long time', () => {
    const m = new ProductionROIMemory({ recordTtlTurns: 10 });
    m.recordTurn(1);
    m.recordForecast({ kind: 'building', key: 'old', verdict: 'profitable', turn: 1 });
    m.recordTurn(5);
    expect(m.getRecord('building', 'old')).not.toBeNull();
    m.recordTurn(50);
    expect(m.getRecord('building', 'old')).toBeNull();
    expect(m.currentTurnNumber()).toBe(50);
  });

  it('stays bounded across 400 turns of churn', () => {
    const m = new ProductionROIMemory({ maxRecords: 40 });
    for (let turn = 1; turn <= 400; turn++) {
      m.recordTurn(turn);
      const key = `b${turn % 90}`;
      m.recordForecast({ kind: 'building', key, verdict: 'profitable', turn });
      if (turn % 2 === 0) {
        m.recordObservation({
          kind: 'building', key, verdict: turn % 9 === 0 ? 'inert' : 'profitable', turn,
        });
      }
    }
    expect(m.recordCount()).toBeLessThanOrEqual(40);
    expect(m.currentTurnNumber()).toBe(400);
  });

  it('starts empty', () => {
    const m = new ProductionROIMemory();
    expect(m.recordCount()).toBe(0);
    expect(m.getRecords()).toEqual([]);
    expect(m.currentTurnNumber()).toBe(0);
  });

  it('lists records most recently touched first', () => {
    const m = new ProductionROIMemory();
    m.recordTurn(1);
    m.recordForecast({ kind: 'building', key: 'old', turn: 1 });
    m.recordTurn(9);
    m.recordForecast({ kind: 'building', key: 'new', turn: 9 });
    expect(m.getRecords().map((r) => r.key)).toEqual(['new', 'old']);
  });
});
