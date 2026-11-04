/**
 * Nomads — their own AI player's books.
 *
 * The tribe opens with a war chest, builds its own unit type (the nomad
 * caravan, only the camp can make one), signs trade routes with up to six
 * cities and lives off them — and the two ways it can spend that gold
 * balance against each other: a rich, PEACEFUL camp buys one of your
 * cities, an ANGRY one bribes your troops instead.
 *
 * Pinned here:
 *   * the 300 opening purse,
 *   * caravan build → delivery → route income (and a partner that fell
 *     ends the route),
 *   * the six-route ceiling (a seventh city opens no seventh route),
 *   * the city market: offer, purchase, and a refused city never asked
 *     for again,
 *   * anger's counterweight: bribes near the horde,
 *   * identity: -2, never the barbarians' -1 (BarbarianManager drives
 *     every -1 unit and would commandeer the camp).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { makeEngine, type TestWorld } from './helpers/world';
import { UNIT_TYPES } from '@/data/UnitConstants';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import {
  NOMAD_CIV_ID,
  NOMAD_CITY_PRICE_BASE,
  NOMAD_CITY_PRICE_PER_POP,
  NOMAD_ROUTE_INCOME_BASE,
  NOMAD_START_GOLD,
  NOMAD_TRADE_ROUTE_LIMIT,
} from '@/data/NomadConstants';

type Engine = TestWorld['engine'];

interface Harness {
  w: TestWorld;
  engine: Engine;
  events: Array<{ type: string; data: any }>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** A single-human world with a spy on the engine's event bus. */
async function world(): Promise<Harness> {
  const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
  const events: Array<{ type: string; data: any }> = [];
  (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
  return { w, engine: w.engine, events };
}

const eventsOf = (events: Array<{ type: string; data: any }>, type: string) =>
  events.filter((e) => e.type === type);

/** The camp's horde — the caravan wears the same civ id but is not the horde. */
const horde = (engine: Engine) =>
  engine.units.filter(
    (u) =>
      u.civilizationId === NOMAD_CIV_ID
      && !u.isDefeated
      && u.type !== UNIT_TYPES.NOMAD_CARAVAN,
  );

const caravans = (engine: Engine) =>
  engine.units.filter((u) => u.type === UNIT_TYPES.NOMAD_CARAVAN && !u.isDefeated);

/**
 * The visit is CONTACT-BASED: the parley opens only when the nomads' units
 * meet the player's units or cities. Force that meeting — a witness at the
 * camp's gate — so the envoy lands on spawn+1. Remove it with `leaveGate`
 * once the parley is ANSWERED, or the proximity re-offer fires later and
 * steals the stage from the economy under test.
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

/** A passable, free tile on the origin's own landmass, within `maxDist`. */
function tileNear(engine: Engine, origin: { col: number; row: number }, maxDist: number) {
  const landmass = engine.getLandmassId?.(origin.col, origin.row) ?? -1;
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
        if (landmass >= 0 && engine.getLandmassId?.(col, row) !== landmass) continue;
        return { col, row };
      }
    }
  }
  throw new Error(`no free land tile within ${maxDist} of (${origin.col},${origin.row})`);
}

describe('Nomads — the war chest', () => {
  it('opens with exactly 300 gold and no routes', async () => {
    const { w, engine } = await world();
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const nm = engine.nomadManager;

    nm.processRound(4); // the camp spawns this round — the chest is untouched
    expect(nm.treasury).toBe(NOMAD_START_GOLD);
    expect(nm.treasury).toBe(300);
    expect(nm.routes).toHaveLength(0);
    expect(nm.ownedCityIds).toHaveLength(0);
  });

  it('builds a caravan, delivers it, and the route pays every turn', async () => {
    const { w, engine, events } = await world();
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const nm = engine.nomadManager;

    nm.processRound(4); // spawn
    const camp = nm.campTile!;

    // A partner city near the camp, on the camp's own landmass. (It may sit
    // close enough that the caravan delivers within the very round it is
    // built — the build is proven at the createUnit call, the delivery at
    // the route.)
    const p = tileNear(engine, camp, 4);
    const partner = w.settle('Partner', p.col, p.row, 1, 2);
    expect(partner.population).toBe(2);

    const createSpy = vi.spyOn(engine, 'createUnit');
    let builtAt = -1;
    for (let r = 5; r <= 9; r++) {
      const before = nm.treasury;
      nm.processRound(r);
      if (builtAt < 0 && createSpy.mock.calls.some((c) => c[1] === UNIT_TYPES.NOMAD_CARAVAN)) {
        builtAt = r;
        // THIS round, exactly: income was collected first, then the price
        // left the chest — nothing else may touch it in between.
        expect(nm.treasury).toBe(before - 100);
      }
    }
    expect(builtAt, 'the camp built its new unit type').toBeGreaterThanOrEqual(5);
    expect(createSpy).toHaveBeenCalledWith(
      NOMAD_CIV_ID,
      UNIT_TYPES.NOMAD_CARAVAN,
      camp.col,
      camp.row,
    );
    // A bazaar is an investment: a full third of the opening purse.
    expect(builtAt >= 5 && nm.treasury <= NOMAD_START_GOLD).toBe(true);

    // The caravan walks home: delivery consumes it (Civ1 rule) and signs the route.
    let last = 9;
    for (let r = 10; r <= 24 && nm.routes.length === 0; r++) {
      nm.processRound(r);
      last = r;
    }
    expect(nm.routes).toHaveLength(1);
    expect(nm.routes[0]).toMatchObject({ partnerCityId: partner.id, partnerCivId: 1 });
    expect(caravans(engine), 'the delivered caravan is spent').toHaveLength(0);
    const routeEvent = eventsOf(events, 'NOMAD_ROUTE');
    expect(routeEvent).toHaveLength(1);
    expect(routeEvent[0].data.city).toBe('Partner');
    expect(routeEvent[0].data.limit).toBe(NOMAD_TRADE_ROUTE_LIMIT);

    // Income: base + half the partner's heads = 2 + 1 = 3 per turn. The two
    // rounds after delivery are never build rounds (those fall every 10th
    // from round 9 — delivery lands at 9 or 10) nor knowledge sales (those
    // run from spawn + 15).
    const before = nm.treasury;
    nm.processRound(last + 1);
    nm.processRound(last + 2);
    expect(nm.treasury - before).toBe(2 * (NOMAD_ROUTE_INCOME_BASE + Math.floor(partner.population / 2)));

    // A partner that fell to somebody else is no longer a partner: the route
    // dies with it and the income stops that very turn (still no build round).
    partner.civilizationId = 2;
    const afterLoss = nm.treasury;
    nm.processRound(last + 3);
    expect(nm.routes).toHaveLength(0);
    expect(nm.treasury).toBe(afterLoss); // no income, no build, no tribute
  });

  it('never signs more than six routes', async () => {
    const { w, engine } = await world();
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const nm = engine.nomadManager;
    nm.processRound(4); // spawn
    const camp = nm.campTile!;

    // Six cities already under contract…
    const centers: Array<[number, number]> = [
      [3, 3], [16, 3], [3, 16], [16, 16], [9, 3], [3, 9], [16, 9], [9, 16],
    ];
    const partners = [];
    for (const [c, r] of centers) {
      if (partners.length >= NOMAD_TRADE_ROUTE_LIMIT) break;
      try {
        const s = w.landNear(c, r, 4);
        partners.push(w.settle(`P${partners.length}`, s.col, s.row, 1, 1));
      } catch {
        // water where land was hoped for — the next center may be dry
      }
    }
    expect(partners).toHaveLength(NOMAD_TRADE_ROUTE_LIMIT);
    for (const city of partners) {
      nm.routes.push({ partnerCityId: city.id, partnerCivId: city.civilizationId });
    }

    // …and a seventh city, right by the camp: a perfectly good target the
    // ceiling must refuse to serve.
    const s = tileNear(engine, camp, 4);
    const seventh = w.settle('Seventh', s.col, s.row, 1, 1);
    expect(seventh.civilizationId).toBe(1);

    for (let r = 5; r <= 10; r++) nm.processRound(r); // the build attempt falls at r9
    expect(caravans(engine), 'the seventh city must not open a seventh route').toHaveLength(0);
    expect(nm.routes).toHaveLength(NOMAD_TRADE_ROUTE_LIMIT);
  });

  it('a barbarian unit and the camp never trade identities (-2 ≠ -1)', async () => {
    const { w, engine } = await world();
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const nm = engine.nomadManager;

    expect(NOMAD_CIV_ID).toBe(-2);
    expect(NOMAD_CIV_ID).not.toBe(BARBARIAN_CIV_ID);

    // A real barbarian wanders the map while the camp sets up shop.
    const barb = w.spawnUnit({
      id: 'barbarian-raider',
      type: 'warriors',
      civilizationId: BARBARIAN_CIV_ID,
      col: 2,
      row: 2,
    });

    for (let r = 4; r <= 10; r++) nm.processRound(r); // spawn … first bazaar (r9)

    expect(horde(engine).length).toBeGreaterThanOrEqual(3);
    expect(horde(engine).every((u) => u.civilizationId === NOMAD_CIV_ID)).toBe(true);
    expect(caravans(engine).length, 'a bazaar is on the road').toBeGreaterThanOrEqual(1);
    expect(caravans(engine).every((u) => u.civilizationId === NOMAD_CIV_ID)).toBe(true);
    // The barbarian keeps its own id — and is not part of the camp.
    expect(barb.civilizationId).toBe(BARBARIAN_CIV_ID);
    expect(horde(engine).some((u) => u.id === barb.id)).toBe(false);
  });
});

describe('Nomads — the city market', () => {
  /**
   * A world with two player cities (Haven, pop 5 — the prize; Second, pop 2),
   * a camp that has answered the parley with "pass in peace" (parleyDone,
   * tolerated, not angry), and Math.random pinned so no AI hire race and no
   * settlement door can interfere.
   */
  async function peacefulAndRich(): Promise<Harness & { nm: Engine['nomadManager'] }> {
    const h = await world();
    const spot = h.w.landNear(10, 10, 8);
    h.w.settle('Haven', spot.col, spot.row, 0, 5);
    const second = h.w.landNear(16, 16, 4);
    h.w.settle('Second', second.col, second.row, 0, 2);
    const nm = h.engine.nomadManager;
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // the Sámi; no AI takes the camp
    meetCamp(h.engine, h.events); // spawn + the meeting (the envoy at +1)
    expect(nm.resolveParley('pass').ok).toBe(true);
    leaveGate(h.engine); // the player answered and walked away from the gate
    expect(nm.isAngry).toBe(false);
    nm.treasury = 800; // rich enough for Haven (250 + 75×5 = 625), even after a bazaar
    return { ...h, nm };
  }

  it('a rich, peaceful tribe buys your city at the promised price', async () => {
    const { engine, events, nm } = await peacefulAndRich();

    // The market opens on its 15-round cooldown (counted from "never").
    for (let r = 7; r <= 14; r++) nm.processRound(r);
    const offer = eventsOf(events, 'NOMAD_CITY_OFFER').at(-1);
    expect(offer, 'the market tabled an offer').toBeDefined();
    expect(offer.data.leadKey).toBe('nomad.cityOffer.lead');
    expect(offer.data.choices.map((c: any) => c.id)).toEqual(['buy_city', 'refuse_city']);
    expect(offer.data.choices[0].labelParams.city).toBe('Haven'); // the biggest
    const price = NOMAD_CITY_PRICE_BASE + NOMAD_CITY_PRICE_PER_POP * 5;
    expect(offer.data.goldAmount).toBe(price);
    // The market's audience carries their spot — the camera goes there.
    expect(typeof offer.data.col).toBe('number');
    expect(typeof offer.data.row).toBe('number');
    expect(price).toBe(625);

    // The sale: their chest pays, your treasury gains, the city changes hands.
    const playerGold = engine.civilizations[0].resources.gold;
    const chest = nm.treasury;
    expect(chest).toBeGreaterThanOrEqual(price);
    const outcome = nm.resolveParley('buy_city');
    expect(outcome).toMatchObject({
      ok: true,
      result: 'cityBought',
      params: { city: 'Haven', gold: price },
    });
    expect(engine.civilizations[0].resources.gold).toBe(playerGold + price);
    expect(nm.treasury).toBe(chest - price);
    const haven = engine.cities.find((c) => c.name === 'Haven')!;
    expect(haven.civilizationId).toBe(NOMAD_CIV_ID);
    expect(nm.ownedCityIds).toContain(haven.id);

    // The bought city pays tribute per head — called directly so the
    // assertion is about THIS income line, not about whatever else the
    // round (bazaars, knowledge, the market) may also be doing.
    const before = nm.treasury;
    (nm as any).collectCityTribute();
    expect(nm.treasury - before).toBe(5 * 1);
    expect(engine.civilizations[0].resources.gold).toBe(playerGold + price); // untouched
  });

  it('a refused city is never offered again — the next offer is the other one', async () => {
    const { engine, events, nm } = await peacefulAndRich();

    for (let r = 7; r <= 14; r++) nm.processRound(r);
    const first = eventsOf(events, 'NOMAD_CITY_OFFER').at(-1)!;
    expect(first.data.choices[0].labelParams.city).toBe('Haven');

    const chest = nm.treasury;
    const outcome = nm.resolveParley('refuse_city');
    expect(outcome).toMatchObject({ ok: true, result: 'cityRefused' });
    expect(outcome.params?.city).toBe('Haven');
    expect(nm.treasury).toBe(chest); // refusing moves no gold

    // The cooldown runs again — and the ONLY city left on the table is Second.
    nm.treasury = 700;
    for (let r = 15; r <= 29; r++) nm.processRound(r);
    const offers = eventsOf(events, 'NOMAD_CITY_OFFER');
    expect(offers).toHaveLength(2);
    const second = offers[1];
    expect(second.data.choices[0].labelParams.city).toBe('Second');
    expect(second.data.goldAmount).toBe(NOMAD_CITY_PRICE_BASE + NOMAD_CITY_PRICE_PER_POP * 2);

    // …and it can still be bought (the refusal blacklisted Haven, not the market).
    expect(nm.resolveParley('buy_city')).toMatchObject({ ok: true, result: 'cityBought' });
    expect(engine.cities.find((c) => c.name === 'Second')!.civilizationId).toBe(NOMAD_CIV_ID);

    // One city left, and it is refused: no third offer ever comes.
    for (let r = 30; r <= 46; r++) nm.processRound(r);
    expect(eventsOf(events, 'NOMAD_CITY_OFFER')).toHaveLength(2);
  });
});

describe('Nomads — anger buys soldiers', () => {
  it('an angry camp bribes the player’s troops standing near it', async () => {
    const { w, engine, events } = await world();
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const nm = engine.nomadManager;

    nm.processRound(4); // spawn
    nm.processRound(5);
    nm.processRound(6); // the envoy arrives

    // First blood: an injured camp unit is combat's signature.
    horde(engine)[0].health = 60;
    nm.processRound(7);
    expect(nm.isAngry).toBe(true);

    // One of the player's soldiers stands beside the horde, and the tribe
    // has gold to burn.
    const camp = nm.campTile!;
    const garrison = w.spawnUnit({
      id: 'garrison',
      type: 'warriors',
      civilizationId: 0,
      col: Math.min(camp.col + 1, 19),
      row: camp.row,
      attack: 4,
      defense: 2,
    });
    nm.treasury = 500;
    nm.processRound(8);

    const bribed = eventsOf(events, 'NOMAD_BRIBE');
    expect(bribed, 'the tribe spent gold on treachery').toHaveLength(1);
    const paid = Number(bribed[0].data.gold);
    expect(paid).toBeGreaterThan(0);
    expect(nm.treasury).toBe(500 - paid); // the chest paid exactly that
    expect(garrison.civilizationId).toBe(NOMAD_CIV_ID); // colors changed
    expect(horde(engine).some((u) => u.id === garrison.id), 'it joins the horde').toBe(true);
  });
});
