/**
 * EspionagePolicy — which infiltration an AI diplomat picks.
 *
 * Pure scoring, so every branch is a table lookup rather than an engine run.
 * The ordering under test is Civ I's own: open a channel first, read the city
 * second, take something only when the temperament survives the war it costs.
 */
import { describe, it, expect } from 'vitest';
import { scoreEspionage, chooseEspionageAction, type EspionageContext } from '@/game/engine/diplomacy/EspionagePolicy';
import type { DiplomaticWeights } from '@/game/engine/diplomacy/DiplomaticWeights';

const NEUTRAL: DiplomaticWeights = {
  hostility: 5, warmongering: 5, trustSensitivity: 5, greed: 5,
  loyalty: 5, paranoia: 5, vengeance: 5, xenophobia: 5, patience: 5,
};

function ctx(overrides: Partial<EspionageContext> = {}): EspionageContext {
  return {
    civId: 0,
    targetCivId: 1,
    weights: NEUTRAL,
    status: 'peace',
    attitude: 'neutral',
    exhaustion: 0,
    hasEmbassy: false,
    techsWeWant: [],
    cityShields: 0,
    round: 5,
    sequence: 0,
    ...overrides,
  };
}

const actions = (c: EspionageContext) => scoreEspionage(c).map((x) => x.action);
const top = (c: EspionageContext) => scoreEspionage(c)[0]?.action;

describe('EspionagePolicy — gating', () => {
  it('offers nothing at war (the engine refuses these actions anyway)', () => {
    expect(scoreEspionage(ctx({ status: 'war', hasEmbassy: false }))).toEqual([]);
    expect(scoreEspionage(ctx({ status: 'war', techsWeWant: ['iron_working'] }))).toEqual([]);
  });

  it('never proposes sabotage on a city with nothing banked', () => {
    expect(actions(ctx({ cityShields: 0 }))).not.toContain('industrial_sabotage');
  });

  it('proposes sabotage once there are shields to destroy', () => {
    expect(actions(ctx({ cityShields: 12, hasEmbassy: true }))).toContain('industrial_sabotage');
  });

  it('never proposes stealing from a civ that knows nothing we lack', () => {
    expect(actions(ctx({ hasEmbassy: true, techsWeWant: [] }))).not.toContain('steal_technology');
  });

  it('proposes stealing once there is a secret worth taking', () => {
    expect(actions(ctx({ hasEmbassy: true, techsWeWant: ['iron_working'] }))).toContain('steal_technology');
  });
});

describe('EspionagePolicy — ordering', () => {
  it('opens an embassy before anything else', () => {
    // A channel is the gate on every term, so it outranks reading the city
    // and outranks stealing — even when there are secrets to take.
    expect(top(ctx({ hasEmbassy: false, techsWeWant: ['iron_working', 'pottery', 'writing'] })))
      .toBe('establish_embassy');
  });

  it('stops offering an embassy once one exists', () => {
    expect(actions(ctx({ hasEmbassy: true }))).not.toContain('establish_embassy');
  });

  it('reads the city when there is nothing else to do', () => {
    expect(top(ctx({ hasEmbassy: true }))).toBe('investigate_city');
  });

  it('a diplomatic civ hurries to open a channel, a xenophobic one drags its feet', () => {
    const eager = scoreEspionage(ctx({ weights: { ...NEUTRAL, trustSensitivity: 10, xenophobia: 1 } }));
    const reluctant = scoreEspionage(ctx({ weights: { ...NEUTRAL, trustSensitivity: 1, xenophobia: 10 } }));
    const scoreOf = (list: typeof eager, action: string) =>
      list.find((c) => c.action === action)?.score ?? -Infinity;
    expect(scoreOf(eager, 'establish_embassy')).toBeGreaterThan(scoreOf(reluctant, 'establish_embassy'));
  });
});

describe('EspionagePolicy — who actually steals', () => {
  const wanted = ['iron_working', 'pottery', 'writing'];

  it('a hostile civ outweighs a friendly one when stealing', () => {
    const hostile = scoreEspionage(ctx({ hasEmbassy: true, techsWeWant: wanted, attitude: 'hostile' }));
    const friendly = scoreEspionage(ctx({ hasEmbassy: true, techsWeWant: wanted, attitude: 'friendly' }));
    const scoreOf = (list: typeof hostile, action: string) =>
      list.find((c) => c.action === action)?.score ?? -Infinity;
    expect(scoreOf(hostile, 'steal_technology')).toBeGreaterThan(scoreOf(friendly, 'steal_technology'));
  });

  it('a loyal, trusting civ leaves the secrets alone', () => {
    // The restraint terms have to beat the haul: torching a peace you value
    // for one technology is not a trade a principled civ makes.
    const principled = ctx({
      hasEmbassy: true,
      techsWeWant: wanted,
      weights: { ...NEUTRAL, loyalty: 10, trustSensitivity: 10 },
    });
    const chosen = chooseEspionageAction(principled);
    expect(chosen?.action).not.toBe('steal_technology');
  });

  it('an exhausted civ stops reaching for what the enemy knows', () => {
    const fresh = scoreEspionage(ctx({ hasEmbassy: true, techsWeWant: wanted }));
    const weary = scoreEspionage(ctx({ hasEmbassy: true, techsWeWant: wanted, exhaustion: 20 }));
    const scoreOf = (list: typeof fresh, action: string) =>
      list.find((c) => c.action === action)?.score ?? -Infinity;
    expect(scoreOf(fresh, 'steal_technology')).toBeGreaterThan(scoreOf(weary, 'steal_technology'));
  });

  it('a grudging belligerent does steal, once the channel exists', () => {
    const belligerent = ctx({
      hasEmbassy: true,
      techsWeWant: wanted,
      attitude: 'hostile',
      weights: { ...NEUTRAL, vengeance: 10, warmongering: 10, loyalty: 1, trustSensitivity: 1 },
    });
    expect(chooseEspionageAction(belligerent)?.action).toBe('steal_technology');
  });

  it('a bigger haul is worth a bigger risk', () => {
    const one = scoreEspionage(ctx({ hasEmbassy: true, techsWeWant: ['iron_working'] }));
    const many = scoreEspionage(ctx({ hasEmbassy: true, techsWeWant: ['iron_working', 'pottery', 'writing'] }));
    const scoreOf = (list: typeof one, action: string) =>
      list.find((c) => c.action === action)?.score ?? -Infinity;
    expect(scoreOf(many, 'steal_technology')).toBeGreaterThan(scoreOf(one, 'steal_technology'));
  });
});

describe('EspionagePolicy — determinism', () => {
  const wanted = ['iron_working', 'pottery'];

  it('resolves the same way for the same context', () => {
    for (let i = 0; i < 10; i++) {
      expect(chooseEspionageAction(ctx({ hasEmbassy: true, techsWeWant: wanted })))
        .toEqual(chooseEspionageAction(ctx({ hasEmbassy: true, techsWeWant: wanted })));
    }
  });

  it('spreads its tiebreak across rounds rather than always picking the first', () => {
    // A civ with two near-equal options must not resolve by list order every
    // time, or the scores would be decoration. Round is the seeded salt.
    //
    // The profile is chosen so the two are genuinely close: a deeply
    // xenophobic, distrustful court is exactly the one that cannot decide
    // whether to open an embassy or just read the ledgers from a distance.
    // Neutral weights would not do — there the channel wins by 4.5 points and
    // no jitter could ever flip it.
    const undecided = ctx({
      hasEmbassy: false,
      weights: { ...NEUTRAL, trustSensitivity: 1, xenophobia: 10, paranoia: 6 },
    });
    const scored = scoreEspionage(undecided);
    expect(scored).toHaveLength(2);
    expect(Math.abs(scored[0].score - scored[1].score)).toBeLessThan(1);

    const picks = new Set<string>();
    for (let round = 1; round <= 40; round++) {
      const chosen = chooseEspionageAction({ ...undecided, round });
      if (chosen) picks.add(chosen.action);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});
