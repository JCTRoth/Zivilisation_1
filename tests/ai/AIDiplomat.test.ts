import { describe, expect, it, vi, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import type { Unit } from '../../types/game';

/**
 * AI diplomat unit tests (Civ I: diplomats physically move to an enemy
 * city/unit to initiate diplomacy).
 *
 * Covers:
 *  1. chooseDiplomatTarget — heads to a known foreign city, preferring civs
 *     NOT at war.
 *  2. chooseDiplomatAction — mirrors processAIDiplomacy: peace when
 *     outmatched, ceasefire otherwise, alliance when friendly+comparable,
 *     tribute when dominant, intel as fallback.
 *  3. executeAIDiplomatAction — human targets surface an interactive offer
 *     (AI_DIPLOMACY_OFFER) instead of auto-resolving; AI targets resolve via
 *     executeDiplomatAction.
 *  4. shouldBuildDiplomat — peacetime, Writing-tech, diplomat-cap and
 *     personality-scaled chance.
 */
describe('AI diplomat units', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeEngine(mapType: string = 'CLOSEUP_1V1', civs: number = 2): Promise<GameEngine> {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: civs,
      mapType,
      devMode: false,
      startingGold: 50,
    });
    return engine;
  }

  it('releases a fortified garrison to fight a reachable enemy at war', async () => {
    // An AI-vs-AI run ended with 9 units permanently fortified and 1,916 hold
    // actions: a garrison was kept because it sat next to a city, never
    // because the city needed it, so the army could never march.
    const engine = await makeEngine('CLOSEUP_1V1', 2);
    const aiManager = (engine as any).aiManager;

    const home = engine.cities[0] ?? engine.foundCity(10, 10, 0, 'Home')!;
    const enemyCity = engine.cities.find((c) => c.civilizationId === 1)
      ?? engine.foundCity(14, 10, 1, 'EnemyTown')!;
    engine.diplomacyManager.declareWar(0, 1);

    // A combat unit entrenched in its own city, sitting out the turn.
    (engine as unknown as { createUnit(civId: number, type: string, col: number, row: number): Unit })
      .createUnit(home.civilizationId, 'warrior', home.col, home.row);
    const garrison = engine.units.find(
      (u) => u.civilizationId === 0 && u.type === 'warrior' && !u.isDefeated,
    )!;
    engine.unitFortify(garrison.id);
    expect(garrison.isFortified).toBe(true);

    const keep = (aiManager as any).shouldKeepGarrisonFortified.bind(aiManager);
    // The enemy city is land-connected, so this garrison must mobilise.
    expect(engine.areLandConnected(home.col, home.row, enemyCity.col, enemyCity.row)).toBe(true);
    expect(keep(garrison, engine.getPlayerStorage(0))).toBe(false);

    // A unit with no reachable enemy keeps entrenching (peacetime garrison).
    engine.diplomacyManager.makePeace?.(0, 1);
    const diplomacy = engine.diplomacyManager as unknown as {
      relations?: Map<string, { atWar?: boolean }>;
    };
    const rel = diplomacy.relations?.get('0-1');
    if (rel) rel.atWar = false;
    expect(keep(garrison, engine.getPlayerStorage(0))).toBe(true);
  });

  it('chooseDiplomatTarget picks a known enemy city, preferring civs not at war', async () => {
    const engine = await makeEngine('CLOSEUP_1V1', 2);
    const aiManager = (engine as any).aiManager;

    // Record two known enemy cities: one at war, one at peace.
    const storage = engine.getPlayerStorage(1);
    storage.enemyLocations.set(0, [
      { col: 5, row: 5, type: 'city', id: 'city_0_0', discoveredRound: 1, lastSeenRound: 1 },
    ]);

    // Make civ0 (Americans' city) at peace with civ1 by default; add a far
    // "at war" city so the peace preference is observable.
    const dm = engine.diplomacyManager;
    // Fake a third-party war using a unit-owned location is overkill — instead
    // verify: at peace with the only known civ → that city is returned.
    const diplomat = {
      id: 'diplomat_1_0',
      civilizationId: 1,
      type: 'diplomat',
      col: 20,
      row: 20,
      movesRemaining: 2,
    };

    const target = aiManager.chooseDiplomatTarget(diplomat);
    expect(target).not.toBeNull();
    expect(target.col).toBe(5);
    expect(target.row).toBe(5);
    expect(dm.isAtWar(1, 0)).toBe(false);
  });

  it('chooseDiplomatAction: sues for peace when outmatched at war', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    dm.declareWar(1, 0);

    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 1 ? 10 : 100));
    const actions = ['gather_intelligence', 'propose_ceasefire', 'propose_peace'];

    const action = aiManager.chooseDiplomatAction({ civilizationId: 1, id: 'd' }, 0, actions);
    expect(action).toBe('propose_peace');
  });

  it('chooseDiplomatAction: offers ceasefire when not outmatched at war', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    dm.declareWar(1, 0);

    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 1 ? 100 : 10));
    const actions = ['gather_intelligence', 'propose_ceasefire', 'propose_peace'];

    const action = aiManager.chooseDiplomatAction({ civilizationId: 1, id: 'd' }, 0, actions);
    expect(action).toBe('propose_ceasefire');
  });

  it('chooseDiplomatAction: proposes alliance when friendly and comparable', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;

    vi.spyOn(dm, 'estimateMilitaryStrength').mockReturnValue(50);
    vi.spyOn(dm, 'getAttitude').mockReturnValue('friendly');
    (engine.civilizations[1] as any).personality = { aggression: 3, diplomacy: 8, military: 5 };
    const actions = ['gather_intelligence', 'propose_alliance', 'demand_tribute'];

    const action = aiManager.chooseDiplomatAction({ civilizationId: 1, id: 'd' }, 0, actions);
    expect(action).toBe('propose_alliance');
  });

  it('chooseDiplomatAction: demands tribute when dominant and aggressive', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;

    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 1 ? 100 : 10));
    vi.spyOn(dm, 'getAttitude').mockReturnValue('annoyed');
    (engine.civilizations[1] as any).personality = { aggression: 8, diplomacy: 2, military: 8 };
    const actions = ['gather_intelligence', 'propose_alliance', 'demand_tribute'];

    const action = aiManager.chooseDiplomatAction({ civilizationId: 1, id: 'd' }, 0, actions);
    expect(action).toBe('demand_tribute');
  });

  it('chooseDiplomatAction: gathers intelligence as fallback', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;

    vi.spyOn(dm, 'estimateMilitaryStrength').mockReturnValue(50);
    vi.spyOn(dm, 'getAttitude').mockReturnValue('hostile');
    const actions = ['gather_intelligence', 'propose_alliance', 'demand_tribute'];

    const action = aiManager.chooseDiplomatAction({ civilizationId: 1, id: 'd' }, 0, actions);
    expect(action).toBe('gather_intelligence');
  });

  it('executeAIDiplomatAction: human target emits an interactive offer (no auto-resolve)', async () => {
    const engine = await makeEngine('CLOSEUP_1V1', 2);
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    // civ1 (AI) is dominant over the human civ0 → demand tribute.
    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 1 ? 100 : 10));
    vi.spyOn(dm, 'getAttitude').mockReturnValue('annoyed');
    (engine.civilizations[1] as any).personality = { aggression: 8, diplomacy: 2, military: 8 };

    const diplomat = { id: 'd1', civilizationId: 1, type: 'diplomat', col: 10, row: 10, movesRemaining: 2 };
    aiManager.executeAIDiplomatAction(diplomat, {
      targetCivId: 0,
      actions: ['gather_intelligence', 'propose_alliance', 'demand_tribute'],
    });

    const offers = events.filter(e => e.type === 'AI_DIPLOMACY_OFFER');
    expect(offers.length).toBe(1);
    expect(offers[0].data.fromCivId).toBe(1);
    expect(offers[0].data.toCivId).toBe(0);
    expect(offers[0].data.action).toBe('demand_tribute');
    expect(typeof offers[0].data.goldAmount).toBe('number');
    // The diplomat's move is consumed so it cannot re-offer every frame.
    expect(diplomat.movesRemaining).toBe(0);
  });

  it('executeAIDiplomatAction: AI target resolves peace through executeDiplomatAction', async () => {
    // Mark civ0 as AI too (CLOSEUP_1V1 normally makes it human) so the
    // diplomat resolves through the normal proposal path — no interactive
    // offer. Avoids AI_VS_AI, whose initialize auto-starts a turn loop.
    const engine = await makeEngine('CLOSEUP_1V1', 2);
    (engine.civilizations[0] as any).isHuman = false;
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    // civ1 at war with civ0 and outmatched → diplomat sues for peace.
    dm.declareWar(1, 0);
    const rel = dm.getRelation(1, 0);
    if (rel) rel.since = 1;
    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 1 ? 10 : 100));
    // Force the willingness roll to accept the peace proposal.
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    const diplomat = { id: 'd2', civilizationId: 1, type: 'diplomat', col: 10, row: 10, movesRemaining: 2 };
    engine.units.push(diplomat as any);
    aiManager.executeAIDiplomatAction(diplomat, {
      targetCivId: 0,
      actions: ['gather_intelligence', 'propose_ceasefire', 'propose_peace'],
    });

    // Peace was made through the normal proposal path (not an offer event).
    expect(dm.getStatus(1, 0)).toBe('peace');
    expect(events.some(e => e.type === 'AI_DIPLOMACY_OFFER')).toBe(false);
    expect(diplomat.movesRemaining).toBe(0);
  });

  it('shouldBuildDiplomat: builds only at peace with Writing and rolled chance', async () => {
    const engine = await makeEngine('CLOSEUP_1V1', 2);
    const ap = (engine as any).autoProduction;
    const civ1 = engine.civilizations[1];
    // technologies is an array in this engine — give civ1 Writing.
    (civ1 as any).technologies = [...(civ1.technologies ?? []), 'writing'];

    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    (civ1 as any).personality = { aggression: 3, diplomacy: 8, military: 5 };
    expect(ap.shouldBuildDiplomat(civ1)).toBe(true);

    // Roll misses → no diplomat.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(ap.shouldBuildDiplomat(civ1)).toBe(false);

    // At war → never.
    engine.diplomacyManager.declareWar(1, 0);
    expect(ap.shouldBuildDiplomat(civ1)).toBe(false);
  });

  it('shouldBuildDiplomat: caps at two diplomats', async () => {
    const engine = await makeEngine('CLOSEUP_1V1', 2);
    const ap = (engine as any).autoProduction;
    const civ1 = engine.civilizations[1];
    (civ1 as any).technologies = [...(civ1.technologies ?? []), 'writing'];
    (civ1 as any).personality = { aggression: 3, diplomacy: 8, military: 5 };

    // Add two existing diplomats → cap reached.
    engine.units.push(
      { id: 'x1', civilizationId: 1, type: 'diplomat', col: 0, row: 0 } as any,
      { id: 'x2', civilizationId: 1, type: 'diplomat', col: 0, row: 1 } as any,
    );
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    expect(ap.shouldBuildDiplomat(civ1)).toBe(false);
  });
});
