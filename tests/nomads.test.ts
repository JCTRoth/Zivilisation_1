/**
 * Nomads — the opening visitors.
 *
 * The parley is a small state machine: a neutral horde camps near the
 * single human's first city, THEIR units then march to YOUR units or
 * cities — the envoy speaks only when the two sides actually meet (never
 * on a timer) — the player picks one of four doors, and whatever was
 * taken the camp still stands — long enough for any AI court to hire it
 * before it walks off.
 *
 * Pinned here:
 *   * trigger and spawn (distance, landmass, neutral id, fortification),
 *   * THE CONTACT RULE: no meeting, no envoy — and the horde marches to
 *     close the distance itself,
 *   * the four doors and their promised terms (price/tech are what the
 *     BUTTON said, never re-rolled),
 *   * the AI hire race and the departure timer,
 *   * the skip conditions (hotseat, all-AI) and the no-city fallback,
 *   * dismissal re-offers on proximity, never every round.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeEngine } from './helpers/world';
import { UNIT_TYPES } from '@/data/UnitConstants';
import {
  NOMAD_AI_HIRE_MIN_ROUND_GAP,
  NOMAD_CIV_ID,
  NOMAD_PASS_DEPART_ROUNDS,
  NOMAD_SPAWN_MAX_DISTANCE,
  NOMAD_SPAWN_MIN_DISTANCE,
  NOMAD_TRIGGER_ROUND,
} from '@/data/NomadConstants';

type Engine = Awaited<ReturnType<typeof makeEngine>>['engine'];

interface Harness {
  engine: Engine;
  events: Array<{ type: string; data: any }>;
  settle: (col?: number, row?: number) => { col: number; row: number };
}

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

/**
 * The camp's HORDE (the warriors and the scout). The tribe's caravans wear
 * the same civ id but are the economy's business, not the camp's — the
 * relationship tests count the horde, `nomadEconomy.test.ts` counts them.
 */
const nomadUnits = (engine: Engine) =>
  engine.units.filter(
    (u) =>
      u.civilizationId === NOMAD_CIV_ID
      && !u.isDefeated
      && u.type !== UNIT_TYPES.NOMAD_CARAVAN,
  );

const eventsOf = (events: Array<{ type: string; data: any }>, type: string) =>
  events.filter((e) => e.type === type);

/**
 * The visit is CONTACT-BASED: the parley opens only when the nomads' units
 * meet the player's units or cities. These helpers force that meeting — a
 * player witness at the camp's gate (the player came to them) — so the
 * envoy lands on a known round: spawn at NOMAD_TRIGGER_ROUND, meeting (and
 * parley) at +1.
 *
 * Remove the witness once the parley is ANSWERED to model the player
 * walking away — otherwise the proximity re-offer fires later and steals
 * the stage from whatever the test wants to observe next.
 */
function meetCamp(engine: Engine, events: Array<{ type: string; data: any }>): any {
  const nm = engine.nomadManager;
  nm.processRound(NOMAD_TRIGGER_ROUND); // the camp appears
  const camp = nomadUnits(engine)[0];
  engine.units.push({
    id: 'witness', type: 'warriors', civilizationId: 0,
    col: camp.col, row: camp.row, // ON the camp tile — the visit binds to same-tile contact
    movesRemaining: 1, maxMoves: 1, health: 100, attack: 1, defense: 1,
    icon: '⚔️', orders: null, isDefeated: false,
  });
  nm.processRound(NOMAD_TRIGGER_ROUND + 1); // their units meet yours → the envoy speaks
  const parley = eventsOf(events, 'NOMAD_PARLEY').at(-1);
  expect(parley, 'the envoy must have arrived').toBeDefined();
  return parley;
}

/** The player's witness leaves with the answer (they walked away). */
function leaveGate(engine: Engine): void {
  engine.units = engine.units.filter((u) => u.id !== 'witness');
}

/**
 * THE REAL RIDE: a departed group does not vanish off the map — its tents
 * are down and its riders are on the road to the next court (or already
 * camped there), in the open the whole way. What must never hold is a camp
 * standing at YOUR gate without a dialog about it.
 */
function expectRidersRidingOn(engine: Engine, nm: unknown): void {
  const camps = (nm as { camps: Array<{ targetCivId: number }> }).camps;
  expect(
    camps.filter((c) => c.targetCivId === 0),
    'nothing stands at your gate',
  ).toHaveLength(0);
  expect(nomadUnits(engine).length, 'the riders ride on, in the open').toBeGreaterThan(0);
}

describe('Nomads — trigger and spawn', () => {
  it('appears after the first city, near it, as a neutral fortified camp', async () => {
    const { engine, events, settle } = await world();
    const nm = engine.nomadManager;
    const city = settle();

    nm.processRound(NOMAD_TRIGGER_ROUND - 1);
    expect(nm.isSpawned).toBe(false);

    nm.processRound(NOMAD_TRIGGER_ROUND);
    expect(nm.isSpawned).toBe(true);
    expect(eventsOf(events, 'NOMAD_SIGHTED')).toHaveLength(1);

    const camp = nomadUnits(engine);
    expect(camp).toHaveLength(3);
    expect(camp.every((u) => u.isFortified)).toBe(true);
    // The camp stands at the promised distance from the court.
    const dist = Math.max(
      Math.abs(camp[0].col - city.col),
      Math.abs(camp[0].row - city.row),
    );
    expect(dist).toBeGreaterThanOrEqual(NOMAD_SPAWN_MIN_DISTANCE);
    expect(dist).toBeLessThanOrEqual(NOMAD_SPAWN_MAX_DISTANCE);
    // And it is never on the player's own tile.
    expect(camp.some((u) => u.col === city.col && u.row === city.row)).toBe(false);
  });

  it('lifts NO fog — the camp in your fog stays unexplored until you walk it', async () => {
    const { engine, events, settle } = await world();
    settle();
    const nm = engine.nomadManager;
    const storage = engine.getPlayerStorage(0);
    const before = storage.explored.filter(Boolean).length;

    nm.processRound(NOMAD_TRIGGER_ROUND);
    const camp = nomadUnits(engine)[0];
    expect(camp, 'the camp spawned').toBeDefined();

    // THE BUG PIN: the tents stand 9–13 tiles out — ground the player has
    // never walked. Spawning them must not mark it "explored": that is the
    // gray shadow of war on a place you have never visited. Fog is earned
    // by walking it (the maps door and the hall's "find" are the
    // announced exceptions), and contact — their riders walking ONTO your
    // city — is what lights the map.
    expect(engine.isExploredByPlayer(0, camp.col, camp.row)).toBe(false);
    expect(storage.explored.filter(Boolean).length).toBe(before);

    // The story still speaks: the sighting is announced, just not painted.
    expect(eventsOf(events, 'NOMAD_SIGHTED')).toHaveLength(1);
  });

  it('a rider stepping across the map never paints the ACTIVE player’s fog', async () => {
    const { engine, settle } = await world();
    settle();
    const nm = engine.nomadManager;
    nm.processRound(NOMAD_TRIGGER_ROUND);
    const rider = nomadUnits(engine)[0];
    const storage = engine.getPlayerStorage(0);
    const before = storage.explored.filter(Boolean).length;

    // The round hook runs BEFORE `activePlayer` flips, so a foreign unit's
    // move regularly executes while some OTHER seat is "active" — here the
    // human. The reveal must land in the OWNER's fog, not the active
    // player's: otherwise every nomad and caravan walk grays the human's
    // map along its whole path.
    engine.activePlayer = 0;
    rider.isFortified = false;
    rider.movesRemaining = rider.maxMoves ?? 2;

    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    let stepped = false;
    for (const [dc, dr] of dirs) {
      const res = engine.moveUnit(rider.id, rider.col + dc, rider.row + dr);
      if (res?.success) {
        stepped = true;
        break;
      }
    }
    expect(stepped, 'the rider actually stepped').toBe(true);
    expect(storage.explored.filter(Boolean).length).toBe(before);
    expect(engine.isExploredByPlayer(0, rider.col, rider.row)).toBe(false);
  });

  it('waits for a city — with none by the fallback round it visits the settlers', async () => {
    const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
    const events: Array<{ type: string; data: any }> = [];
    (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
    const nm = w.engine.nomadManager;

    nm.processRound(NOMAD_TRIGGER_ROUND);
    expect(nm.isSpawned).toBe(false); // no city yet
    nm.processRound(11);
    expect(nm.isSpawned).toBe(false);
    nm.processRound(12); // fallback: the settler is anchor enough
    expect(nm.isSpawned).toBe(true);
    expect(nomadUnits(w.engine).length).toBe(3);
  });

  it('only visits on contact: no meeting with your units or cities, no envoy', async () => {
    const { engine, events, settle } = await world();
    settle();
    const nm = engine.nomadManager;
    const campSpawn = (col: number, row: number) =>
      Math.max(Math.abs(col - engine.cities[0].col), Math.abs(row - engine.cities[0].row));

    nm.processRound(NOMAD_TRIGGER_ROUND); // the camp appears — deep in the player's fog
    const spawnTile = { col: nomadUnits(engine)[0].col, row: nomadUnits(engine)[0].row };
    expect(campSpawn(spawnTile.col, spawnTile.row)).toBeGreaterThanOrEqual(NOMAD_SPAWN_MIN_DISTANCE);

    // No contact yet (they start ≥9 tiles out; four rounds of marching
    // cannot cover that) — so NO timer may open the parley.
    for (let r = NOMAD_TRIGGER_ROUND + 1; r <= 8; r++) nm.processRound(r);
    expect(eventsOf(events, 'NOMAD_PARLEY')).toHaveLength(0);

    // Their units march to the court — and on contact the envoy speaks.
    let parleyAt = -1;
    for (let r = 9; r <= 40; r++) {
      nm.processRound(r);
      if (eventsOf(events, 'NOMAD_PARLEY').length > 0) {
        parleyAt = r;
        break;
      }
    }
    expect(parleyAt, 'they came and met the court').toBeGreaterThan(0);

    // Face to face — ON the tile: the message binds to the nomads
    // APPEARING ON your city, not to them standing beside it.
    const city = engine.cities[0];
    const met = nomadUnits(engine).some(
      (u) => u.col === city.col && u.row === city.row,
    );
    expect(met, 'they are standing ON the city when the envoy speaks').toBe(true);

    // The audience carries where the horde stands — the camera takes the
    // viewer to the place the dialog is about.
    const parley = eventsOf(events, 'NOMAD_PARLEY').at(-1)!;
    expect(typeof parley.data.col).toBe('number');
    expect(typeof parley.data.row).toBe('number');
    const standingThere = nomadUnits(engine).some(
      (u) => u.col === parley.data.col && u.row === parley.data.row,
    );
    expect(standingThere, 'the spot is where the horde stands').toBe(true);
  });

  it('never spawns in hotseat or all-AI games', async () => {
    const hot = await makeEngine({
      numberOfCivilizations: 3, seed: 4242, humanPlayerIds: [0, 1],
    });
    const hotSpot = hot.landNear(10, 10, 8);
    hot.settle('H', hotSpot.col, hotSpot.row, 0);
    for (let r = 4; r < 20; r++) hot.engine.nomadManager.processRound(r);
    expect(hot.engine.nomadManager.isSpawned).toBe(false);

    const ai = await makeEngine({
      numberOfCivilizations: 3, seed: 4242, humanPlayerIds: [],
    });
    const spot = ai.landNear(10, 10, 8);
    ai.settle('H', spot.col, spot.row, 0, 1);
    for (let r = 4; r < 20; r++) ai.engine.nomadManager.processRound(r);
    expect(ai.engine.nomadManager.isSpawned).toBe(false);
  });
});

describe('Nomads — the parley', () => {
  /** Spawn + the forced meeting at the camp's gate (the envoy arrives). */
  async function atGate(): Promise<Harness & { parley: any }> {
    const h = await world();
    h.settle();
    const parley = meetCamp(h.engine, h.events);
    return { ...h, parley };
  }

  it('the envoy arrives with the four core doors and the clan’s identity', async () => {
    const { parley } = await atGate();
    // The clan is rolled per game — assert identity against the clan set.
    expect(parley.data.speaker.nameKey).toMatch(/^nomad\.clan\.[a-z]+\.name$/);
    expect(parley.data.speaker.subKey).toMatch(/^nomad\.clan\.[a-z]+\.epithet$/);
    expect(parley.data.speaker.image).toMatch(/^\/assets\/nomads\/[a-z]+\.png$/);
    expect(parley.data.leadKey).toMatch(/^nomad\./);
    const ids = parley.data.choices.map((c: any) => c.id);
    // A settlement door may join the four (per-clan chance) — the core four
    // are always there on a first visit.
    expect(ids).toEqual(expect.arrayContaining(['tech', 'maps', 'hire', 'pass']));
    expect(parley.data.choices.find((c: any) => c.id === 'tech').labelParams.tech).toBeTruthy();
    expect(parley.data.goldAmount).toBeGreaterThan(0);
  });

  it('the tech door costs what the button promised and grants that tech', async () => {
    const { engine, parley } = await atGate();
    const nm = engine.nomadManager;
    const human = engine.civilizations[0];
    human.resources.gold = 500;
    const price = parley.data.goldAmount;
    const tech = parley.data.techOffered;

    const outcome = nm.resolveParley('tech');
    expect(outcome).toMatchObject({ ok: true, result: 'tech', params: { tech: expect.any(String), gold: price } });
    expect(human.resources.gold).toBe(500 - price);
    expect(human.technologies).toContain(tech);
    expect(nm.isParleyDone).toBe(true);
    // The camp still stands — the race is on.
    expect(nomadUnits(engine)).toHaveLength(3);
    // Resolving twice is refused.
    expect(nm.resolveParley('tech').ok).toBe(false);
  });

  it('a broke court receives the gift free', async () => {
    const { engine, parley } = await atGate();
    const human = engine.civilizations[0];
    human.resources.gold = 0;

    const outcome = engine.nomadManager.resolveParley('tech');
    expect(outcome.result).toBe('techGift');
    expect(human.resources.gold).toBe(0);
    expect(human.technologies).toContain(parley.data.techOffered);
  });

  it('the maps door reveals a swath of the unknown world around the camp', async () => {
    const { engine, events } = await atGate();
    const storage = engine.getPlayerStorage(0);
    const before = storage.explored.filter(Boolean).length;

    const outcome = engine.nomadManager.resolveParley('maps');
    expect(outcome).toMatchObject({ ok: true, result: 'maps' });
    const after = storage.explored.filter(Boolean).length;
    // Radius-10 square around the camp, minus what was already lit; on the
    // test's 20×20 map (400 tiles) this is a quarter of the world.
    expect(after - before).toBeGreaterThan(50);
    expect(eventsOf(events, 'NOMAD_RESOLVED')).toHaveLength(1);
  });

  it('the hire door swaps colors: neutral units become the player’s', async () => {
    const { engine } = await atGate();
    const nm = engine.nomadManager;
    const human = engine.civilizations[0];
    human.resources.gold = 500;
    const before = nomadUnits(engine);

    const outcome = nm.resolveParley('hire');
    expect(outcome.result).toBe('hire');
    const price = Number(outcome.params?.gold);
    expect(human.resources.gold).toBe(500 - price);
    expect(before.every((u) => u.civilizationId === 0)).toBe(true);
    expect(nm.isHired).toBe(true);
    expect(before.every((u) => !u.isFortified)).toBe(true);
    // A hired camp neither departs nor keeps racing.
    nm.processRound(999);
    expect(nm.isDeparted).toBe(false);
  });

  it('a poor court is refused the hire (noGold), nothing changes', async () => {
    const { engine } = await atGate();
    engine.civilizations[0].resources.gold = 1;
    const outcome = engine.nomadManager.resolveParley('hire');
    expect(outcome).toMatchObject({ ok: false, result: 'noGold' });
    expect(nomadUnits(engine).every((u) => u.civilizationId === NOMAD_CIV_ID)).toBe(true);
  });

  it('passing in peace sends them off after the short timer', async () => {
    const { engine, events } = await atGate();
    const nm = engine.nomadManager;
    const outcome = nm.resolveParley('pass');
    expect(outcome).toMatchObject({ ok: true, result: 'pass' });
    // The player answered and walked away from the gate (no lingering
    // witness — nothing re-offers on the way out).
    leaveGate(engine);

    nm.processRound(NOMAD_TRIGGER_ROUND + 1 + NOMAD_PASS_DEPART_ROUNDS); // parley at +1
    expect(nm.isDeparted).toBe(true);
    expectRidersRidingOn(engine, nm);
    expect(eventsOf(events, 'NOMAD_DEPARTED')).toHaveLength(1);

    // A neutral refusal earns nothing: no return visit, ever. The tribe may
    // well be riding at a RIVAL's court by now (it travels camp by camp) —
    // what must hold is that it never comes back to YOUR gate.
    const parleysSoFar = eventsOf(events, 'NOMAD_PARLEY').length;
    for (let r = 13; r < 60; r++) nm.processRound(r);
    expect(nm.visits).toBe(1);
    expect(eventsOf(events, 'NOMAD_PARLEY')).toHaveLength(parleysSoFar);
    expect(nm.isDeparted, 'they never come back to your court').toBe(true);
  });

  it('a dismissed envoy re-offers when the player stands at the camp — not every round', async () => {
    const { engine, events } = await atGate();
    const nm = engine.nomadManager;
    const camp = nomadUnits(engine)[0];

    // Dismissal: the player walks away (no resolve) — no re-offer in place.
    leaveGate(engine);
    const base = eventsOf(events, 'NOMAD_PARLEY').length;
    for (let r = 20; r < 30; r++) {
      nm.processRound(r);
      expect(eventsOf(events, 'NOMAD_PARLEY').length).toBe(base);
    }

    // Standing at the camp re-offers (after the cooldown) — the FULL parley,
    // because none of its doors was ever answered.
    engine.units.push({
      id: 'visitor', type: 'warriors', civilizationId: 0,
      col: camp.col + 1, row: camp.row, movesRemaining: 1, maxMoves: 1,
      health: 100, attack: 1, defense: 1, icon: '⚔️', orders: null, isDefeated: false,
    });
    nm.processRound(31);
    const reoffered = eventsOf(events, 'NOMAD_PARLEY');
    expect(reoffered.length).toBe(base + 1);
    const ids = reoffered.at(-1)!.data.choices.map((c: any) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['tech', 'maps', 'hire', 'pass']));
  });
});

describe('Nomads — the race and the departure', () => {
  it('a rival court may buy ONE GROUP after the parley — and the player is told', async () => {
    const { engine, events } = await (async () => {
      const h = await world();
      h.settle();
      meetCamp(h.engine, h.events);
      return h;
    })();
    const nm = engine.nomadManager;
    nm.resolveParley('maps'); // dealt — the camp lingers, grows, splits
    // The player answered and walks away from the gate: no follow-up
    // audience may sit open while a rival is bidding (the screen is busy
    // otherwise — see the dismissal rule).
    engine.units = engine.units.filter((u) => u.id !== 'witness');
    engine.civilizations[1].resources.gold = 500;

    // Math.random pinned LOW: the wander must keep closing in (a pinned 0
    // makes every step a sideways drift) and the rider roll must come up as
    // a purchase the moment there is a SECOND camp to sell — never the last.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      // The race only opens NOMAD_AI_HIRE_MIN_ROUND_GAP after the answer,
      // and the tribe only HAS a second camp to sell once it has grown to
      // six riders (one every eight rounds) — cover both.
      const from = NOMAD_TRIGGER_ROUND + 1 + NOMAD_AI_HIRE_MIN_ROUND_GAP;
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= from + 8; r++) {
        nm.processRound(r);
        if (nm.isHired) break;
      }
    } finally {
      spy.mockRestore();
    }

    expect(nm.isHired, 'a court bought a group off the tribe').toBe(true);
    // `nomadUnits` only ever lists the TRIBE's (-2) riders, so the sold ones
    // are counted by their new uniform: military units now wearing civ 1.
    const sold = engine.units.filter(
      (u) => u.civilizationId === 1 && !u.isDefeated && u.type !== UNIT_TYPES.NOMAD_CARAVAN
        && u.type !== 'settler',
    );
    const left = nomadUnits(engine);
    expect(sold.length, 'one group changed hands').toBeGreaterThan(0);
    expect(left.length, 'the tribe is never sold out entirely').toBeGreaterThan(0);
    expect(engine.civilizations[1].resources.gold).toBeLessThan(500);
    // The player is TOLD — an announcement with a clan's face on it, not a
    // toast that scrolls away (it rides the audience machinery).
    const hired = eventsOf(events, 'NOMAD_GROUP_HIRED');
    expect(hired).toHaveLength(1);
    expect(hired[0].data.civId).toBe(1);
    expect(hired[0].data.leadKey).toBe('nomad.groupHired.lead');
    expect(hired[0].data.speaker.nameKey).toMatch(/^nomad\.clan\.[a-z]+\.name$/);
  });

  it('with nobody hiring, the dealt-with camp walks off on the linger timer', async () => {
    const { engine, events } = await (async () => {
      const h = await world();
      h.settle();
      meetCamp(h.engine, h.events);
      return h;
    })();
    const nm = engine.nomadManager;
    nm.resolveParley('maps');
    // AI never wins the roll (Math.random pinned high), no player nearby.
    leaveGate(engine);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      for (let r = NOMAD_TRIGGER_ROUND + 2; r < 40; r++) nm.processRound(r);
    } finally {
      spy.mockRestore();
    }
    expect(nm.isDeparted).toBe(true);
    expectRidersRidingOn(engine, nm);
    // Two groups leave on their own clocks ("one travels, one stays"), so a
    // grown tribe is announced twice — but never announced twice from a
    // court that is not yours.
    const departures = eventsOf(events, 'NOMAD_DEPARTED');
    expect(departures.length).toBeGreaterThanOrEqual(1);
    expect(departures.every((d) => d.data.from === 0)).toBe(true);
  });
});

describe('Nomads — moods, return visits and settlements', () => {
  /** Spawn + the forced meeting at the camp's gate (the envoy arrives). */
  async function atGate(): Promise<{
    engine: Awaited<ReturnType<typeof makeEngine>>['engine'];
    events: Array<{ type: string; data: any }>;
    settle: () => { col: number; row: number };
    parley: any;
  }> {
    const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
    const events: Array<{ type: string; data: any }> = [];
    (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
    const settle = () => {
      const spot = w.landNear(10, 10, 8);
      w.settle('Haven', spot.col, spot.row, 0, 1);
      return spot;
    };
    settle();
    const parley = meetCamp(w.engine, events);
    return { engine: w.engine, events, settle, parley };
  }

  it('a clan settlement beside your city costs food and raises defenders', async () => {
    const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
    const events: Array<{ type: string; data: any }> = [];
    (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const engine = w.engine;
    const nm = engine.nomadManager;
    const city = engine.cities.find((c) => c.name === 'Haven')!;
    const civ = engine.civilizations[0];
    const before = engine.economicManager.cityFoodBalance(city, civ).surplus;

    // Roll0 passes EVERY clan's settle chance (min 0.15) → the door appears
    // whichever clan the visit picks, deterministic under the spy.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    let settleChoice: any;
    try {
      meetCamp(engine, events); // spawn (clan index floor(0*3) = 0) + the meeting
      const parley = eventsOf(events, 'NOMAD_PARLEY').at(-1);
      expect(parley, 'the envoy must have arrived').toBeDefined();
      const choices = (parley.data.choices ?? []).map((c: any) => c.id);
      expect(choices).toContain('settle');
      settleChoice = parley.data.choices.find((c: any) => c.id === 'settle');
    } finally {
      spy.mockRestore();
    }
    expect(settleChoice.labelParams.city).toBe('Haven');

    const outcome = nm.resolveParley('settle');
    expect(outcome).toMatchObject({ ok: true, result: 'settle', params: { city: 'Haven' } });
    expect(nm.isSettled).toBe(true);
    // The camp became a home: no neutral units remain.
    expect(nomadUnits(engine)).toHaveLength(0);

    // The tile carries the settlement, within the city's neighbourhood…
    let flagged = false;
    for (let dc = -3; dc <= 3 && !flagged; dc++) {
      for (let dr = -3; dr <= 3; dr++) {
        if (engine.getTileAt(city.col + dc, city.row + dr)?.nomadSettlement) {
          flagged = true;
          break;
        }
      }
    }
    expect(flagged, 'a nomadSettlement tile exists beside the city').toBe(true);

    // …its defenders wear the player's colors…
    expect(engine.units.some(
      (u) => u.civilizationId === 0
        && u.type === 'warriors'
        && Math.max(Math.abs(u.col - city.col), Math.abs(u.row - city.row)) <= 3,
    )).toBe(true);

    // …and the city pays for it: exactly NOMAD_SETTLEMENT_FOOD_COST less.
    const after = engine.economicManager.cityFoodBalance(city, civ).surplus;
    expect(before - after).toBe(2);
  });

  it('drawing first blood turns the camp hostile and they start making trouble', async () => {
    const { engine, events, settle } = await world();
    settle();
    const nm = engine.nomadManager;
    // The camp appears but has NOT met anyone yet — anger needs no parley.
    nm.processRound(NOMAD_TRIGGER_ROUND);
    expect(nm.isAngry).toBe(false);
    expect(nomadUnits(engine).every((u) => u.isFortified)).toBe(true);

    // The player shoots one of them: an injury is combat's signature.
    nomadUnits(engine)[0].health = 60;
    nm.processRound(7);
    expect(nm.isAngry).toBe(true);
    expect(eventsOf(events, 'NOMAD_ANGRY')).toHaveLength(1);
    // The camp wakes: nobody holds position anymore.
    expect(nomadUnits(engine).every((u) => !u.isFortified)).toBe(true);

    // They march on the court…
    const positionsBefore = nomadUnits(engine).map((u) => `${u.col},${u.row}`).sort();
    for (let r = 8; r <= 14; r++) nm.processRound(r);
    const positionsAfter = nomadUnits(engine).map((u) => `${u.col},${u.row}`).sort();
    expect(positionsAfter).not.toEqual(positionsBefore);

    // …and raid what they reach before their patience (and their camp) ends.
    for (let r = 15; r <= 22; r++) nm.processRound(r);
    const raided = eventsOf(events, 'NOMAD_RAID').length > 0
      || engine.civilizations[0].resources.gold < 100;
    expect(raided, 'the raid reached the stores').toBe(true);
    // After the raid window the camp is gone for good — no return visit.
    expect(nm.visits).toBe(1);
  });

  it('beyond their patience: the proud clan turns hostile on the second refusal', async () => {
    // Clan index floor(0.4 * 3) = 1 → the Mongols, tolerance 1: the FIRST pass
    // is tolerated, the SECOND ends the parley as hostility — deterministic
    // under the spy whatever the world seed rolled.
    const w = await makeEngine({ numberOfCivilizations: 3, seed: 4242 });
    const events: Array<{ type: string; data: any }> = [];
    (w.engine as any).onStateChange = (type: string, data: any) => events.push({ type, data });
    const spot = w.landNear(10, 10, 8);
    w.settle('Haven', spot.col, spot.row, 0, 1);
    const engine = w.engine;
    const nm = engine.nomadManager;

    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.4);
    try {
      meetCamp(engine, events); // spawn (mongol under the spy) + the meeting
      expect(nm.currentClan?.id).toBe('mongol');

      expect(nm.resolveParley('pass').ok).toBe(true); // refusal #1 — tolerated
      expect(nm.isAngry).toBe(false);

      // Stand at the camp: the envoy re-offers (hire / farewell only).
      const camp = nomadUnits(engine)[0];
      engine.units.push({
        id: 'visitor', type: 'warriors', civilizationId: 0,
        col: camp.col + 1, row: camp.row, movesRemaining: 1, maxMoves: 1,
        health: 100, attack: 1, defense: 1, icon: '⚔️', orders: null, isDefeated: false,
      });
      nm.processRound(9);
      const second = eventsOf(events, 'NOMAD_PARLEY').at(-1);
      expect(second.data.choices.map((c: any) => c.id)).toEqual(['hire', 'farewell']);

      expect(nm.resolveParley('farewell').ok).toBe(true); // refusal #2 — beyond patience
      expect(nm.isAngry).toBe(true);
      expect(eventsOf(events, 'NOMAD_ANGRY')).toHaveLength(1);

      // The angry camp raids its window, then is gone for good — with NO
      // return visit (anger is not a friendship).
      for (let r = 10; r < 45; r++) nm.processRound(r);
      expect(nm.visits).toBe(1);
      expectRidersRidingOn(engine, nm);
    } finally {
      spy.mockRestore();
    }
  });

  it('a friendly court earns the return visit — with a bigger chart as their gift', async () => {
    const { engine, events } = await atGate();
    const nm = engine.nomadManager;
    const storage = engine.getPlayerStorage(0);
    const exploredAtDeal = storage.explored.filter(Boolean).length;

    expect(nm.resolveParley('maps').ok).toBe(true);
    expect(nm.currentStanding).toBe('friendly');
    // The witness leaves with the answer: the ONLY parley before the
    // return's own must be this first one (the loop counts them).
    leaveGate(engine);

    // Linger (20) → depart → the return visit is scheduled (+30) → arrives
    // and MARCHES to the gate — the contact-based envoy may take a few
    // rounds longer than a timer ever did. The AI hire race is held off
    // (rng pinned high): we are testing the RETURN, and in an open game
    // any court may take the camp first.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    let returned = false;
    try {
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= 80; r++) {
        nm.processRound(r);
        // Wait for the return visit AND its parley (the lead line is what
        // proves the RETURN spoke, not the first visit).
        if (nm.visits > 1 && eventsOf(events, 'NOMAD_PARLEY').length >= 2) {
          returned = true;
          break;
        }
      }
    } finally {
      spy.mockRestore();
    }
    expect(returned, 'the nomads came back').toBe(true);
    expect(nm.visits).toBe(2);

    // Their gift: MORE of the world than the first deal charted…
    const exploredAfter = storage.explored.filter(Boolean).length;
    expect(exploredAfter).toBeGreaterThan(exploredAtDeal);
    expect(eventsOf(events, 'NOMAD_RETURN_GIFT')).toHaveLength(1);

    // …their own return line, and no maps door (the chart WAS the gift).
    const parley = eventsOf(events, 'NOMAD_PARLEY').at(-1)!;
    expect(parley.data.leadKey).toBe(nm.currentClan!.returnLeadKey);
    const ids = parley.data.choices.map((c: any) => c.id);
    expect(ids).not.toContain('maps');
    expect(ids).toEqual(expect.arrayContaining(['tech', 'hire', 'pass']));
  });
});
