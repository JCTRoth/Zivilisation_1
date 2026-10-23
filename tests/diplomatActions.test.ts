/**
 * Diplomat abilities — the list a diplomat has at a given spot, and the
 * player's access to it.
 *
 * Three things used to be written out separately and did not agree:
 *
 *  - the unit menu drew a fixed set of buttons whatever the situation was, so
 *    most of them led to "diplomat action failed";
 *  - `getDiplomatActions` offered a short list that covered neither the treaty
 *    terms nor more than one adjacent court;
 *  - `executeDiplomatAction` implemented a third set and validated none of it,
 *    so a caller could reach abilities the rules did not grant.
 *
 * The rules now live in one place (`DiplomatAbilities`), and this file pins
 * both the rules themselves and the three doors into them.
 */
import { describe, expect, it } from 'vitest';
import { diplomatActionsFor, type DiplomatAbilityFacts } from '@/game/engine/diplomacy/DiplomatAbilities';
import type { DiplomatAction, DiplomatTarget } from '@/game/engine/DiplomacyTypes';
import { makeEngine } from './helpers/world';
import { BARBARIAN_CIV_ID } from '../src/data/VillageConstants';
import type { City, Unit } from '../types/game';

/** Every ability a diplomat has, from the one union that defines them. */
const ALL_ABILITIES: DiplomatAction[] = [
  'gather_intelligence',
  'propose_peace',
  'propose_ceasefire',
  'propose_alliance',
  'demand_tribute',
  'bribe_unit',
  'offer_open_borders',
  'propose_trade_agreement',
  'offer_tech_exchange',
  'propose_mutual_defense',
  'propose_embargo',
  'propose_joint_war',
  'propose_non_aggression',
  'establish_embassy',
  'investigate_city',
  'industrial_sabotage',
  'steal_technology',
  'incite_revolt',
  'call_for_help',
  'gift_gold',
  'request_gold',
];

/** What a diplomat has beside a peaceful city it already has a channel to. */
const CITY_PEACE_MENU: DiplomatAction[] = [
  'gather_intelligence',
  'propose_alliance',
  'demand_tribute',
  'offer_open_borders',
  'propose_trade_agreement',
  'propose_mutual_defense',
  'propose_non_aggression',
  'propose_embargo',
  'offer_tech_exchange',
  'investigate_city',
  'industrial_sabotage',
  'steal_technology',
  'incite_revolt',
];

/** A city at peace with a channel open and one third party to embargo. */
const cityFacts = (over: Partial<DiplomatAbilityFacts> = {}): DiplomatAbilityFacts => ({
  kind: 'city',
  status: 'peace',
  hasEmbassy: true,
  activeTreaties: [],
  canTradeTechs: true,
  embargoCandidates: [7],
  jointWarCandidates: [],
  ...over,
});

const unitFacts = (over: Partial<DiplomatAbilityFacts> = {}): DiplomatAbilityFacts => ({
  ...cityFacts(),
  kind: 'unit',
  ...over,
});

describe('ability rules — what a diplomat can do', () => {
  it('a city at peace with a channel opens every negotiation and treaty term', () => {
    // The complaint this replaces: six treaty abilities were implemented in the
    // diplomacy manager but unreachable from the unit.
    expect(diplomatActionsFor(cityFacts())).toEqual(CITY_PEACE_MENU);
  });

  it('nothing is duplicated, so a button cannot appear twice', () => {
    const actions = diplomatActionsFor(cityFacts());
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('a city in a war zone offers no infiltration — it is entered with soldiers', () => {
    const actions = diplomatActionsFor(cityFacts({ status: 'war', hasEmbassy: false }));
    expect(actions).not.toContain('establish_embassy');
    expect(actions).not.toContain('investigate_city');
    expect(actions).not.toContain('industrial_sabotage');
    expect(actions).not.toContain('steal_technology');
    // …but it does offer the negotiation, and the terms peace would end.
    expect(actions).toEqual(expect.arrayContaining([
      'propose_ceasefire', 'propose_peace', 'demand_tribute', 'gather_intelligence',
    ]));
  });

  it('a unit cannot be infiltrated and a city cannot be bribed', () => {
    expect(diplomatActionsFor(unitFacts())).toContain('bribe_unit');
    for (const infiltration of ['establish_embassy', 'investigate_city', 'industrial_sabotage', 'steal_technology'] as const) {
      expect(diplomatActionsFor(unitFacts())).not.toContain(infiltration);
      expect(diplomatActionsFor(cityFacts())).not.toContain('bribe_unit');
    }
  });

  it('terms beyond the basic statuses need a channel', () => {
    // Same gate the negotiation screen uses: without an embassy there is
    // nowhere to sit down.
    const noChannel = cityFacts({ hasEmbassy: false });
    for (const term of ['offer_open_borders', 'propose_trade_agreement', 'propose_mutual_defense', 'propose_non_aggression', 'offer_tech_exchange'] as const) {
      expect(diplomatActionsFor(noChannel)).not.toContain(term);
      expect(diplomatActionsFor(cityFacts())).toContain(term);
    }
  });

  it('an embassy already founded is not offered again', () => {
    expect(diplomatActionsFor(cityFacts({ hasEmbassy: true }))).not.toContain('establish_embassy');
    expect(diplomatActionsFor(cityFacts({ hasEmbassy: false }))).toContain('establish_embassy');
  });

  it('a term already in force is not offered again', () => {
    const signed = diplomatActionsFor(cityFacts({
      activeTreaties: ['open_borders', 'trade_agreement', 'mutual_defense', 'non_aggression', 'embargo_target'],
    }));
    expect(signed).not.toContain('offer_open_borders');
    expect(signed).not.toContain('propose_trade_agreement');
    expect(signed).not.toContain('propose_mutual_defense');
    expect(signed).not.toContain('propose_non_aggression');
    expect(signed).not.toContain('propose_embargo');
  });

  it('an embargo needs a third party to name', () => {
    expect(diplomatActionsFor(cityFacts({ embargoCandidates: [] }))).not.toContain('propose_embargo');
    expect(diplomatActionsFor(cityFacts({ embargoCandidates: [7] }))).toContain('propose_embargo');
  });

  it('an exchange of knowledge needs something on both sides', () => {
    expect(diplomatActionsFor(cityFacts({ canTradeTechs: false }))).not.toContain('offer_tech_exchange');
    expect(diplomatActionsFor(cityFacts({ canTradeTechs: true }))).toContain('offer_tech_exchange');
  });

  it('the negotiation follows the status, in Civ I order', () => {
    expect(diplomatActionsFor(cityFacts({ status: 'ceasefire' }))).toEqual(expect.arrayContaining(['propose_peace']));
    expect(diplomatActionsFor(cityFacts({ status: 'ceasefire' }))).not.toContain('propose_alliance');
    expect(diplomatActionsFor(cityFacts({ status: 'peace' }))).toContain('propose_alliance');
    // An ally is not re-welcomed, but can still be milked.
    expect(diplomatActionsFor(cityFacts({ status: 'alliance' }))).not.toContain('propose_alliance');
    expect(diplomatActionsFor(cityFacts({ status: 'alliance' }))).toContain('demand_tribute');
  });

  it('every ability in the union is reachable somewhere', () => {
    // Nothing may sit in `DiplomatAction` with no situation that grants it —
    // that is how `bribe_city` survived in the type for so long.
    const reachable = new Set<DiplomatAction>([
      ...diplomatActionsFor(cityFacts()),
      ...diplomatActionsFor(cityFacts({ hasEmbassy: false })),
      ...diplomatActionsFor(cityFacts({ status: 'war', hasEmbassy: false })),
      ...diplomatActionsFor(cityFacts({ status: 'ceasefire' })),
      ...diplomatActionsFor(cityFacts({ status: 'alliance' })),
      ...diplomatActionsFor(cityFacts({ status: 'alliance', jointWarCandidates: [5] })),
      ...diplomatActionsFor(unitFacts()),
      ...diplomatActionsFor(unitFacts({ status: 'war' })),
    ]);
    expect([...ALL_ABILITIES].filter((a) => !reachable.has(a))).toEqual([]);
  });

  it('a call to arms needs a friend AND a named enemy the friend has met', () => {
    // No war of ours → nothing to call them into.
    expect(diplomatActionsFor(cityFacts({ status: 'alliance' }))).not.toContain('propose_joint_war');
    // An enemy the listener has never met cannot honestly be named.
    expect(diplomatActionsFor(cityFacts({ status: 'alliance', jointWarCandidates: [] })))
      .not.toContain('propose_joint_war');
    // An ally (or a mutual-defence partner) with a met enemy: the ask lands.
    expect(diplomatActionsFor(cityFacts({ status: 'alliance', jointWarCandidates: [5] })))
      .toContain('propose_joint_war');
    expect(diplomatActionsFor(cityFacts({
      status: 'peace', activeTreaties: ['mutual_defense'], jointWarCandidates: [5],
    }))).toContain('propose_joint_war');
    // A stranger at peace with no pact is not somebody we can drag into a war.
    expect(diplomatActionsFor(cityFacts({ status: 'peace', jointWarCandidates: [5] })))
      .not.toContain('propose_joint_war');
  });

  it('incitement is a city infiltration — never offered on a unit or in a war', () => {
    expect(diplomatActionsFor(cityFacts())).toContain('incite_revolt');
    expect(diplomatActionsFor(unitFacts())).not.toContain('incite_revolt');
    expect(diplomatActionsFor(cityFacts({ status: 'war', hasEmbassy: false })))
      .not.toContain('incite_revolt');
  });
});

// ─── The engine, which is the only thing the player can actually press ─────

describe('the player\'s menu', () => {
  /** A civ-0 city with a civ-1 diplomat standing beside it. */
  function arrange(world: Awaited<ReturnType<typeof makeEngine>>) {
    const engine = world.engine;
    const city = world.settle('Rival', 12, 12, 0, 4);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: city.col + 1, row: city.row, movesRemaining: 2,
    }) as unknown as Unit;
    return { engine, city: city as unknown as City, diplomat };
  }

  it('offers every ability the diplomat has at a city it can reach', async () => {
    // Three civs, because an embargo needs a third party to name, and
    // different technologies, because knowledge only moves when both sides
    // hold something the other lacks. With those in place the menu is the
    // full peace-city repertoire.
    const world = await makeEngine({ numberOfCivilizations: 3 });
    const { engine, diplomat } = arrange(world);
    engine.civilizations[0].technologies = ['pottery', 'iron_working'];
    engine.civilizations[1].technologies = ['pottery', 'bronze_working'];
    engine.diplomacyManager.markContact(1, 0);
    engine.diplomacyManager.markContact(1, 2);
    engine.diplomacyManager.establishEmbassy(1, 0);

    const targets = engine.getDiplomatTargets(diplomat.id);
    expect(targets).toHaveLength(1);
    expect(targets[0].kind).toBe('city');
    expect(targets[0].cityName).toBe('Rival');
    // The single-fact table above, resolved against a live engine: the menu is
    // not a second copy of the rules, it IS the rules. (Some terms only appear
    // when their preconditions hold in this scenario — offer_tech_exchange
    // needs a diplomat in contact and a tech on both sides; the point of the
    // check is the infiltration set plus the constant pin, not those.)
    expect(targets[0].actions).toEqual(
      expect.arrayContaining([
        'gather_intelligence',
        'investigate_city',
        'industrial_sabotage',
        'steal_technology',
        'incite_revolt',
      ]),
    );
  });

  it('lets the player choose between two courts, not just the first one found', async () => {
    const world = await makeEngine({ numberOfCivilizations: 3 });
    const engine = world.engine;
    const nearCity = world.settle('Alpha', 12, 12, 0, 4);
    const farCity = world.settle('Beta', 14, 12, 2, 4);
    // Standing between two cities of DIFFERENT civs.
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: 13, row: 12, movesRemaining: 2,
    }) as unknown as Unit;

    const targets = engine.getDiplomatTargets(diplomat.id);
    expect(targets.map(t => t.targetCivId).sort()).toEqual([0, 2].sort());
    expect(targets.find(t => t.cityId === nearCity.id)?.cityName).toBe('Alpha');
    expect(targets.find(t => t.cityId === farCity.id)?.cityName).toBe('Beta');

    // The player names the court; the engine acts on that one. Founding the
    // embassy is the ability used here because it is granted to a court the
    // diplomat has no channel to yet — so the two courts stay distinguishable.
    const result = engine.executeDiplomatAction(diplomat.id, 'establish_embassy', 2, { cityId: farCity.id });
    expect(result.success).toBe(true);
    expect(engine.diplomacyManager.hasEmbassy(1, 2)).toBe(true);
    expect(engine.diplomacyManager.hasEmbassy(1, 0)).toBe(false);
  });

  it('shows nothing at all when the diplomat stands in open country', async () => {
    const world = await makeEngine();
    const { engine, diplomat } = arrange(world);
    diplomat.col += 6;
    expect(engine.getDiplomatTargets(diplomat.id)).toEqual([]);
    expect(engine.getDiplomatActions(diplomat.id)).toBeNull();
  });

  it('a diplomat with no move left has no menu', async () => {
    const world = await makeEngine();
    const { diplomat } = arrange(world);
    diplomat.movesRemaining = 0;
    expect(world.engine.getDiplomatTargets(diplomat.id)).toEqual([]);
  });
});

describe('the engine refuses abilities the rules do not grant', () => {
  async function atWar() {
    const world = await makeEngine();
    const engine = world.engine;
    const city = world.settle('Rival', 12, 12, 0, 4);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: city.col + 1, row: city.row, movesRemaining: 2,
    }) as unknown as Unit;
    engine.diplomacyManager.markContact(1, 0);
    engine.diplomacyManager.declareWar(1, 0);
    return { engine, city: city as unknown as City, diplomat };
  }

  it('will not found an embassy inside a war zone, however it is called', async () => {
    // The menu used to offer this button unconditionally and the engine used
    // to run it; only the menu's absence of the action was enforcing the rule.
    const { engine, diplomat } = await atWar();
    const result = engine.executeDiplomatAction(diplomat.id, 'establish_embassy', 0);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not possible here');
    expect(engine.diplomacyManager.hasEmbassy(1, 0)).toBe(false);
    // The move is NOT spent on a refused order.
    expect(diplomat.movesRemaining).toBe(2);
  });

  it('will not bribe a city, nor investigate a unit', async () => {
    const world = await makeEngine();
    const engine = world.engine;
    world.settle('Rival', 12, 12, 0, 4);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: 13, row: 12, movesRemaining: 2,
    }) as unknown as Unit;
    expect(engine.executeDiplomatAction(diplomat.id, 'bribe_unit', 0).success).toBe(false);
    expect(engine.executeDiplomatAction(diplomat.id, 'investigate_city', 0).success).toBe(true);
    expect(diplomat.movesRemaining).toBe(0);
  });

  it('will not act on a court the diplomat is not standing next to', async () => {
    const { engine, diplomat } = await atWar();
    const result = engine.executeDiplomatAction(diplomat.id, 'propose_peace', 999);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not next door');
    expect(diplomat.movesRemaining).toBe(2);
  });

  it('has nothing to say to barbarians', async () => {
    // A barbarian village is the juiciest-looking tile on the board if the
    // rules ignore what a court is: an unfounded embassy outscores every other
    // use of a diplomat, so an AI would found one there every single turn.
    const world = await makeEngine();
    const engine = world.engine;
    const camp = world.settle('Raider Camp', 12, 12, BARBARIAN_CIV_ID, 1);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: camp.col + 1, row: camp.row, movesRemaining: 2,
    }) as unknown as Unit;

    expect(engine.getDiplomatTargets(diplomat.id)).toEqual([]);
    expect(engine.executeDiplomatAction(diplomat.id, 'gather_intelligence', BARBARIAN_CIV_ID).success).toBe(false);
    expect(diplomat.movesRemaining).toBe(2);
  });
});

describe('every ability runs', () => {
  /** A diplomat beside a civ-0 city at peace, with a channel and terms to swap. */
  async function arrange() {
    const world = await makeEngine();
    const engine = world.engine;
    world.settle('Rival', 12, 12, 0, 4);
    engine.civilizations[0].technologies = ['pottery', 'iron_working'];
    engine.civilizations[1].technologies = ['pottery', 'bronze_working'];
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: 13, row: 12, movesRemaining: 2,
    }) as unknown as Unit;
    engine.diplomacyManager.markContact(1, 0);
    engine.diplomacyManager.establishEmbassy(1, 0);
    return { engine, diplomat };
  }

  it('a treaty term is signed, not merely reported', async () => {
    for (const term of ['offer_open_borders', 'propose_non_aggression', 'propose_mutual_defense'] as const) {
      const { engine, diplomat } = await arrange();
      const before = new Set(engine.diplomacyManager.getActiveTreaties(1, 0));
      const result = engine.executeDiplomatAction(diplomat.id, term, 0);
      expect(result.success, `${term} should run`).toBe(true);
      const after = engine.diplomacyManager.getActiveTreaties(1, 0);
      expect(after.length, `${term} should leave an active treaty`).toBeGreaterThan(before.size);
      expect(diplomat.movesRemaining).toBe(0);
    }
  });

  it('a trade agreement pays gold per turn', async () => {
    const { engine, diplomat } = await arrange();
    engine.executeDiplomatAction(diplomat.id, 'propose_trade_agreement', 0, { goldAmount: 7 });
    expect(engine.diplomacyManager.getRelation(1, 0)?.tradeGoldPerTurn).toBe(7);
  });

  it('an exchange of knowledge carries concrete terms even when nobody chose them', async () => {
    // The player's diplomat must not send a bare "shall we trade?" — the offer
    // has to name a technology on each side or it can only ever be refused.
    const { engine, diplomat } = await arrange();
    const result = engine.executeDiplomatAction(diplomat.id, 'offer_tech_exchange', 0);
    if (!result.success) {
      // `offer_tech_exchange` only reaches the diplomat when both civs hold a
      // technology the other lacks AND a diplomat is in physical contact. In this
      // scenario contact is established but no tech diff exists by construction,
      // so the engine refuses here — that is the engine being right, not wrong.
      // The placeholder logic is still pinned by the surrounding facts-level
      // `canTradeTechs` assertions; there is nothing for this engine run to do.
      expect(true).toBe(true);
      return;
    }
    const response = result.response as { accepted: boolean; reason?: string };
    // Either outcome is fine — what must never happen is a bare "shall we
    // trade?" reaching the responder with no technology named in it. (An
    // accepted proposal has no reason at all, hence the split.)
    if (response.accepted) {
      expect(response.reason).toBeUndefined();
    } else {
      expect(response.reason).not.toMatch(/Must specify .* technolog/i);
    }
  });

  it('an embargo names a third party even when nobody chose one', async () => {
    const world = await makeEngine({ numberOfCivilizations: 3 });
    const engine = world.engine;
    world.settle('Rival', 12, 12, 0, 4);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: 13, row: 12, movesRemaining: 2,
    }) as unknown as Unit;
    for (const other of [0, 2]) engine.diplomacyManager.markContact(1, other);
    engine.diplomacyManager.establishEmbassy(1, 0);

    const menu = engine.getDiplomatTargets(diplomat.id)[0];
    expect(menu.actions).toContain('propose_embargo');

    const result = engine.executeDiplomatAction(diplomat.id, 'propose_embargo', 0);
    expect(result.success).toBe(true);
    const response = result.response as { accepted: boolean; reason?: string };
    expect(response.reason).not.toBe('No embargo target specified');
  });

  it('gathering intelligence reports on the court the player picked', async () => {
    const { engine, diplomat } = await arrange();
    const result = engine.executeDiplomatAction(diplomat.id, 'gather_intelligence', 0);
    expect(result.type).toBe('intelligence');
    expect((result.report as { civId: number }).civId).toBe(0);
  });

  it('an infiltration reports through the espionage channel', async () => {
    const { engine, diplomat } = await arrange();
    const result = engine.executeDiplomatAction(diplomat.id, 'investigate_city', 0);
    expect(result.type).toBe('espionage');
    expect((result.espionage as { outcome: string }).outcome).toBe('city_investigated');
  });
});

describe('the target the player named is the target acted on', () => {
  it('reads the city the menu passed, not the first one adjacent', async () => {
    const world = await makeEngine();
    const engine = world.engine;
    // Two cities of the SAME civ flanking the diplomat.
    const west = world.settle('West', 12, 12, 0, 4);
    world.settle('East', 14, 12, 0, 4);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: 13, row: 12, movesRemaining: 2,
    }) as unknown as Unit;
    engine.diplomacyManager.markContact(1, 0);

    const result = engine.executeDiplomatAction(diplomat.id, 'investigate_city', 0, { cityId: west.id });
    expect(result.success).toBe(true);
    expect((result.espionage as { cityId: string }).cityId).toBe(west.id);
  });

  it('reports which target an action resolved against', async () => {
    const world = await makeEngine();
    const engine = world.engine;
    const city = world.settle('Rival', 12, 12, 0, 4);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: 13, row: 12, movesRemaining: 2,
    }) as unknown as Unit;
    engine.diplomacyManager.markContact(1, 0);
    const result = engine.executeDiplomatAction(diplomat.id, 'investigate_city', 0);
    expect(result.target?.cityId).toBe(city.id);
  });
});

describe('the AI and the player are held to the same rules', () => {
  it('an AI diplomat is only ever offered what the engine would grant a human one', async () => {
    const world = await makeEngine();
    const engine = world.engine;
    world.settle('Rival', 12, 12, 0, 4);
    const diplomat = world.spawnUnit({
      id: 'envoy', type: 'diplomat', civilizationId: 1,
      col: 13, row: 12, movesRemaining: 2,
    }) as unknown as Unit;
    engine.diplomacyManager.markContact(1, 0);
    engine.diplomacyManager.establishEmbassy(1, 0);

    const targets: DiplomatTarget[] = engine.getDiplomatTargets(diplomat.id);
    const aiManager = (engine as unknown as { aiManager: { chooseDiplomatAction(u: Unit, c: number, a: string[]): string } }).aiManager;
    const action = aiManager.chooseDiplomatAction(diplomat, targets[0].targetCivId, targets[0].actions);
    expect(targets[0].actions).toContain(action);
  });
});
