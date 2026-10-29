import { describe, expect, it } from 'vitest';
import { makeTeamEngine } from './teamHelpers';
import { scoreCandidates, type PolicyContext } from '@/game/engine/diplomacy/AIDiplomacyPolicy';
import { diplomatActionsFor } from '@/game/engine/diplomacy/DiplomatAbilities';
import { diplomaticWeights } from '@/game/engine/diplomacy/DiplomaticWeights';
import { createOpinion } from '@/game/engine/diplomacy/DiplomaticOpinion';

describe('fixed alliances in diplomacy', () => {
  it('forces every teammate pair into a locked alliance with an embassy', () => {
    const { diplomacyManager: dm } = makeTeamEngine(4, [0, 0, 1, 1]);

    expect(dm.getStatus(0, 1)).toBe('alliance');
    expect(dm.isAllied(0, 1)).toBe(true);
    expect(dm.isAtWar(0, 1)).toBe(false);
    expect(dm.hasEmbassy(0, 1)).toBe(true);
    expect(dm.hasTreaty(0, 1, 'open_borders')).toBe(true);
    expect(dm.getActiveTreaties(0, 1)).toContain('open_borders');
    expect(dm.getAllies(0)).toContain(1);
    // Teammates are not enemies even if an old relation said so.
    expect(dm.getEnemies(0)).not.toContain(1);
  });

  it('refuses war between teammates', () => {
    const { diplomacyManager: dm } = makeTeamEngine(3, [0, 0, 1]);
    dm.declareWar(0, 1);
    expect(dm.getStatus(0, 1)).toBe('alliance');
    expect(dm.isAtWar(0, 1)).toBe(false);
  });

  it('expands a declaration across both teams', () => {
    const { diplomacyManager: dm } = makeTeamEngine(4, [0, 0, 1, 1]);

    dm.declareWar(0, 2);

    // Every cross-team pair is at war: 0-2, 0-3, 1-2, 1-3.
    expect(dm.getStatus(0, 2)).toBe('war');
    expect(dm.getStatus(0, 3)).toBe('war');
    expect(dm.getStatus(1, 2)).toBe('war');
    expect(dm.getStatus(1, 3)).toBe('war');
    // Inside each team the lock still holds.
    expect(dm.getStatus(0, 1)).toBe('alliance');
    expect(dm.getStatus(2, 3)).toBe('alliance');
    expect(dm.getEnemyTeamCount(0)).toBe(1);
  });

  it('counts a coalition as one war front', () => {
    const { diplomacyManager: dm } = makeTeamEngine(6, [0, 0, 1, 1, 2, 2]);

    dm.declareWar(0, 2);
    expect(dm.getEnemies(0).sort()).toEqual([2, 3]);
    expect(dm.getEnemyTeamCount(0)).toBe(1);

    dm.declareWar(0, 4);
    expect(dm.getEnemyTeamCount(0)).toBe(2);
  });

  it('makes peace and ceasefire team-wide', () => {
    const { diplomacyManager: dm } = makeTeamEngine(4, [0, 0, 1, 1]);

    dm.declareWar(0, 2);
    dm.signCeasefire(0, 2);
    expect(dm.getStatus(0, 2)).toBe('ceasefire');
    expect(dm.getStatus(0, 3)).toBe('ceasefire');
    expect(dm.getStatus(1, 2)).toBe('ceasefire');
    expect(dm.getStatus(1, 3)).toBe('ceasefire');

    dm.makePeace(0, 2);
    expect(dm.getStatus(0, 2)).toBe('peace');
    expect(dm.getStatus(0, 3)).toBe('peace');
    expect(dm.getStatus(1, 2)).toBe('peace');
    expect(dm.getStatus(1, 3)).toBe('peace');
    expect(dm.getStatus(0, 1)).toBe('alliance');
  });

  it('sums team strength rather than one member strength', () => {
    const engine = makeTeamEngine(4, [0, 0, 1, 1]);
    engine.units = [
      { id: 'a', civilizationId: 0, attack: 10, defense: 10 },
      { id: 'b', civilizationId: 1, attack: 10, defense: 10 },
      { id: 'c', civilizationId: 2, attack: 5, defense: 5 },
    ];
    const dm = engine.diplomacyManager;

    expect(dm.estimateTeamStrength(0)).toBeGreaterThan(dm.estimateMilitaryStrength(0));
    expect(dm.estimateTeamStrength(0)).toBe(
      dm.estimateMilitaryStrength(0) + dm.estimateMilitaryStrength(1),
    );
  });

  it('repairs a stale teammate war when invariants are reapplied', () => {
    const { diplomacyManager: dm } = makeTeamEngine(3, [0, 0, 1]);
    const rel = dm.getRelation(0, 1)!;
    rel.status = 'war';
    rel.activeTreaties = ['open_borders', 'mutual_defense'];

    dm.applyTeamInvariants();

    expect(rel.status).toBe('alliance');
    expect(rel.activeTreaties).toContain('open_borders');
    expect(rel.activeTreaties).not.toContain('mutual_defense');
    expect(dm.hasEmbassy(0, 1)).toBe(true);
  });
});

describe('AI policy and diplomat menus with teammates', () => {
  function context(over: Partial<PolicyContext> = {}): PolicyContext {
    return {
      civId: 0,
      otherId: 1,
      weights: diplomaticWeights({ id: 0, personality: { aggression: 9, diplomacy: 2, military: 9, expansion: 6, science: 3, economy: 4 } }),
      opinion: createOpinion(),
      status: 'alliance',
      treaties: [],
      ownStrength: 100,
      theirStrength: 20,
      ownGold: 300,
      activeWars: 0,
      maxWars: 3,
      exhaustion: 0,
      turnsSince: 30,
      roundsSincePeace: Infinity,
      sharedEnemy: false,
      round: 20,
      sequence: 1,
      teammate: true,
      ...over,
    };
  }

  it('never scores a hostile or redundant action against a teammate', () => {
    // An alliance policy normally offers only betrayal. Every one of those
    // candidates is filtered out for a locked teammate, so nothing is left.
    const allianceActions = scoreCandidates(context()).map((candidate) => candidate.action);
    expect(allianceActions).not.toContain('break_alliance');
    expect(allianceActions).toEqual([]);

    // Trade is still allowed: the lock forbids betrayal, not commerce. A
    // peace-time candidate list keeps its trade offer while every pact that
    // the team lock already guarantees disappears.
    const peaceActions = scoreCandidates(context({ status: 'peace' }))
      .map((candidate) => candidate.action);
    expect(peaceActions).toContain('propose_trade_agreement');
    for (const forbidden of [
      'declare_war',
      'break_alliance',
      'demand_tribute',
      'propose_alliance',
      'offer_open_borders',
      'propose_non_aggression',
      'propose_mutual_defense',
      'establish_embassy',
    ]) {
      expect(peaceActions).not.toContain(forbidden);
    }
  });

  it('leaves a non-teammate policy untouched', () => {
    const actions = scoreCandidates(context({ teammate: false })).map((candidate) => candidate.action);
    // An ordinary alliance still has the option to betray it.
    expect(actions).toContain('break_alliance');
  });

  it('offers a teammate only trade, gold and knowledge', () => {
    const actions = diplomatActionsFor({
      kind: 'city',
      status: 'alliance',
      hasEmbassy: true,
      activeTreaties: ['open_borders'],
      canTradeTechs: true,
      hasDiplomatContact: true,
      techsWeCanOffer: 2,
      techsWeWant: 1,
      embargoCandidates: [2],
      jointWarCandidates: [2],
      isTeammate: true,
    });

    expect(actions).toEqual(expect.arrayContaining([
      'propose_trade_agreement',
      'offer_tech_exchange',
      'gift_technology',
      'gift_gold',
      'request_gold',
    ]));
    for (const forbidden of [
      'demand_tribute',
      'gather_intelligence',
      'propose_alliance',
      'propose_joint_war',
      'propose_embargo',
      'establish_embassy',
    ]) {
      expect(actions).not.toContain(forbidden);
    }
  });
});
