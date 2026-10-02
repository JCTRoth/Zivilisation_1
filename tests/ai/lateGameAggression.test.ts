/**
 * Late game: the AI has to get MORE aggressive as the calendar runs out, not
 * less.
 *
 * Before this, `currentYear` fed aggression exactly once — the early-rush
 * window at `year < -1500` — and then stopped mattering for the rest of the
 * game. A cautious personality therefore coasted through the ancient era and
 * never committed even when the map was nearly divided, while the diplomacy
 * model demanded a target 1.6× weaker before a war was worth starting, so
 * near-parity rivals were simply never attacked.
 *
 * Two symmetric late-game pushes now exist: `AIAggression.lateGameAggression`
 * for the aggression posture, and `warTargetMargin` / `lateGameWarPush` /
 * `maxConcurrentWars` for the declaration model.
 */
import { describe, it, expect } from 'vitest';
import {
  AGGRESSION_TRIGGER_BAND,
  AGGRESSION_TRIGGER_THRESHOLD,
  computeAggression,
  lateGameAggression,
} from '@/game/engine/AI/AIAggression';
import {
  chooseAction,
  lateGameWarPush,
  mayDeclareWar,
  maxConcurrentWars,
  scoreCandidates,
  warTargetMargin,
  type PolicyContext,
} from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import { diplomaticWeights } from '@/game/engine/diplomacy/DiplomaticWeights';
import { createOpinion } from '@/game/engine/diplomacy/DiplomaticOpinion';

const WARLORD = { aggression: 9, diplomacy: 2, military: 9, expansion: 6, science: 3, economy: 4 };

/** A borderline civ: not outmatched, not secured, nothing known to attack. */
function borderline(over: Record<string, unknown> = {}) {
  return {
    personalityAggression: 2,
    ownArmyStrength: 10,
    enemyArmyStrength: 10,
    criticalThreats: 0,
    threatenedCities: 1,
    knownEnemyCities: 0,
    numOwnCities: 1,
    numEnemyCities: 0,
    isAtWar: false,
    currentYear: -2000,
    ...over,
  };
}

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    civId: 1,
    otherId: 0,
    weights: diplomaticWeights({ id: 1, personality: WARLORD }),
    opinion: createOpinion(),
    status: 'peace',
    treaties: [],
    ownStrength: 160,
    theirStrength: 100,
    ownGold: 300,
    activeWars: 0,
    maxWars: 3,
    exhaustion: 0,
    turnsSince: 30,
    roundsSincePeace: Infinity,
    sharedEnemy: false,
    round: 20,
    sequence: 1,
    ...over,
  };
}

describe('late-game aggression push', () => {
  it('adds nothing before year 0 and escalates after it', () => {
    expect(lateGameAggression(-1)).toBe(0);
    expect(lateGameAggression(-1500)).toBe(0);
    expect(lateGameAggression(0)).toBeGreaterThan(0);
    expect(lateGameAggression(1000)).toBeGreaterThan(lateGameAggression(0));
    expect(lateGameAggression(1500)).toBeGreaterThan(lateGameAggression(1000));
    expect(lateGameAggression(1750)).toBeGreaterThan(lateGameAggression(1500));
  });

  it('tips a borderline civ into an aggressive posture only once the game is old', () => {
    const early = computeAggression(borderline(), () => 0);
    const late = computeAggression(borderline({ currentYear: 1750 }), () => 0);

    // The push is additive and equals lateGameAggression(year).
    expect(late.score - early.score).toBe(lateGameAggression(1750));
    expect(early.reasons).not.toContain('endgame push');
    expect(late.reasons).toContain('endgame push');

    // Below the trigger band the civ never attacks, whatever the dice say…
    expect(early.score).toBeLessThanOrEqual(AGGRESSION_TRIGGER_THRESHOLD - AGGRESSION_TRIGGER_BAND);
    expect(early.aggressive).toBe(false);
    // …and the late-game push is what carries the same civ over the line.
    expect(late.aggressive).toBe(true);
  });

  it('never overrides a city that is actually under critical threat', () => {
    const beset = computeAggression(borderline({ criticalThreats: 2, currentYear: 1800 }), () => 0);
    expect(beset.aggressive).toBe(false);
    expect(beset.score).toBeLessThan(AGGRESSION_TRIGGER_THRESHOLD - AGGRESSION_TRIGGER_BAND);
  });

  it('labels 1500+ as an endgame push and earlier years as a late-game push', () => {
    expect(computeAggression(borderline({ currentYear: 500 }), () => 0).reasons)
      .toContain('late-game push');
    expect(computeAggression(borderline({ currentYear: 1600 }), () => 0).reasons)
      .toContain('endgame push');
  });
});

describe('late-game war policy', () => {
  it('closes the strength margin a target has to clear', () => {
    expect(warTargetMargin(-3000)).toBe(1.6);
    expect(warTargetMargin(undefined)).toBe(1.6);
    expect(warTargetMargin(100)).toBeLessThan(1.6);
    expect(warTargetMargin(1100)).toBeLessThan(warTargetMargin(100));
    expect(warTargetMargin(1600)).toBeLessThan(warTargetMargin(1100));
  });

  it('adds a flat endgame push to the war score', () => {
    expect(lateGameWarPush(-3000)).toBe(0);
    expect(lateGameWarPush(undefined)).toBe(0);
    expect(lateGameWarPush(1600)).toBeGreaterThan(0);
    expect(lateGameWarPush(1800)).toBeGreaterThan(lateGameWarPush(1600));
  });

  it('allows one more front as the calendar runs out', () => {
    const weights = diplomaticWeights({ id: 1, personality: WARLORD });
    const base = maxConcurrentWars(weights);
    expect(maxConcurrentWars(weights, -3000)).toBe(base);
    const late = maxConcurrentWars(weights, 1100);
    const endgame = maxConcurrentWars(weights, 1800);
    expect(late).toBeGreaterThan(base);
    expect(endgame).toBeGreaterThan(late);

    // …and mayDeclareWar honours the raised cap.
    expect(mayDeclareWar(context({ activeWars: base, maxWars: base })).ok).toBe(false);
    expect(mayDeclareWar(context({ activeWars: base, maxWars: late })).ok).toBe(true);
  });

  it('turns a near-parity neighbour into a war target only late in the game', () => {
    // 1.6× stronger: exactly the old margin, so the ancient-era civ sees no
    // reason to attack, while the endgame civ — margin 1.1 plus the flat
    // push — does.
    const early = context({ currentYear: -2000 });
    const late = context({ currentYear: 1600 });

    const earlyWar = scoreCandidates(early).find((c) => c.action === 'declare_war');
    const lateWar = scoreCandidates(late).find((c) => c.action === 'declare_war');
    expect(earlyWar).toBeDefined();
    expect(lateWar).toBeDefined();
    expect(lateWar!.score).toBeGreaterThan(earlyWar!.score);
    expect(lateWar!.because).toContain('endgame push');

    expect(chooseAction(scoreCandidates(early), early)?.action).not.toBe('declare_war');
    expect(chooseAction(scoreCandidates(late), late)?.action).toBe('declare_war');
  });
});
