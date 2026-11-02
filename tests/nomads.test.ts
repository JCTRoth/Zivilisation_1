/**
 * Nomads — the opening visitors.
 *
 * The parley is a small state machine: a neutral horde camps near the
 * single human's first city, an envoy arrives two rounds later, the player
 * picks one of four doors, and whatever was taken the camp still stands —
 * long enough for any AI court to hire it before it walks off.
 *
 * Pinned here:
 *   * trigger and spawn (distance, landmass, neutral id, fortification),
 *   * the four doors and their promised terms (price/tech are what the
 *     BUTTON said, never re-rolled),
 *   * the AI hire race and the departure timer,
 *   * the skip conditions (hotseat, all-AI) and the no-city fallback,
 *   * dismissal re-offers on proximity, never every round.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeEngine } from './helpers/world';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import {
  NOMAD_AI_HIRE_MIN_ROUND_GAP,
  NOMAD_PASS_DEPART_ROUNDS,
  NOMAD_PARLEY_DELAY_ROUNDS,
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

const nomadUnits = (engine: Engine) =>
  engine.units.filter((u) => u.civilizationId === BARBARIAN_CIV_ID && !u.isDefeated);

const eventsOf = (events: Array<{ type: string; data: any }>, type: string) =>
  events.filter((e) => e.type === type);

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
  /** Spawn + advance to the envoy's arrival (spawn round + delay). */
  async function atGate(): Promise<Harness & { parley: any }> {
    const h = await world();
    h.settle();
    h.engine.nomadManager.processRound(NOMAD_TRIGGER_ROUND);
    for (let r = NOMAD_TRIGGER_ROUND + 1; r < NOMAD_TRIGGER_ROUND + NOMAD_PARLEY_DELAY_ROUNDS + 1; r++) {
      h.engine.nomadManager.processRound(r);
    }
    const parley = eventsOf(h.events, 'NOMAD_PARLEY').at(-1);
    expect(parley, 'the envoy must have arrived').toBeDefined();
    return { ...h, parley };
  }

  it('the envoy arrives with four doors and a named speaker', async () => {
    const { parley } = await atGate();
    expect(parley.data.speakerNameKey).toBe('nomad.chieftain');
    expect(parley.data.leadKey).toBe('nomad.parley.lead');
    const ids = parley.data.choices.map((c: any) => c.id);
    expect(ids).toEqual(['tech', 'maps', 'hire', 'pass']);
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
    expect(nomadUnits(engine).every((u) => u.civilizationId === BARBARIAN_CIV_ID)).toBe(true);
  });

  it('passing in peace sends them off after the short timer', async () => {
    const { engine, events } = await atGate();
    const nm = engine.nomadManager;
    const outcome = nm.resolveParley('pass');
    expect(outcome).toMatchObject({ ok: true, result: 'pass' });

    nm.processRound(NOMAD_TRIGGER_ROUND + NOMAD_PARLEY_DELAY_ROUNDS + NOMAD_PASS_DEPART_ROUNDS);
    expect(nm.isDeparted).toBe(true);
    expect(nomadUnits(engine)).toHaveLength(0);
    expect(eventsOf(events, 'NOMAD_DEPARTED')).toHaveLength(1);
  });

  it('a dismissed envoy re-offers when the player stands at the camp — not every round', async () => {
    const { engine, events } = await atGate();
    const nm = engine.nomadManager;
    const camp = nomadUnits(engine)[0];

    // Dismissal: the player walks away (no resolve) — no re-offer in place.
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
    expect(ids).toEqual(['tech', 'maps', 'hire', 'pass']);
  });
});

describe('Nomads — the race and the departure', () => {
  it('any AI court may hire the camp after the parley; it then belongs to them', async () => {
    const { engine, events } = await (async () => {
      const h = await world();
      h.settle();
      h.engine.nomadManager.processRound(NOMAD_TRIGGER_ROUND);
      for (let r = 5; r < 7; r++) h.engine.nomadManager.processRound(r);
      return h;
    })();
    const nm = engine.nomadManager;
    nm.resolveParley('maps'); // dealt — the camp lingers
    engine.civilizations[1].resources.gold = 500;

    const spy = vi.spyOn(Math, 'random').mockReturnValue(0); // guaranteed win
    try {
      nm.processRound(7 + NOMAD_AI_HIRE_MIN_ROUND_GAP);
    } finally {
      spy.mockRestore();
    }
    expect(nm.isHired).toBe(true);
    expect(nomadUnits(engine).every((u) => u.civilizationId === 1)).toBe(true);
    const hired = eventsOf(events, 'NOMAD_HIRED');
    expect(hired).toHaveLength(1);
    expect(hired[0].data.civId).toBe(1);
  });

  it('with nobody hiring, the dealt-with camp walks off on the linger timer', async () => {
    const { engine, events } = await (async () => {
      const h = await world();
      h.settle();
      h.engine.nomadManager.processRound(NOMAD_TRIGGER_ROUND);
      for (let r = 5; r < 7; r++) h.engine.nomadManager.processRound(r);
      return h;
    })();
    const nm = engine.nomadManager;
    nm.resolveParley('maps');
    // AI never wins the roll (Math.random pinned high), no player nearby.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      for (let r = 8; r < 40; r++) nm.processRound(r);
    } finally {
      spy.mockRestore();
    }
    expect(nm.isDeparted).toBe(true);
    expect(nomadUnits(engine)).toHaveLength(0);
    expect(eventsOf(events, 'NOMAD_DEPARTED')).toHaveLength(1);
  });
});
