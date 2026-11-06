/**
 * Nomads — the route: they travel PLAYER TO PLAYER, and what a camp at
 * your gate costs you.
 *
 * Pinned here:
 *   * the camp leaves your court and camps at a rival's (your audience is
 *     yours alone — the rival is answered in code, with the rival's gold),
 *   * a camp standing at your gate costs you food per mouth per turn,
 *   * a settlement costs food forever and buys its host city one extra
 *     trade-route slot,
 *   * refusing their settlement is a closed hand: their prices rise with
 *     every refusal.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeEngine } from './helpers/world';
import { UNIT_TYPES } from '@/data/UnitConstants';
import {
  NOMAD_CAMP_FOOD_COST,
  NOMAD_CIV_ID,
  NOMAD_REFUSAL_PRICE_PENALTY,
  NOMAD_SETTLEMENT_FOOD_COST,
  NOMAD_TRIGGER_ROUND,
} from '@/data/NomadConstants';
import { MAX_TRADE_ROUTES } from '@/game/engine/GameEngine';

type Engine = Awaited<ReturnType<typeof makeEngine>>['engine'];

interface Harness {
  engine: Engine;
  events: Array<{ type: string; data: any }>;
  settle: (col?: number, row?: number) => { col: number; row: number };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** A single-human world with a spy on the engine's event bus. */
async function world(): Promise<Harness> {
  const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
  const events: Array<{ type: string; data: any }> = [];
  (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
  const settle = (col = 10, row = 10) => {
    const spot = w.landNear(col, row, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    return spot;
  };
  return { engine: w.engine, events, settle };
}

const eventsOf = (events: Array<{ type: string; data: any }>, type: string) =>
  events.filter((e) => e.type === type);

const nomadUnits = (engine: Engine) =>
  engine.units.filter(
    (u) =>
      u.civilizationId === NOMAD_CIV_ID
      && !u.isDefeated
      && u.type !== UNIT_TYPES.NOMAD_CARAVAN,
  );

const playerUnit = (id: string, col: number, row: number) => ({
  id,
  type: 'warriors',
  civilizationId: 0,
  col,
  row,
  movesRemaining: 1,
  maxMoves: 1,
  health: 100,
  attack: 1,
  defense: 1,
  icon: '⚔️',
  orders: null,
  isDefeated: false,
});

/**
 * Spawn at the trigger round, walk the whole horde ONTO the player's city
 * and stand a witness with them: the envoy speaks on the next round.
 */
function meetCampAtCity(h: Harness): { city: Engine['cities'][number] } {
  const nm = h.engine.nomadManager;
  const city = h.engine.cities.find((c) => c.name === 'Haven')!;
  nm.processRound(NOMAD_TRIGGER_ROUND);
  for (const unit of nomadUnits(h.engine)) {
    unit.col = city.col;
    unit.row = city.row;
  }
  h.engine.units.push(playerUnit('witness', city.col, city.row));
  nm.processRound(NOMAD_TRIGGER_ROUND + 1);
  expect(eventsOf(h.events, 'NOMAD_PARLEY').length, 'the envoy must have arrived').toBeGreaterThan(0);
  return { city };
}

describe('Nomads — the route', () => {
  it('leaves your court and camps at a rival instead', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;

    // Pinned: the settle door stays shut, the rival's chest is too thin to
    // buy the riders, and the route's shuffle is deterministic. A NEUTRAL
    // departure (no deal, no promise) sends them straight down the route —
    // a friendly court would get its promised return visit first.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      meetCampAtCity(h);
      expect(nm.currentTargetCivId).toBe(0);
      expect(nm.resolveParley('pass').ok).toBe(true);

      // The route: they strike camp for another court — and an audience
      // may ONLY ever open at YOUR court, wherever they end up.
      let leftForARival = false;
      let departedFromYou = false;
      let parleysSoFar = eventsOf(h.events, 'NOMAD_PARLEY').length;
      let visitsSoFar = nm.visits;
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= 70; r++) {
        nm.processRound(r);
        if (nm.currentTargetCivId !== 0) {
          leftForARival = true;
          departedFromYou = departedFromYou || nm.isDeparted;
        }
        const parleys = eventsOf(h.events, 'NOMAD_PARLEY').length;
        if (parleys > parleysSoFar) {
          expect(nm.currentTargetCivId, 'an audience only ever opens at your court').toBe(0);
          parleysSoFar = parleys;
        }
        if (nm.visits > visitsSoFar) {
          expect(nm.currentTargetCivId, 'only your court counts as a visit').toBe(0);
          visitsSoFar = nm.visits;
        }
      }
      expect(leftForARival, 'after you they ride on to another court').toBe(true);
      expect(departedFromYou, 'gone from YOUR court').toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('a rival court answers the envoy in code — no modal, their gold pays', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;
    const playerGold = h.engine.civilizations[0].resources.gold;
    const rivals = h.engine.civilizations.filter((c) => c.id !== 0);
    for (const rival of rivals) rival.resources.gold = 500;

    // The tribe's own knowledge brokerage (every 15 rounds, to ANY court)
    // sells the same wares — silence it so the only sale in this test is
    // the envoy's, at the rival's gate.
    const ai = (nm as unknown as { ai: { plan: (s: unknown) => unknown } }).ai;
    const planSpy = vi.spyOn(ai, 'plan').mockReturnValue({ sellKnowledge: false });
    // Pinned to 0.5: high enough that the wander keeps closing in (0 would
    // make every step a sideways drift) and low enough that no rival rolls
    // the gamble that would hire the riders out from under the meeting.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      meetCampAtCity(h);
      expect(nm.resolveParley('pass').ok).toBe(true);

      let sold = false;
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= 120; r++) {
        nm.processRound(r);
        const knowledge = eventsOf(h.events, 'NOMAD_KNOWLEDGE');
        if (knowledge.length > 0) {
          const target = nm.currentTargetCivId;
          expect(target, 'not at your court').not.toBe(0);
          expect(knowledge.at(-1)!.data.civId).toBe(target);
          expect(
            h.engine.civilizations[target].technologies.length,
            'the rival really learned it',
          ).toBeGreaterThan(0);
          sold = true;
          break;
        }
      }
      expect(sold, 'the rival bought what the envoy carried').toBe(true);
      // Their chest, not yours: the deal never touches the human's purse.
      expect(h.engine.civilizations[0].resources.gold).toBe(playerGold);
    } finally {
      randomSpy.mockRestore();
      planSpy.mockRestore();
    }
  });

  it('after the split one group rides on while the other stays put', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;

    // Math.random pinned high: every wander step closes in (0 would make
    // every step a sideways drift) and nobody rolls a purchase.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      meetCampAtCity(h);
      expect(nm.resolveParley('maps').ok).toBe(true);
      // The player answers and walks away from the gate.
      h.engine.units = h.engine.units.filter((u) => u.id !== 'witness');

      // The tribe grows (one rider every eighth round after the answer) and
      // divides at six — two camps, ONE tribe, one brain.
      let splitAt = -1;
      let stayedBehind = false;
      let onTheRoad = false;
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= NOMAD_TRIGGER_ROUND + 30; r++) {
        nm.processRound(r);

        if (splitAt < 0 && (nm as unknown as { camps: unknown[] }).camps.length > 1) splitAt = r;

        // The first group to leave takes the road — the other one keeps its
        // tents standing (its own linger runs from now).
        const camps = (nm as unknown as { camps: Array<{ unitIds: string[] }> }).camps;
        const road = (nm as unknown as { road: unknown[] }).road;
        if (splitAt > 0 && camps.length === 1 && road.length > 0 && camps[0].unitIds.length > 0) {
          stayedBehind = true;
          onTheRoad = true;
          break;
        }
      }

      expect(splitAt, 'they grew and divided into two camps').toBeGreaterThan(0);
      expect(stayedBehind, 'one group still stands where it stood').toBe(true);
      expect(onTheRoad, 'the other group has struck tents and rides on').toBe(true);
      // The tribe never vanishes from the map: somebody is always on it.
      expect(
        nomadUnits(h.engine).length,
        'a nomad group is still on the map',
      ).toBeGreaterThan(0);
      // And the group that stayed is still standing AT YOUR COURT — one
      // departed, so the tribe as a whole has not left you.
      expect(nm.currentTargetCivId, 'the staying group is still yours').toBe(0);
      expect(nm.isDeparted, 'and no camp of theirs is gone from you').toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('they ride on: the departed group crosses the map on its own legs', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;
    const city = h.engine.cities[0];

    // Every rival court needs a CITY at the other end of the road: the
    // route picks an alive court, and a court with nobody home is one the
    // riders would only re-route away from.
    for (const civId of [1, 2]) {
      let founded = false;
      for (let d = 6; d <= 24 && !founded; d++) {
        for (let dc = -d; dc <= d && !founded; dc++) {
          for (let dr = -d; dr <= d && !founded; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
            const col = city.col + dc;
            const row = city.row + dr;
            if (!h.engine.isValidHex(col, row)) continue;
            if (!h.engine.isTilePassable(col, row)) continue;
            if (h.engine.getUnitAt(col, row) || h.engine.getCityAt(col, row)) continue;
            h.engine.foundCity(col, row, civId);
            founded = true;
          }
        }
      }
      expect(founded, `room for rival court ${civId}`).toBe(true);
    }

    nm.processRound(NOMAD_TRIGGER_ROUND);
    for (const rider of nomadUnits(h.engine)) {
      rider.col = city.col;
      rider.row = city.row;
    }
    nm.processRound(NOMAD_TRIGGER_ROUND + 1);
    expect(eventsOf(h.events, 'NOMAD_PARLEY').length).toBeGreaterThan(0);
    expect(nm.resolveParley('pass').ok).toBe(true);

    // The short refusal timer strikes the tents…
    const road = (nm as unknown as {
      road: Array<{ unitIds: string[]; targetCivId: number; arriveAt: number }>;
    }).road;
    let departedAt = -1;
    for (let r = NOMAD_TRIGGER_ROUND + 2; r <= NOMAD_TRIGGER_ROUND + 30; r++) {
      nm.processRound(r);
      if (nm.isDeparted) { departedAt = r; break; }
    }
    expect(departedAt, 'they struck their tents').toBeGreaterThan(0);

    // …and NOBODY vanishes: the riders are still on the map, riding —
    // the travel spell is gone, the tribe crosses the ground itself.
    expect(road.length, 'a group took the road').toBeGreaterThan(0);
    const riderIds = [...nomadUnits(h.engine)].map((u) => u.id);
    expect(riderIds.length, 'they ride on, in the open').toBeGreaterThan(0);
    const target = road[0].targetCivId;
    const front = h.engine.cities.find((c) => c.civilizationId === target)
      ?? null;
    expect(front, 'the next court still stands').not.toBeNull();
    const dist = (u: { col: number; row: number }) =>
      Math.max(Math.abs(u.col - front!.col), Math.abs(u.row - front!.row));
    const atDeparture = Math.min(...nomadUnits(h.engine).map(dist));

    // They COVER GROUND toward it — a ride, not a teleport…
    let best = atDeparture;
    let arrived = false;
    for (let r = departedAt + 1; r <= departedAt + 45; r++) {
      nm.processRound(r);
      expect(nomadUnits(h.engine).length, 'still on the map while riding').toBeGreaterThan(0);
      const camp = (nm as unknown as { camps: Array<{ targetCivId: number; unitIds: string[] }> })
        .camps.find((c) => c.targetCivId === target);
      if (camp) {
        arrived = true;
        // …and the SAME riders raise the tents at the destination.
        expect([...camp.unitIds].sort()).toEqual([...riderIds].sort());
        break;
      }
      if (nomadUnits(h.engine).length > 0) {
        best = Math.min(best, Math.min(...nomadUnits(h.engine).map(dist)));
      }
    }
    expect(best, 'they closed the road on foot').toBeLessThan(atDeparture);
    expect(arrived, 'they rode all the way to the next court').toBe(true);
  });

  it('a standing camp pitches a tent beside its tents — and takes it up when it leaves', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;
    const city = h.engine.cities[0];
    const tents = () =>
      (h.engine.map?.tiles ?? []).filter((t) => (t as { nomadTent?: boolean }).nomadTent);

    // Out in the country: the camp's own pitch appears beside its tents.
    nm.processRound(NOMAD_TRIGGER_ROUND);
    expect(tents(), 'the camp pitched a tent').toHaveLength(1);

    // At your gate: the tents moved onto your city, so the pitch stands
    // BESIDE YOUR CITY — the visible "somebody lives here" that says why
    // their riders are standing still.
    for (const rider of nomadUnits(h.engine)) {
      rider.col = city.col;
      rider.row = city.row;
    }
    nm.processRound(NOMAD_TRIGGER_ROUND + 1);
    const atGate = tents();
    expect(atGate, 'one pitch at the gate').toHaveLength(1);
    expect(
      Math.max(Math.abs(atGate[0].col - city.col), Math.abs(atGate[0].row - city.row)),
      'the tent stands next to the city',
    ).toBeLessThanOrEqual(2);

    // Striking the tents pulls the pitch out of the ground with them.
    expect(nm.resolveParley('pass').ok).toBe(true);
    for (let r = NOMAD_TRIGGER_ROUND + 2; r <= NOMAD_TRIGGER_ROUND + 30 && !nm.isDeparted; r++) {
      nm.processRound(r);
    }
    expect(nm.isDeparted, 'they left').toBe(true);
    expect(tents(), 'the pitch went with the tents').toHaveLength(0);
  });

  it('never camps at your city without a dialog — the envoy comes back', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;
    const city = h.engine.cities.find((c) => c.name === 'Haven')!;

    // Math.random pinned high: every wander step closes in.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      nm.processRound(NOMAD_TRIGGER_ROUND);
      // The whole horde stands ON the city — with no player unit in sight:
      // standing on the city IS the meeting, no garrison required.
      for (const rider of nomadUnits(h.engine)) {
        rider.col = city.col;
        rider.row = city.row;
      }
      nm.processRound(NOMAD_TRIGGER_ROUND + 1);
      expect(eventsOf(h.events, 'NOMAD_PARLEY'), 'the envoy speaks').toHaveLength(1);

      // The player answers and walks away — no witness, no unit anywhere
      // near — yet the group still stands ON the city: it may not sit there
      // unannounced, so the farewell audience comes round on its own.
      expect(nm.resolveParley('pass').ok).toBe(true);

      let reoffered = false;
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= NOMAD_TRIGGER_ROUND + 10; r++) {
        nm.processRound(r);
        if (eventsOf(h.events, 'NOMAD_PARLEY').length >= 2) {
          reoffered = true;
          break;
        }
      }
      expect(reoffered, 'a camp at your gate never stays without a dialog').toBe(true);
      const second = eventsOf(h.events, 'NOMAD_PARLEY').at(-1)!;
      expect(second.data.choices.map((c: any) => c.id)).toEqual(['hire', 'farewell']);
    } finally {
      spy.mockRestore();
    }
  });

  it('the city screen can table the audience itself (speakAtGate)', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;
    const city = h.engine.cities.find((c) => c.name === 'Haven')!;

    nm.processRound(NOMAD_TRIGGER_ROUND);
    // The horde is still out in the country: nothing to say at the gate.
    expect(nm.speakAtGate()).toBe(false);

    // The moment they stand on the city, the screen can table the parley…
    for (const rider of nomadUnits(h.engine)) {
      rider.col = city.col;
      rider.row = city.row;
    }
    expect(nm.speakAtGate()).toBe(true);
    expect(eventsOf(h.events, 'NOMAD_PARLEY')).toHaveLength(1);

    // …and asking twice does not re-roll the promised terms.
    const first = eventsOf(h.events, 'NOMAD_PARLEY').at(-1)!;
    expect(nm.speakAtGate()).toBe(true);
    expect(eventsOf(h.events, 'NOMAD_PARLEY')).toHaveLength(1);
    expect(first.data.choices.map((c: any) => c.id)).toContain('tech');
  });

  it('a camp standing at your gate costs you food — per mouth, per turn', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;
    const civ = h.engine.civilizations[0];
    const city = h.engine.cities.find((c) => c.name === 'Haven')!;
    const balance = () => h.engine.economicManager.cityFoodBalance(city, civ).surplus;
    const before = balance(); // nobody has come yet

    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      meetCampAtCity(h); // the whole horde stands ON the city
      const riders = nm.unitsNear(city.col, city.row, 3);
      expect(riders, 'the whole horde stands at the gate').toBe(3);

      // Every rider standing there eats its keep — and only for as long as
      // they stand there (no camp at the gate, no bill).
      expect(balance()).toBe(before - riders * NOMAD_CAMP_FOOD_COST);
    } finally {
      spy.mockRestore();
    }
  });

  it('a settlement costs food forever and buys the city a fourth trade route', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;
    const civ = h.engine.civilizations[0];
    const city = h.engine.cities.find((c) => c.name === 'Haven')!;
    const balance = () => h.engine.economicManager.cityFoodBalance(city, civ).surplus;
    const before = balance(); // nobody has come yet
    expect(h.engine.maxTradeRoutesFor(city)).toBe(MAX_TRADE_ROUTES);

    // Math.random = 0 rolls EVERY clan's settle chance (min 0.15).
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      meetCampAtCity(h);
      expect(nm.resolveParley('settle')).toMatchObject({ ok: true, result: 'settle' });
      expect(
        findSettlementTile(h.engine, city),
        'the settlement stands beside the city',
      ).not.toBeNull();

      // THE BONUS: their stakes beside the fields are worth a fourth road…
      expect(h.engine.maxTradeRoutesFor(city)).toBe(MAX_TRADE_ROUTES + 1);
      // …and the settlement's keep is billed for as long as it stands
      // (the visiting riders are gone — they are home now).
      expect(before - balance()).toBe(NOMAD_SETTLEMENT_FOOD_COST);
    } finally {
      spy.mockRestore();
    }
  });

  it('refusing their settlement is a closed hand: the next price carries the penalty', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;

    // Math.random = 0 → the Bedouin (index 0) and their settlement door.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const { city } = meetCampAtCity(h);
      const parley = eventsOf(h.events, 'NOMAD_PARLEY').at(-1)!;
      const ids = parley.data.choices.map((c: any) => c.id);
      expect(ids).toContain('settle');
      expect(ids).toContain('refuse_settle');
      const hireBefore = parley.data.choices.find((c: any) => c.id === 'hire').labelParams.gold;

      // "No camp beside our fields" — a refusal like any other.
      expect(nm.resolveParley('refuse_settle')).toMatchObject({ ok: true, result: 'pass' });
      expect((nm as unknown as { refusals: number }).refusals).toBe(1);
      expect((nm as unknown as { pricePenalty: () => number }).pricePenalty())
        .toBeCloseTo(1 + NOMAD_REFUSAL_PRICE_PENALTY);

      // Their prices remember EVERY closed hand: one visit allows one
      // refusal, so load the counter with a second (the counter itself is
      // asserted above) and open the audience again the way a dismissed
      // parley does — the door must come back priced at the penalty.
      const state = nm as unknown as { refusals: number; liveParley: string | null };
      state.refusals = 2;
      const tents = (nm as unknown as {
        camps: Array<{ parleyDone: boolean; parleyEmitted: boolean }>;
      }).camps[0];
      tents.parleyDone = false;
      tents.parleyEmitted = false;
      state.liveParley = null;
      const rider = nomadUnits(h.engine)[0];
      h.engine.units.push(playerUnit('witness2', rider.col, rider.row));
      nm.processRound(NOMAD_TRIGGER_ROUND + 2);

      const again = eventsOf(h.events, 'NOMAD_PARLEY').at(-1)!;
      expect(again.data.choices.map((c: any) => c.id)).toEqual(
        expect.arrayContaining(['tech', 'maps', 'hire', 'pass']),
      );
      const hireAfter = again.data.choices.find((c: any) => c.id === 'hire').labelParams.gold;
      expect(hireAfter).toBe(Math.ceil(hireBefore * (1 + 2 * NOMAD_REFUSAL_PRICE_PENALTY)));
      expect(city.name).toBe('Haven');
    } finally {
      spy.mockRestore();
    }
  });
});

/** The settlement tile the tribe planted beside `city` (within its ring). */
function findSettlementTile(engine: Engine, city: { col: number; row: number }) {
  for (let dc = -3; dc <= 3; dc++) {
    for (let dr = -3; dr <= 3; dr++) {
      if (engine.getTileAt(city.col + dc, city.row + dr)?.nomadSettlement) {
        return { col: city.col + dc, row: city.row + dr };
      }
    }
  }
  return null;
}
