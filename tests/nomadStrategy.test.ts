/**
 * Nomads — the strategy brain (NomadAI), the camp's musters, the plea for
 * gold, knowledge brokerage and the barbarian friendship.
 *
 * Pinned here:
 *   * the stance VARIATION over time (roads early → the market once a
 *     price is in reach) and its announcement,
 *   * anger overriding every review at once,
 *   * the muster's hard limit (two soldiers beyond the horde),
 *   * the money request: a broke tribe asks, gold changes hands,
 *   * the brokered knowledge sale to an AI court,
 *   * migration: the barbarians take a city, the camp moves in beside them
 *     and a friendship route opens.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { makeEngine, type TestWorld } from './helpers/world';
import { UNIT_TYPES } from '@/data/UnitConstants';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import {
  NOMAD_CIV_ID,
  NOMAD_MONEY_REQUEST_AMOUNT,
  NOMAD_ROUTE_INCOME_BASE,
} from '@/data/NomadConstants';

type Engine = TestWorld['engine'];

interface Harness {
  w: TestWorld;
  engine: Engine;
  events: Array<{ type: string; data: any }>;
  nm: Engine['nomadManager'];
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** A single-human world with one player city and a spy on the event bus. */
async function world(): Promise<Harness> {
  const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
  const events: Array<{ type: string; data: any }> = [];
  (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
  const spot = w.landNear(10, 10, 8);
  w.settle('Haven', spot.col, spot.row, 0, 1);
  return { w, engine: w.engine, events, nm: w.engine.nomadManager };
}

const eventsOf = (events: Array<{ type: string; data: any }>, type: string) =>
  events.filter((e) => e.type === type);

const horde = (engine: Engine) =>
  engine.units.filter(
    (u) =>
      u.civilizationId === NOMAD_CIV_ID
      && !u.isDefeated
      && u.type !== UNIT_TYPES.NOMAD_CARAVAN,
  );

/**
 * The visit is CONTACT-BASED: the parley opens only when the nomads' units
 * meet the player's units or cities. Force that meeting — a witness at the
 * camp's gate — so the envoy lands on spawn+1; `leaveGate` once answered,
 * or the proximity re-offer later steals the stage.
 */
function meetCamp(engine: Engine, events: Array<{ type: string; data: any }>): void {
  const nm = engine.nomadManager;
  nm.processRound(4); // the camp appears
  const camp = horde(engine)[0];
  engine.units.push({
    id: 'witness', type: 'warriors', civilizationId: 0,
    col: camp.col, row: camp.row, // ON the camp tile — the visit binds to same-tile contact
    movesRemaining: 1, maxMoves: 1, health: 100, attack: 1, defense: 1,
    icon: '⚔️', orders: null, isDefeated: false,
  });
  nm.processRound(5); // their units meet yours → the envoy speaks
  expect(eventsOf(events, 'NOMAD_PARLEY').length).toBeGreaterThan(0);
}

/** The player's witness leaves with the answer (they walked away). */
function leaveGate(engine: Engine): void {
  engine.units = engine.units.filter((u) => u.id !== 'witness');
}

describe('Nomads — the strategy brain', () => {
  it('varies over time: roads while the world is young, the market once a price is in reach', async () => {
    const { engine, events, nm } = await world();
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // the Sámi (mystic); jitter pinned high
    meetCamp(engine, events); // spawn + the meeting (the envoy at +1)
    expect(nm.resolveParley('maps').ok).toBe(true); // friendly, camp lingers
    leaveGate(engine); // the player answered and walked away
    expect(nm.currentStance).toBe('roads'); // the opening doctrine

    // Rich, and by round 40 the board has aged: the market outscores roads.
    nm.treasury = 800;
    for (let r = 7; r <= 39; r++) nm.processRound(r);
    expect(eventsOf(events, 'NOMAD_STRATEGY'), 'roads held while the world was young').toHaveLength(0);
    expect(nm.currentStance).toBe('roads');

    nm.processRound(40); // the round-40 review
    const shifts = eventsOf(events, 'NOMAD_STRATEGY');
    expect(shifts).toHaveLength(1);
    expect(shifts[0].data.stance).toBe('market');
    expect(nm.currentStance).toBe('market');

    // The new doctrine holds on the next review (no announcement spam).
    nm.processRound(48);
    expect(eventsOf(events, 'NOMAD_STRATEGY')).toHaveLength(1);
  });

  it('anger overrides every review at once', async () => {
    const { engine, events, nm } = await world();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    meetCamp(engine, events); // spawn + the meeting
    expect(nm.resolveParley('maps').ok).toBe(true);
    leaveGate(engine); // the player answered and walked away
    expect(eventsOf(events, 'NOMAD_STRATEGY')).toHaveLength(0);

    // First blood — and the review does NOT wait for the cadence.
    horde(engine)[0].health = 60;
    nm.processRound(7); // goAngry (economy still saw a peaceful world)
    expect(nm.isAngry).toBe(true);
    expect(nm.currentStance).toBe('roads');

    nm.processRound(8); // the very next economy phase re-reviews
    const shifts = eventsOf(events, 'NOMAD_STRATEGY');
    expect(shifts).toHaveLength(1);
    expect(shifts[0].data.stance).toBe('bribery');
    expect(nm.currentStance).toBe('bribery');
  });

  it('the camp musters soldiers under the steel stance — but never past the limit', async () => {
    const { engine, events, nm } = await world();
    // Ironhoof (warrior): the steel stance outscores roads from round 64
    // on (warrior +3, world aged +1, camp has room +1 vs roads' late-game 4).
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    for (let r = 4; r <= 63; r++) nm.processRound(r);
    expect(nm.currentStance).not.toBe('steel'); // money makers first
    const before = horde(engine).length;
    expect(before).toBe(3); // just the spawned horde

    for (let r = 64; r <= 90; r++) nm.processRound(r);
    // The steel doctrine was declared…
    expect(eventsOf(events, 'NOMAD_STRATEGY').some((e) => e.data.stance === 'steel')).toBe(true);

    // Exactly the limit: two mustered warriors on top of the horde — the
    // attempts at rounds 80 and 88 (garrison full) are refused by the cap.
    // (Once full, steel's room-bonus expires and the stance may rotate
    // back to business — the CAP, not the stance, is what is under test.)
    expect(horde(engine)).toHaveLength(3 + 2);
    // The two EXTRA soldiers are mustered canonical warriors — the spawned
    // horde keeps its legacy 'warriors'/'scout' types untouched.
    expect(horde(engine).filter((u) => u.type === UNIT_TYPES.WARRIOR)).toHaveLength(2);
    expect(nm.currentStance).not.toBe('steel'); // full camp: back to business
  });
});

describe('Nomads — asking for money', () => {
  /** Spawn, answer the parley with maps (camp lingers to round 26), then
   *  break the chest right before the plea's cooldown expires (round 24). */
  async function brokeAtTheGate(): Promise<Harness> {
    const h = await world();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    meetCamp(h.engine, h.events); // spawn + the meeting
    expect(h.nm.resolveParley('maps').ok).toBe(true);
    leaveGate(h.engine); // CRITICAL: a lingering witness would re-offer
    // the parley at +3 and the plea could never table itself.
    for (let r = 7; r <= 23; r++) h.nm.processRound(r);
    h.nm.treasury = 50; // broke — under NOMAD_MONEY_REQUEST_BELOW
    h.nm.processRound(24); // the plea's cooldown (from -1) expires here
    return h;
  }

  it('a broke tribe table a plea — and paying buys their friendship', async () => {
    const { engine, events, nm } = await brokeAtTheGate();

    const plea = eventsOf(events, 'NOMAD_MONEY_REQUEST').at(-1);
    expect(plea, 'they asked').toBeDefined();
    expect(plea.data.eyebrowKey).toBe('nomad.moneyRequest.eyebrow');
    expect(plea.data.leadKey).toBe('nomad.moneyRequest.lead');
    expect(plea.data.goldAmount).toBe(NOMAD_MONEY_REQUEST_AMOUNT);
    // The plea carries their spot — the camera goes there.
    expect(typeof plea.data.col).toBe('number');
    expect(typeof plea.data.row).toBe('number');
    expect(plea.data.choices.map((c: any) => c.id)).toEqual(['give_gold', 'refuse_gold']);
    expect(plea.data.speaker.image).toMatch(/^\/assets\/nomads\//);

    const playerGold = engine.civilizations[0].resources.gold;
    const chest = nm.treasury;
    const outcome = nm.resolveParley('give_gold');
    expect(outcome).toMatchObject({
      ok: true,
      result: 'goldGiven',
      params: { gold: NOMAD_MONEY_REQUEST_AMOUNT },
    });
    expect(engine.civilizations[0].resources.gold).toBe(playerGold - NOMAD_MONEY_REQUEST_AMOUNT);
    expect(nm.treasury).toBe(chest + NOMAD_MONEY_REQUEST_AMOUNT);
    expect(nm.currentStanding).toBe('friendly'); // they remember
  });

  it('refusing costs a friendship point but never turns the first ask hostile', async () => {
    const { engine, events, nm } = await brokeAtTheGate();
    const plea = eventsOf(events, 'NOMAD_MONEY_REQUEST').at(-1);
    expect(plea).toBeDefined();

    const outcome = nm.resolveParley('refuse_gold');
    expect(outcome).toMatchObject({ ok: true, result: 'goldRefused' });
    expect(nm.isAngry, 'every clan tolerates the first refusal').toBe(false);
    expect(nm.currentStanding).toBe('friendly');
    expect(engine.civilizations[0].resources.gold).toBeGreaterThan(0); // no gold moved
  });
});

describe('Nomads — knowledge brokerage', () => {
  it('sells a technology to an AI court and pays the chest', async () => {
    const { engine, events, nm } = await world();
    for (let r = 4; r <= 19; r++) nm.processRound(r); // first sale: spawn + 15

    const sales = eventsOf(events, 'NOMAD_KNOWLEDGE');
    expect(sales, 'the broker ran a deal').toHaveLength(1);
    const sale = sales[0].data;
    expect(sale.gold).toBeGreaterThanOrEqual(25);
    expect(sale.techId).toBeTruthy();
    expect(sale.civId).toBeGreaterThan(0); // an AI court, never the player

    // The buyer really got the knowledge…
    const buyer = engine.civilizations[sale.civId];
    const techs: any = buyer.technologies;
    const owns = Array.isArray(techs) ? techs.includes(sale.techId) : techs?.has?.(sale.techId);
    expect(owns, `${buyer.name} learned ${sale.tech}`).toBe(true);
    // …and the tribe was paid (the sale's exact gold landed in the chest —
    // route income may also have arrived this round, so only the sign shows).
    expect(nm.treasury).toBeGreaterThan(0);
  });
});

describe('Nomads — the barbarian friendship', () => {
  it('when the barbarians take a city, the camp moves in and a route opens', async () => {
    const { w, engine, events, nm } = await world();
    nm.processRound(4); // spawn
    const camp = nm.campTile!;

    // A free tile near the camp becomes the barbarians' new conquest.
    const near = freeTileNear(engine, camp, 4);
    const town = w.settle('BarbTown', near.col, near.row, BARBARIAN_CIV_ID, 3);

    engine.nomadManager.onBarbariansTookCity(town);

    // The camp struck tents and moved in beside them…
    const moved = nm.campTile!;
    const d = Math.max(Math.abs(moved.col - town.col), Math.abs(moved.row - town.row));
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(3);
    expect(horde(engine).every(
      (u) => Math.max(Math.abs(u.col - town.col), Math.abs(u.row - town.row)) <= 3,
    ), 'the horde followed the camp').toBe(true);
    expect(eventsOf(events, 'NOMAD_MIGRATED')).toHaveLength(1);
    expect(eventsOf(events, 'NOMAD_MIGRATED')[0].data.city).toBe('BarbTown');

    // …and the two peoples now trade: the friendship route pays per turn.
    expect(nm.routes).toContainEqual({
      partnerCityId: town.id,
      partnerCivId: BARBARIAN_CIV_ID,
    });
    const before = nm.treasury;
    nm.processRound(5);
    expect(nm.treasury - before).toBe(NOMAD_ROUTE_INCOME_BASE + Math.floor(3 / 2));
  });

  it('an angry tribe keeps its revenge and stays put', async () => {
    const { w, engine, events, nm } = await world();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    nm.processRound(4);
    nm.processRound(5);
    nm.processRound(6);
    horde(engine)[0].health = 60;
    nm.processRound(7);
    expect(nm.isAngry).toBe(true);

    const camp = nm.campTile!;
    const near = freeTileNear(engine, camp, 4);
    const town = w.settle('BarbTown', near.col, near.row, BARBARIAN_CIV_ID, 3);
    engine.nomadManager.onBarbariansTookCity(town);

    expect(nm.campTile).toEqual(camp); // no migration while angry
    expect(nm.routes).toHaveLength(0); // and no friendship route either
    expect(eventsOf(events, 'NOMAD_MIGRATED')).toHaveLength(0);
  });
});

/** A passable, free tile within `maxDist` of the origin. */
function freeTileNear(engine: Engine, origin: { col: number; row: number }, maxDist: number) {
  for (let d = 1; d <= maxDist; d++) {
    for (let dc = -d; dc <= d; dc++) {
      for (let dr = -d; dr <= d; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
        const col = origin.col + dc;
        const row = origin.row + dr;
        if (!engine.squareGrid.isValidSquare(col, row)) continue;
        if (!engine.isTilePassable(col, row)) continue;
        if (engine.getUnitAt(col, row)) continue;
        if (engine.getCityAt(col, row)) continue;
        return { col, row };
      }
    }
  }
  throw new Error(`no free tile within ${maxDist} of (${origin.col},${origin.row})`);
}
