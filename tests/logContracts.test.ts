/**
 * Diagnostics contract: the log → CSV pipeline must not lose data silently.
 *
 * The AI is tuned from the exported progression CSV, and its per-round
 * diagnostics (`attacks`, `moveFailures`, `stalls`, `noTarget`,
 * `misbehavingUnits`) are built by string-matching log messages and reason
 * codes. Nothing in the suite covered that: renaming a log line or an event
 * name used to leave the suite green while whole CSV columns quietly went to
 * zero — the exact kind of regression that survives for weeks.
 *
 * This file pins:
 *  - which engine events reach the CSV at all (LOG_EVENT_ALLOWLIST)
 *  - that the events the diagnostics count on are IN that allowlist
 *  - that the stall-reason vocabulary matches what the AI actually emits
 *  - that a full round of realistic entries produces the expected counters
 */
import { describe, it, expect } from 'vitest';
import {
  buildRoundDiagnostics,
  filterLogEntries,
  LOG_EVENT_ALLOWLIST,
  DIAGNOSTIC_STALL_REASONS,
} from '../src/utils/GameProgression';
import type { ProgressionLogEntry } from '../types/progression';

/** Mirrors the real log shape: the interesting fields live under `detail.data`. */
function entry(
  event: string,
  message = '',
  data: Record<string, unknown> = {},
  round = 1,
): ProgressionLogEntry {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    round,
    player: 0,
    event,
    message,
    detail: { data },
  };
}

describe('Diagnostics contract: the CSV event allowlist', () => {
  it('carries every event the diagnostics count on', () => {
    // If one of these left the allowlist, its column would silently go to 0.
    for (const event of [
      'UNIT_MOVED', 'UNIT_SKIPPED', 'COMBAT_VICTORY', 'COMBAT_DEFEAT',
      'UNIT_DEFEATED', 'CITY_FOUNDED', 'CITY_CAPTURED', 'CITY_DESTROYED',
      'CITY_PRODUCTION_CHANGED', 'UNIT_DISBANDED', 'WAR_DECLARED',
    ]) {
      expect(LOG_EVENT_ALLOWLIST.has(event), `${event} must reach the CSV`).toBe(true);
    }
  });

  it('keeps engine-internal noise out', () => {
    for (const event of ['PHASE_CHANGE', 'AI_FINISHED', 'RESEARCH_PHASE', 'UNIT_REMOVED']) {
      expect(LOG_EVENT_ALLOWLIST.has(event), `${event} is engine noise`).toBe(false);
    }
  });

  it('a dropped event really does disappear from the export', () => {
    const kept = filterLogEntries([
      entry('UNIT_MOVED', 'Move: warrior(1) → (2,2)'),
      entry('PHASE_CHANGE', 'phase → moving'),
    ]);
    expect(kept.map((e) => e.event)).toEqual(['UNIT_MOVED']);
  });
});

describe('Diagnostics contract: stall reasons', () => {
  it('knows the reasons the AI emits when a unit gets stuck', () => {
    for (const reason of [
      'stuck', 'no_path', 'no_affordable_step', 'insufficient_moves', 'max_movement_attempts',
    ]) {
      expect(DIAGNOSTIC_STALL_REASONS.has(reason), reason).toBe(true);
    }
  });
});

describe('Diagnostics contract: a realistic round of entries', () => {
  it('counts attacks, failures, stalls and losses', () => {
    const entries: ProgressionLogEntry[] = [
      // Structured AI actions (the preferred path — no string matching).
      entry('GAME_LOG', 'Attack — warrior(1) → (5,5)', { category: 'ai', action: 'attack', unitType: 'warrior' }),
      entry('GAME_LOG', 'Move failed', { category: 'ai', action: 'move_failed', unitType: 'scout', reason: 'stuck' }),
      entry('GAME_LOG', 'No target', { category: 'ai', action: 'no_target', unitType: 'settler' }),
      entry('GAME_LOG', 'Research — Pottery', { category: 'ai', action: 'research', tech: 'pottery' }),
      entry('GAME_LOG', 'Strategy change', { category: 'ai', action: 'strategy', to: 'military_expansion' }),
      // Engine events.
      entry('UNIT_MOVED', 'Move: warrior(1) → (6,6)'),
      entry('UNIT_SKIPPED', 'Skip: warrior(1)'),
      entry('COMBAT_VICTORY', 'Victory'),
      entry('UNIT_DEFEATED', 'Defeated'),
      entry('CITY_FOUNDED', 'Rome founded'),
    ];

    const diag = buildRoundDiagnostics(entries);
    const row = [...diag.values()][0];

    expect(row.attacks).toBe(1);
    expect(row.moveFailures).toBe(1);
    expect(row.stalls).toBeGreaterThanOrEqual(2); // the move failure + no target
    expect(row.noTarget).toBe(1);
    expect(row.moves).toBe(1);
    expect(row.skips).toBe(1);
    expect(row.combatWins).toBe(1);
    expect(row.unitsLost).toBe(1);
    expect(row.citiesFounded).toBe(1);
    // Keyed `type:reason`, and a stalled move is recorded twice (the failure
    // plus the stall reason) — that duplication is intentional, the CSV sums
    // per round.
    expect(row.misbehavingUnits['scout:stuck']).toBeGreaterThanOrEqual(1);
    expect(row.aiNotes.join(' ')).toContain('research:pottery');
    expect(row.aiNotes.join(' ')).toContain('strategy:military_expansion');
  });

  it('still counts the legacy plain-text form (message without an action)', () => {
    // Older log lines have no structured `action`; the message matching is the
    // only thing that keeps those rounds in the CSV, so it must keep working.
    const diag = buildRoundDiagnostics([
      entry('GAME_LOG', 'Move — Americans warrior(1) → (7,7)', { category: 'ai' }),
      entry('GAME_LOG', 'Move failed, skipping unit', { category: 'ai' }),
      entry('GAME_LOG', 'Path step failed, skipping unit', { category: 'ai' }),
      entry('GAME_LOG', 'No target found for unit', { category: 'ai' }),
    ]);
    const row = [...diag.values()][0];
    expect(row.aiActions).toBe(4);
    expect(row.moveFailures).toBe(2);
    expect(row.noTarget).toBe(1);
  });

  it('an empty round produces zeros, not garbage', () => {
    const diag = buildRoundDiagnostics([entry('TURN_START', 'Turn 1')]);
    const row = [...diag.values()][0];
    expect(row.attacks).toBe(0);
    expect(row.moveFailures).toBe(0);
    expect(row.misbehavingUnits).toEqual({});
  });
});
