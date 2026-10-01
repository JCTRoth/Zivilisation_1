import { describe, expect, it, vi, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/**
 * Diplomacy module (Civ I–style) regression tests for the interactive-offer
 * and alliance-collapse work:
 *
 *  1. AI-initiated proposals to the HUMAN are no longer auto-resolved — they
 *     are surfaced as AI_DIPLOMACY_OFFER events and the player decides via the
 *     negotiation screen (acceptOffer executes; rejecting leaves state alone).
 *  2. Alliances can collapse: a hostile attitude can push the AI to break the
 *     pact and declare war (ALLIANCE_BROKEN + WAR_DECLARED, with the reputation
 *     penalty applied by declareWar).
 *
 * civ0 is the human (CLOSEUP_1V1), civ1 is the AI.
 */
describe('Diplomacy: interactive AI offers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acceptOffer forms an alliance (player accepts propose_alliance)', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    const dm = engine.diplomacyManager;

    const res = dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'propose_alliance' });
    expect(res.accepted).toBe(true);
    expect(dm.getStatus(0, 1)).toBe('alliance');
  });

  it('acceptOffer transfers gold when the player pays an AI tribute demand', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    const dm = engine.diplomacyManager;
    const goldBefore = engine.civilizations[0].resources.gold;
    const aiGoldBefore = engine.civilizations[1].resources.gold;

    const res = dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'demand_tribute', goldAmount: 30 });
    expect(res.accepted).toBe(true);
    expect(res.goldTransferred).toBe(30);
    expect(engine.civilizations[0].resources.gold).toBe(goldBefore - 30);
    expect(engine.civilizations[1].resources.gold).toBe(aiGoldBefore + 30);
  });

  it('acceptOffer makes peace when the player accepts during a war', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    const dm = engine.diplomacyManager;
    dm.declareWar(1, 0);
    expect(dm.getStatus(0, 1)).toBe('war');

    const res = dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'propose_peace' });
    expect(res.accepted).toBe(true);
    expect(dm.getStatus(0, 1)).toBe('peace');
  });

  it('AI proposal to the human emits AI_DIPLOMACY_OFFER instead of auto-resolving', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    // Long war so the AI sues for peace (turnsSince = 20 - 1 = 19 > 15).
    dm.declareWar(1, 0);
    const rel = dm.getRelation(1, 0);
    if (rel) rel.since = 1;

    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 1 ? 100 : 10));
    (engine as any).roundManager.getRoundNumber = () => 20;

    // A 19-turn war has left the AI worn down, which is what turns a winning
    // side into one willing to negotiate. The policy scores this rather than
    // rolling for it, so the outcome is deterministic.
    dm.getWarExhaustion(1);
    dm.processTurn(19);

    dm.processAIDiplomacy(1);

    const offers = events.filter(e => e.type === 'AI_DIPLOMACY_OFFER');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].data.fromCivId).toBe(1);
    expect(offers[0].data.action).toBe('propose_peace');
    // The proposal must NOT have been auto-resolved while pending.
    expect(dm.getStatus(0, 1)).toBe('war');
  });
});

describe('Diplomacy: alliances can collapse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AI breaks a hostile alliance and declares war (ALLIANCE_BROKEN)', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    dm.formAlliance(1, 0);
    const rel = dm.getRelation(1, 0);
    if (rel) rel.since = 1;

    vi.spyOn(dm, 'estimateMilitaryStrength').mockReturnValue(50);
    (engine as any).roundManager.getRoundNumber = () => 20;

    // The AI has come to fear its partner — the reason an alliance turns. Fear
    // is a stored meter, so this is set directly rather than by mocking a
    // function the policy no longer consults.
    dm.getOpinion(1, 0).fear = 80;
    dm.getOpinion(1, 0).grievance = 40;

    dm.processAIDiplomacy(1);

    expect(dm.getStatus(0, 1)).toBe('war');
    expect(events.some(e => e.type === 'ALLIANCE_BROKEN')).toBe(true);
    expect(events.some(e => e.type === 'WAR_DECLARED')).toBe(true);
    // Breaking an alliance costs the betrayed side real goodwill.
    expect(dm.getAttitudeScore(0, 1)).toBeLessThan(0);
  });

  it('a warlike leader outgrows a long-standing alliance', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    dm.formAlliance(1, 0);
    const rel = dm.getRelation(1, 0);
    if (rel) rel.since = 1;

    // Make civ1 an aggressive leader.
    const civ1 = engine.civilizations[1];
    (civ1 as any).personality = { aggression: 8, diplomacy: 4, military: 8 };
    (civ1 as any).productionProfile = 'military_expansion';

    vi.spyOn(dm, 'estimateMilitaryStrength').mockReturnValue(50);
    (engine as any).roundManager.getRoundNumber = () => 25; // turnsSince = 24 > 20

    dm.processAIDiplomacy(1);

    expect(dm.getStatus(0, 1)).toBe('war');
    expect(events.some(e => e.type === 'ALLIANCE_BROKEN')).toBe(true);
  });

  // The two tests above and below are the same pair, same turn count, differing
  // only in personality. Under the old coin-flip model they were arbitrary; the
  // point of the rewrite is that they are now guaranteed to differ.
  it('a diplomatic leader keeps the same long alliance', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
    });
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    dm.formAlliance(1, 0);
    const rel = dm.getRelation(1, 0);
    if (rel) rel.since = 1;

    // Same shape as the warlike case above, but a diplomatic leader: low
    // warmongering and high loyalty keep the pact.
    const civ1 = engine.civilizations[1];
    (civ1 as any).personality = { aggression: 2, diplomacy: 9, military: 3, economy: 5 };
    (civ1 as any).productionProfile = 'science_focus';

    vi.spyOn(dm, 'estimateMilitaryStrength').mockReturnValue(50);
    (engine as any).roundManager.getRoundNumber = () => 25;

    dm.processAIDiplomacy(1);

    expect(dm.getStatus(0, 1)).toBe('alliance');
    expect(events.some(e => e.type === 'ALLIANCE_BROKEN')).toBe(false);
  });
});
