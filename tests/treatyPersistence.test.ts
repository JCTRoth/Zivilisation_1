import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { scoreCandidates } from '@/game/engine/diplomacy/AIDiplomacyPolicy';

/**
 * A treaty between two nations STAYS in place until one side breaks it.
 *
 *  1. The policy never tables a pact already in force — the teammate's
 *     "Trade Agreement" dispatch used to re-ask forever after signing.
 *  2. The signed pact survives rounds of AI diplomacy (no expiry, no re-ask).
 *  3. War IS the break: every treaty but the embassy falls, with the
 *     `treaty_cancelled` entry on both ledgers.
 */
describe('Treaties — in place until broken', () => {
  const newEngine = async (opts: Record<string, unknown> = {}) => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      // Three seats: fixed alliances need at least two teams, and a team
      // needs at least two members — the minimum team game is [0, 0, 1].
      numberOfCivilizations: 3,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
      ...opts,
    });
    return engine;
  };

  it('the policy tables a trade agreement only while it is NOT signed', async () => {
    const engine = await newEngine();
    const dm = engine.diplomacyManager;
    const ctx = dm.policyContextFor(0, 1);
    expect(ctx, 'a met pair has a policy context').toBeTruthy();

    // Unsigned: the trade agreement is a live candidate.
    expect(
      scoreCandidates(ctx!).some((c) => c.action === 'propose_trade_agreement'),
    ).toBe(true);

    // Signed — the player's yes, the same path the audience button takes.
    expect(
      dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'propose_trade_agreement' }).accepted,
    ).toBe(true);
    expect(dm.hasTreaty(0, 1, 'trade_agreement')).toBe(true);

    // Settled: the candidate is gone — the pact just stays in place.
    const after = scoreCandidates(dm.policyContextFor(0, 1)!);
    expect(after.some((c) => c.action === 'propose_trade_agreement')).toBe(false);
    // Only THAT pact is settled; the others are still on the table.
    expect(after.some((c) => c.action === 'offer_open_borders')).toBe(true);
    expect(after.some((c) => c.action === 'propose_non_aggression')).toBe(true);
  });

  it("a teammate stops dispatching 'Trade Agreement' once it is signed", async () => {
    // The reported scenario: a locked teammate proposing the same pact
    // round after round, because their block pushed it unconditionally.
    const engine = await newEngine({ fixedAlliances: true, teamAssignments: [0, 0, 1] });
    expect(engine.teamManager?.isTeammate(0, 1)).toBe(true);
    const dm = engine.diplomacyManager;

    // Before: the team block tables it ('teammate trade routes pay double').
    expect(
      scoreCandidates(dm.policyContextFor(0, 1)!).some((c) => c.action === 'propose_trade_agreement'),
    ).toBe(true);

    expect(
      dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'propose_trade_agreement' }).accepted,
    ).toBe(true);

    // After: the dispatch never comes back.
    expect(
      scoreCandidates(dm.policyContextFor(0, 1)!).some((c) => c.action === 'propose_trade_agreement'),
    ).toBe(false);
  });

  it('the signed pact survives rounds of AI diplomacy without being re-asked', async () => {
    const engine = await newEngine();
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    engine.onStateChange = (type: string, data?: any) => events.push({ type, data: data ?? {} });

    expect(
      dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'propose_trade_agreement' }).accepted,
    ).toBe(true);

    for (let r = 1; r <= 20; r++) dm.processAIDiplomacy(1);

    expect(dm.hasTreaty(0, 1, 'trade_agreement'), 'no expiry, no drift').toBe(true);
    const reasks = events.filter(
      (e) => e.type === 'AI_DIPLOMACY_OFFER' && (e.data as any)?.action === 'propose_trade_agreement',
    );
    expect(reasks, 'the treaty was never re-asked').toHaveLength(0);
  });

  it('war breaks every pact but the embassy — one side broke it', async () => {
    const engine = await newEngine();
    const dm = engine.diplomacyManager;
    expect(
      dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'propose_trade_agreement' }).accepted,
    ).toBe(true);
    expect(dm.acceptOffer({ fromCivId: 1, toCivId: 0, action: 'offer_open_borders' }).accepted).toBe(true);
    dm.establishEmbassy(0, 1);
    expect(dm.hasEmbassy(0, 1)).toBe(true);

    dm.declareWar(1, 0); // one side breaks the peace

    expect(dm.getStatus(0, 1)).toBe('war');
    expect(dm.hasTreaty(0, 1, 'trade_agreement'), 'the trade pact fell with the peace').toBe(false);
    expect(dm.hasTreaty(0, 1, 'open_borders')).toBe(false);
    expect(dm.hasEmbassy(0, 1), 'the embassy outlives the war').toBe(true);
    // Both ledgers note the break — cancelTreaty records goodwill -6 each way.
    const cancelled = dm.getEventLog().filter((e) => e.type === 'treaty_cancelled');
    expect(cancelled.length).toBeGreaterThanOrEqual(2);
  });
});
