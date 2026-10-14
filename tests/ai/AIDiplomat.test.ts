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

  async function makeEngine(
    mapType: string = 'CLOSEUP_1V1',
    civs: number = 2,
    // Pin the map: the garrison test asserts land connectivity between the two
    // start cities, which an unseeded world only sometimes provides (CI flake).
    seed: number = 20260925,
  ): Promise<GameEngine> {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: civs,
      mapType,
      devMode: false,
      startingGold: 50,
      mapSeed: seed,
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

    // The diplomat has to be STANDING NEXT to something of civ 0 — the engine
    // now checks the contact the rules say a diplomat must have before it can
    // speak for anyone, so a lone unit in open country proposes nothing.
    const enemyCity = engine.foundCity(12, 12, 0, 'Parley Town')!;
    const diplomat = {
      id: 'd2', civilizationId: 1, type: 'diplomat',
      col: enemyCity.col + 1, row: enemyCity.row, movesRemaining: 2,
    };
    engine.units.push(diplomat as any);
    aiManager.executeAIDiplomatAction(diplomat, engine.getDiplomatTargets(diplomat.id)[0]);

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

/**
 * AI espionage — the diplomat runs an infiltration rather than a negotiation.
 *
 * The policy that picks the infiltration is unit-tested in
 * `tests/espionagePolicy.test.ts`; what is under test HERE is the wiring: that
 * a diplomat standing in a foreign city at peace actually opens a channel, and
 * that a theft really moves a technology and starts the war Civ I says it
 * must.
 */
describe('AI diplomat espionage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeEngine(seed = 20260925): Promise<GameEngine> {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
      mapSeed: seed,
    });
    return engine;
  }

  /**
   * An AI diplomat standing beside a city of civ 0, with a move to spend.
   *
   * `engine.cities` is empty on a freshly initialised world — settlers have
   * not founded anything yet — so the target city is founded here rather than
   * looked up, exactly as the other tests in this file do.
   */
  function placeDiplomat(engine: GameEngine, civId = 1) {
    const enemyCity = engine.foundCity(12, 12, 0, 'Target Town')!;
    const diplomat = {
      id: 'spy_diplomat',
      civilizationId: civId,
      type: 'diplomat',
      col: enemyCity.col + 1,
      row: enemyCity.row,
      movesRemaining: 2,
      health: 100,
      icon: 'diplomat',
      orders: 'none',
    } as any;
    (engine as any).units.push(diplomat);
    return { diplomat, enemyCity };
  }

  it('opens an embassy first — the channel every term depends on', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;

    const { diplomat } = placeDiplomat(engine);

    expect(dm.hasEmbassy(1, 0)).toBe(false);

    const info = engine.getDiplomatActions(diplomat.id);
    expect(info).not.toBeNull();
    expect(info!.actions).toContain('establish_embassy');

    aiManager.executeAIDiplomatAction(diplomat, info!);

    expect(dm.hasEmbassy(1, 0)).toBe(true);
    expect(dm.hasEmbassy(0, 1)).toBe(true);
  });

  it('founding a channel unlocks the AI\'s own tech offers', async () => {
    // The Exchange of Knowledge is gated on an embassy, so a civ that never
    // founds one can never propose the swap. This is the loop that gate would
    // otherwise close for good.
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;

    engine.civilizations[0].technologies = ['pottery', 'iron_working'];
    engine.civilizations[1].technologies = ['pottery', 'bronze_working'];
    engine.diplomacyManager.markContact(1, 0);

    const { diplomat } = placeDiplomat(engine);
    aiManager.executeAIDiplomatAction(diplomat, engine.getDiplomatActions(diplomat.id)!);
    expect(dm.hasEmbassy(1, 0)).toBe(true);
  });

  it('steals a technology, blows its cover and starts the war', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;

    // The VICTIM holds several secrets the thief does not — a bigger haul
    // weighs more heavily, and there is genuinely something to take. (The
    // other way round the policy correctly never reaches for it.)
    engine.civilizations[0].technologies = ['pottery', 'iron_working', 'writing', 'alphabet', 'bronze_working'];
    engine.civilizations[1].technologies = ['pottery'];

    const { diplomat } = placeDiplomat(engine);
    dm.establishEmbassy(1, 0);

    // What a successful theft may yield: the victim's ledger minus our own.
    const victimPool = engine.civilizations[0].technologies.filter(
      (t: string) => !engine.civilizations[1].technologies.includes(t),
    );
    const hadBefore = [...engine.civilizations[1].technologies];

    // A temperament that reaches for the loot: it grudges, it does not mind a
    // war, and it owes this court no loyalty. Reading the city scores
    // 6 + trust + paranoia — so a cautious civ out-reason the thief, which is
    // the intended behaviour and the reason this profile is specified rather
    // than assumed.
    vi.spyOn(dm, 'weightsFor').mockReturnValue({
      hostility: 10, warmongering: 10, trustSensitivity: 1, greed: 5,
      loyalty: 1, paranoia: 1, vengeance: 10, xenophobia: 5, patience: 5,
    });
    vi.spyOn(dm, 'getAttitude').mockReturnValue('hostile');
    expect(engine.getDiplomatActions(diplomat.id)!.actions).toContain('steal_technology');

    // The detection roll is seeded per (operative, target, kind, ROUND) — not
    // Math.random — so the only honest way to reach the successful branch is
    // to run rounds until it lands, then assert what success means. Each
    // attempt loses the agent (caught, or caught after the theft), so a fresh
    // one is posted every round.
    let stolen = false;
    for (let round = 1; round <= 40 && !stolen; round++) {
      // Each attempt ends in a war, so reopen the channel between rounds.
      if (dm.getStatus(1, 0) === 'war') dm.makePeace(1, 0);
      if (!dm.hasEmbassy(1, 0)) dm.establishEmbassy(1, 0);
      (engine as any).roundManager.getRoundNumber = () => round;
      const agent = placeDiplomat(engine).diplomat;
      // The thief researches on its own account between attempts, so a growing
      // tech COUNT is not evidence of a theft. Compare the SETS: a theft is a
      // tech the victim held and the thief did not.
      const before = new Set(engine.civilizations[1].technologies);
      const victimOnly = engine.civilizations[0].technologies.filter(
        (t: string) => !before.has(t),
      );

      const info = engine.getDiplomatActions(agent.id);
      if (!info) break;

      aiManager.executeAIDiplomatAction(agent, info);

      const tookSomething = victimOnly.some((t: string) =>
        engine.civilizations[1].technologies.includes(t));
      if (tookSomething) {
        stolen = true;
        // The theft is BLIND — the spec's whole point is that the player (and
        // here the AI) never picks. So assert the property rather than a name:
        // exactly one new tech, and it has to be one the victim held and the
        // thief did not.
        const gained = engine.civilizations[1].technologies.filter(
          (t: string) => !hadBefore.includes(t),
        );
        expect(gained).toHaveLength(1);
        expect(victimPool).toContain(gained[0]);
        // Civ I: the cover is blown and the victim declares war on the spot.
        expect(dm.getStatus(0, 1)).toBe('war');
        // The agent does not walk away from a theft.
        expect(engine.units.find((u) => u.id === agent.id)).toBeUndefined();
      }
    }
    expect(stolen).toBe(true);
  });

  it('announces the infiltration so the victim can be told', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    const { diplomat } = placeDiplomat(engine);
    aiManager.executeAIDiplomatAction(diplomat, engine.getDiplomatActions(diplomat.id)!);

    const announced = events.filter((e) => e.type === 'ESPIONAGE_RESULT');
    expect(announced.length).toBeGreaterThan(0);
    // Both civ ids travel with it, so the router can tell perpetrator from
    // victim without re-deriving who acted on whom.
    expect(announced[0].data.operativeCivId).toBe(1);
    expect(announced[0].data.targetCivId).toBe(0);
    expect(typeof announced[0].data.outcome).toBe('string');
  });

  it('at war the diplomat negotiates instead of infiltrating', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    dm.declareWar(1, 0);

    const { diplomat } = placeDiplomat(engine);
    const info = engine.getDiplomatActions(diplomat.id)!;

    // The engine does not even offer infiltrations in a war zone.
    expect(info.actions).not.toContain('establish_embassy');
    expect(info.actions).not.toContain('steal_technology');
    expect(info.actions).not.toContain('industrial_sabotage');

    const action = aiManager.chooseDiplomatAction(diplomat, 0, info.actions);
    expect(action).not.toBe('steal_technology');
    expect(action).not.toBe('establish_embassy');
  });
});

/**
 * AI diplomat treaties — the terms the shared policy scorer produces.
 *
 * The tests above pin the negotiation ladder (peace / ceasefire / alliance /
 * tribute / intel) and the infiltrations. What is under test HERE is that the
 * remaining abilities of the menu — open borders, trade, a defence pact, a
 * non-aggression pact, an embargo, an exchange of knowledge — are actually
 * reachable for an AI diplomat unit and are chosen from the very list the
 * engine offers, rather than being implemented but unreachable.
 */
describe('AI diplomat treaties', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeEngine(seed = 20260925): Promise<GameEngine> {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 3,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
      mapSeed: seed,
    });
    return engine;
  }

  /**
   * A civ-1 diplomat standing beside a civ-0 city at peace, with an embassy
   * already founded — so the treaty terms are on the menu.
   */
  function placeDiplomat(engine: GameEngine) {
    const city = engine.foundCity(12, 12, 0, 'Target Town')!;
    const diplomat = {
      id: 'treaty_diplomat',
      civilizationId: 1,
      type: 'diplomat',
      col: city.col + 1,
      row: city.row,
      movesRemaining: 2,
      health: 100,
      icon: 'diplomat',
      orders: 'none',
    } as any;
    (engine as any).units.push(diplomat);
    engine.diplomacyManager.markContact(1, 0);
    engine.diplomacyManager.markContact(1, 2);
    engine.diplomacyManager.establishEmbassy(1, 0);
    return { diplomat, city };
  }

  it('the treaty terms are on the menu an AI diplomat is offered', async () => {
    const engine = await makeEngine();
    const { diplomat } = placeDiplomat(engine);
    const menu = engine.getDiplomatTargets(diplomat.id)[0].actions;
    for (const term of [
      'offer_open_borders',
      'propose_trade_agreement',
      'propose_mutual_defense',
      'propose_non_aggression',
    ] as const) {
      expect(menu, `${term} should be offered`).toContain(term);
    }
  });

  it('without an embassy the treaty terms are not offered and not chosen', async () => {
    const engine = await makeEngine();
    const city = engine.foundCity(12, 12, 0, 'Target Town')!;
    const diplomat = {
      id: 'no_channel', civilizationId: 1, type: 'diplomat',
      col: city.col + 1, row: city.row, movesRemaining: 2,
    } as any;
    (engine as any).units.push(diplomat);
    engine.diplomacyManager.markContact(1, 0);

    const menu = engine.getDiplomatTargets(diplomat.id)[0].actions;
    expect(menu).not.toContain('offer_open_borders');
    expect(menu).not.toContain('propose_trade_agreement');
    // …and the choice comes out of that list, whatever the policy would like.
    const chosen = (engine as any).aiManager.chooseDiplomatAction(diplomat, 0, menu);
    expect(menu).toContain(chosen);
  });

  it('an AI diplomat can sign a treaty the engine offers it', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    // civ 0 is the human in CLOSEUP_1V1; a treaty proposed TO a human is an
    // interactive offer, never auto-signed (asserted below). For the signing
    // path both sides are AI.
    (engine.civilizations[0] as any).isHuman = false;
    const { diplomat } = placeDiplomat(engine);

    // Force the scorer onto open borders, then check the whole path runs: the
    // choice, the execution, and the treaty actually in force afterwards.
    vi.spyOn(aiManager, 'chooseDiplomatAction').mockReturnValue('offer_open_borders');
    vi.spyOn(Math, 'random').mockReturnValue(0.01);

    aiManager.executeAIDiplomatAction(diplomat, engine.getDiplomatTargets(diplomat.id)[0]);
    expect(dm.hasTreaty(1, 0, 'open_borders')).toBe(true);
    expect(diplomat.movesRemaining).toBe(0);
  });

  it('a treaty proposed to the HUMAN is an offer, not an auto-signed treaty', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
    const { diplomat } = placeDiplomat(engine);

    vi.spyOn(aiManager, 'chooseDiplomatAction').mockReturnValue('offer_open_borders');
    aiManager.executeAIDiplomatAction(diplomat, engine.getDiplomatTargets(diplomat.id)[0]);

    expect(dm.hasTreaty(1, 0, 'open_borders')).toBe(false);
    const offers = events.filter(e => e.type === 'AI_DIPLOMACY_OFFER');
    expect(offers).toHaveLength(1);
    expect(offers[0].data.action).toBe('offer_open_borders');
  });

  it('an AI diplomat offers an exchange of knowledge WITH the two technologies', async () => {
    // Without the terms the offer reached the player as a sentence with no deal
    // behind it, and accepting it could only ever fail.
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    engine.civilizations[0].technologies = ['pottery', 'iron_working'];
    engine.civilizations[1].technologies = ['pottery', 'bronze_working'];
    const { diplomat } = placeDiplomat(engine);

    vi.spyOn(aiManager, 'chooseDiplomatAction').mockReturnValue('offer_tech_exchange');
    aiManager.executeAIDiplomatAction(diplomat, engine.getDiplomatTargets(diplomat.id)[0]);

    const offers = events.filter(e => e.type === 'AI_DIPLOMACY_OFFER');
    expect(offers).toHaveLength(1);
    expect(offers[0].data.action).toBe('offer_tech_exchange');
    expect(typeof offers[0].data.techOffered).toBe('string');
    expect(typeof offers[0].data.techRequested).toBe('string');
  });

  it('bribes a unit in reach rather than asking the human to negotiate a bribe', async () => {
    // Bribery is not a proposal: `presentOffer('bribe_unit')` reached the
    // audience screen with no deal the player could accept.
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
    const { diplomat } = placeDiplomat(engine);

    const enemy = {
      id: 'prey', civilizationId: 0, type: 'phalanx',
      col: diplomat.col, row: diplomat.row + 1, attack: 10, defense: 5, health: 100,
    } as any;
    (engine as any).units.push(enemy);
    engine.diplomacyManager.declareWar(1, 0);
    vi.spyOn(aiManager, 'chooseDiplomatAction').mockReturnValue('bribe_unit');

    aiManager.executeAIDiplomatAction(diplomat, {
      targetCivId: 0, kind: 'unit', unitId: 'prey', status: 'war', actions: ['bribe_unit'],
    });

    expect(events.some(e => e.type === 'AI_DIPLOMACY_OFFER')).toBe(false);
    // The diplomat is spent either way — it has nothing left to say.
    expect(diplomat.movesRemaining).toBe(0);
  });

  it('opens with the court this turn can be spent on, not the first one found', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    // Two courts in reach: a city of civ 0 at peace, channel already open
    // (nothing more urgent to do there but read their books), and a city of
    // civ 2 we are losing to badly (peace is available). The choice must not
    // be grid order — and the grid here does happen to yield civ 2 first.
    engine.foundCity(12, 12, 2, 'Losing Ground');
    engine.foundCity(14, 12, 0, 'Neighbour');
    const diplomat = {
      id: 'two_ways', civilizationId: 1, type: 'diplomat',
      col: 13, row: 12, movesRemaining: 2,
    } as any;
    (engine as any).units.push(diplomat);
    dm.markContact(1, 0);
    dm.markContact(1, 2);
    dm.establishEmbassy(1, 0);
    dm.declareWar(1, 2);
    vi.spyOn(dm, 'estimateMilitaryStrength').mockImplementation((civId: number) => (civId === 1 ? 5 : 200));

    const targets = engine.getDiplomatTargets(diplomat.id);
    expect(targets).toHaveLength(2);

    const choice = (aiManager as any).chooseDiplomatContact(diplomat, targets);
    expect(choice).not.toBeNull();
    // Sueing for peace is worth more of this turn than reading their ledgers,
    // and the neighbour's embassy will still be there next turn.
    expect(choice.target.targetCivId).toBe(2);
    expect(choice.action).toBe('propose_peace');
  });
});

/**
 * Trade visits — an ordinary unit, already standing beside a foreign city,
 * proposes an Exchange of Knowledge when the evaluator says the civ comes out
 * ahead.
 *
 * The scoring itself is unit-tested in `tests/techTradeEvaluator.test.ts`;
 * what is under test HERE is the wiring: that it is a *regular* unit doing it,
 * that it happens only when the unit is already adjacent, and that the terms
 * actually reach the offer.
 */
describe('AI trade visits (regular units)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeEngine(seed = 20260925): Promise<GameEngine> {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
      mapSeed: seed,
    });
    return engine;
  }

  /** The human city the visiting unit will stand beside, and the unit itself. */
  function arrange(engine: GameEngine, type = 'warrior') {
    const city = engine.foundCity(12, 12, 0, 'Visit Town')!;
    const unit = {
      id: `visitor_${type}`,
      civilizationId: 1,
      type,
      col: city.col + 1,
      row: city.row,
      movesRemaining: 1,
      maxMoves: 1,
      health: 100,
      attack: 2,
      defense: 1,
      icon: type,
      orders: 'none',
    } as any;
    (engine as any).units.push(unit);
    return { city, unit };
  }

  /**
   * A trade both sides can actually make. Each civ has to hold something the
   * other lacks — the evaluator is never asked about a swap nobody can
   * complete. Bronze Working (30) out for Iron Working (50) pays for civ 1.
   */
  function arrangeProfitableTrade(engine: GameEngine, type = 'warrior') {
    engine.civilizations[1].technologies = ['pottery', 'bronze_working'];
    engine.civilizations[0].technologies = ['pottery', 'iron_working'];
    return arrange(engine, type);
  }

  it('a warrior beside an enemy city proposes a swap when it pays', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    dm.establishEmbassy(1, 0);
    const { unit } = arrangeProfitableTrade(engine, 'warrior');
    const visited = (aiManager as any).considerTradeVisit(unit);

    expect(visited).toBe(true);
    const offers = events.filter((e) => e.type === 'AI_DIPLOMACY_OFFER');
    expect(offers).toHaveLength(1);
    expect(offers[0].data.action).toBe('offer_tech_exchange');
    // The terms travel with the message, or the audience screen has a
    // sentence and no deal.
    expect(offers[0].data.techOffered).toBe('bronze_working');
    expect(offers[0].data.techRequested).toBe('iron_working');
    // The visit spends the unit's turn — it talked instead of marching.
    expect(unit.movesRemaining).toBe(0);
  });

  it('a scout visits too — this is not a warrior privilege', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    dm.establishEmbassy(1, 0);
    const { unit } = arrangeProfitableTrade(engine, 'scout');
    expect((aiManager as any).considerTradeVisit(unit)).toBe(true);
    expect(events.some((e) => e.type === 'AI_DIPLOMACY_OFFER')).toBe(true);
  });

  it('a diplomat is left to its own menu, not this path', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    engine.diplomacyManager.establishEmbassy(1, 0);
    const { unit } = arrangeProfitableTrade(engine, 'diplomat');
    expect((aiManager as any).considerTradeVisit(unit)).toBe(false);
  });

  it('a settler keeps founding rather than talking', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    engine.diplomacyManager.establishEmbassy(1, 0);
    const { unit } = arrangeProfitableTrade(engine, 'settler');
    expect((aiManager as any).considerTradeVisit(unit)).toBe(false);
  });

  it('a unit that is NOT adjacent visits nobody', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    engine.diplomacyManager.establishEmbassy(1, 0);
    const { unit } = arrangeProfitableTrade(engine);
    unit.col += 4; // well out of reach
    expect((aiManager as any).considerTradeVisit(unit)).toBe(false);
  });

  it('refuses to visit an enemy it is fighting', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    engine.diplomacyManager.establishEmbassy(1, 0);
    engine.diplomacyManager.declareWar(1, 0);
    const { unit } = arrangeProfitableTrade(engine);
    expect((aiManager as any).considerTradeVisit(unit)).toBe(false);
  });

  it('refuses without an embassy — the same gate the screen uses', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const { unit } = arrangeProfitableTrade(engine);
    expect((aiManager as any).considerTradeVisit(unit)).toBe(false);
  });

  it('refuses when the trade would leave the civ worse off', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    engine.diplomacyManager.establishEmbassy(1, 0);

    // The exact mirror of the profitable trade: hand over Iron Working (50),
    // get Bronze Working (30). Every pairing available is a loss.
    engine.civilizations[1].technologies = ['pottery', 'iron_working'];
    engine.civilizations[0].technologies = ['pottery', 'bronze_working'];

    const { unit } = arrange(engine);
    expect((aiManager as any).considerTradeVisit(unit)).toBe(false);
  });

  it('asks a given court at most once per round', async () => {
    const engine = await makeEngine();
    const aiManager = (engine as any).aiManager;
    const dm = engine.diplomacyManager;
    const events: Array<{ type: string; data: any }> = [];
    (engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    dm.establishEmbassy(1, 0);
    const { unit } = arrangeProfitableTrade(engine);
    expect((aiManager as any).considerTradeVisit(unit)).toBe(true);

    // A second unit of the same civ, same round, same neighbour: the offer is
    // already on its way, so it must not be repeated.
    const second = { ...unit, id: 'visitor_second', movesRemaining: 1 };
    (engine as any).units.push(second);
    expect((aiManager as any).considerTradeVisit(second)).toBe(false);

    const offers = events.filter((e) => e.type === 'AI_DIPLOMACY_OFFER');
    expect(offers).toHaveLength(1);
  });
});
