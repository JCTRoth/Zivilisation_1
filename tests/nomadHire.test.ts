/**
 * Nomads — hiring under THE GATE RULE, and the snapshot the diplomacy hall
 * reads.
 *
 * Pinned here:
 *   * the hire door sells ONLY the riders who stand with you (on your city's
 *     tile or beside your unit) — the rest of the tribe keeps its tents and
 *     its neutrality,
 *   * the price is five times those riders' build cost (× the clan's
 *     factor), not a bargain for a whole horde,
 *   * with nobody at the gate there is no door at all, and answering one
 *     from afar changes nothing (`notMeeting`),
 *   * `hallState` reports who they are, where they are and what is on the
 *     table — read-only, so the hall can never nudge the state machine.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeEngine } from './helpers/world';
import { UNIT_TYPES } from '@/data/UnitConstants';
import {
  NOMAD_CIV_ID,
  NOMAD_REOFFER_COOLDOWN_ROUNDS,
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

/** The camp's HORDE — the tribe's own wanderers, never its bazaars. */
const nomadUnits = (engine: Engine) =>
  engine.units.filter(
    (u) =>
      u.civilizationId === NOMAD_CIV_ID
      && !u.isDefeated
      && u.type !== UNIT_TYPES.NOMAD_CARAVAN,
  );

const eventsOf = (events: Array<{ type: string; data: any }>, type: string) =>
  events.filter((e) => e.type === type);

/** A player unit, pushed straight onto a tile (tests bypass the move rules). */
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

/** A tile two steps from `at` that stays inside the 20×20 test map. */
const twoStepsFrom = (at: number): number => (at < 10 ? at + 2 : at - 2);

describe('Nomads — the hire door obeys the gate', () => {
  it('sells only the riders who stand with you, at five times their build cost', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;

    // Math.random pinned → clan index 0 (the Bedouin, hire factor 1.0) and
    // every later roll in the round deterministic.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      nm.processRound(NOMAD_TRIGGER_ROUND); // the camp appears

      const horde = nomadUnits(h.engine);
      expect(horde).toHaveLength(3);
      const city = h.engine.cities[0];
      const envoy = horde[0];
      // ONE rider walks onto the city; the other two stay at the tents.
      envoy.col = city.col;
      envoy.row = city.row;
      h.engine.units.push(playerUnit('garrison', city.col, city.row));

      nm.processRound(NOMAD_TRIGGER_ROUND + 1); // contact → the envoy speaks
      const parley = eventsOf(h.events, 'NOMAD_PARLEY').at(-1);
      expect(parley, 'the envoy must have arrived').toBeDefined();

      const hire = parley.data.choices.find((c: any) => c.id === 'hire');
      expect(hire, 'the gate is open, so the door is tabled').toBeDefined();
      // The rider you met: build cost 10 × NOMAD_HIRE_COST_FACTOR (5) × 1.0.
      expect(hire.labelParams).toEqual({ gold: 50, count: 1 });

      h.engine.civilizations[0].resources.gold = 500;
      const outcome = nm.resolveParley('hire');
      expect(outcome).toMatchObject({
        ok: true,
        result: 'hire',
        params: { gold: 50, count: 1 },
      });
      expect(h.engine.civilizations[0].resources.gold).toBe(450);

      // The rider you met is yours…
      expect(envoy.civilizationId).toBe(0);
      expect(envoy.isFortified).toBe(false);
      // …and the two you never met are still theirs, still neutral.
      const rest = nomadUnits(h.engine);
      expect(rest).toHaveLength(2);
      expect(rest.every((u) => u.civilizationId === NOMAD_CIV_ID)).toBe(true);
      expect(rest.every((u) => u.isFortified)).toBe(true);

      // The tribe keeps its tents: the camp outlives the sale of one rider.
      expect(nm.isHired).toBe(true);
      expect(nm.campTile).not.toBeNull();
      expect(nm.isParleyDone).toBe(true);
      expect(nm.currentStanding).toBe('friendly');
    } finally {
      spy.mockRestore();
    }
  });

  it('tables no hire door when nobody stands with you — and refuses one from afar', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;

    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      nm.processRound(NOMAD_TRIGGER_ROUND);
      const camp = nomadUnits(h.engine)[0];

      // The envoy speaks: a witness stands WITH the horde.
      h.engine.units.push(playerUnit('witness', camp.col, camp.row));
      nm.processRound(NOMAD_TRIGGER_ROUND + 1);
      expect(eventsOf(h.events, 'NOMAD_PARLEY')).toHaveLength(1);
      expect(nm.isDirectlyMeeting()).toBe(true);

      // The player walks away — two tiles out, still near the tents, but
      // standing with nobody. The audience re-offers (proximity is not a
      // meeting)…
      h.engine.units = h.engine.units.filter((u) => u.id !== 'witness');
      h.engine.units.push(
        playerUnit('visitor', twoStepsFrom(camp.col), camp.row),
      );
      nm.processRound(NOMAD_TRIGGER_ROUND + 1 + NOMAD_REOFFER_COOLDOWN_ROUNDS);

      const reoffered = eventsOf(h.events, 'NOMAD_PARLEY').at(-1);
      expect(reoffered, 'the envoy re-offers on proximity').toBeDefined();
      const ids = reoffered.data.choices.map((c: any) => c.id);
      expect(ids, 'nothing is for sale from two tiles away').not.toContain('hire');
      expect(ids).toContain('pass');

      // …and answering the old door from out there changes nothing.
      const outcome = nm.resolveParley('hire');
      expect(outcome).toEqual({ ok: false, result: 'notMeeting' });
      expect(nomadUnits(h.engine).every((u) => u.civilizationId === NOMAD_CIV_ID)).toBe(true);
      expect(nm.currentStanding).toBe('neutral');
      expect(nm.isDirectlyMeeting()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Nomads — the diplomacy hall snapshot', () => {
  it('reports who they are, where they are and what is on the table', async () => {
    const h = await world();
    h.settle();
    const nm = h.engine.nomadManager;

    // Before the visit: nothing to list.
    expect(nm.hallState).toMatchObject({
      known: false,
      clanId: null,
      standing: 'neutral',
      meeting: false,
      choices: null,
      campTile: null,
    });
    expect(nm.isDirectlyMeeting()).toBe(false);

    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      nm.processRound(NOMAD_TRIGGER_ROUND);

      // Sighted: the hall lists them — but nobody has walked up yet, so
      // there is reading and no dealing.
      const seen = nm.hallState;
      expect(seen.known).toBe(true);
      expect(seen.clanId).toBe('bedouin');
      expect(seen.nameKey).toBe('nomad.clan.bedouin.name');
      expect(seen.epithetKey).toBe('nomad.clan.bedouin.epithet');
      expect(seen.image).toBe('/assets/nomads/bedouin.png');
      expect(seen.standing).toBe('neutral');
      expect(seen.meeting).toBe(false);
      expect(seen.choices).toBeNull();
      expect(seen.campTile).toEqual(nm.campTile);
      expect(seen.visits).toBe(1);

      // At the gate: the doors are on the table and the meeting is flagged.
      const camp = nomadUnits(h.engine)[0];
      h.engine.units.push(playerUnit('witness', camp.col, camp.row));
      nm.processRound(NOMAD_TRIGGER_ROUND + 1);

      const atGate = nm.hallState;
      expect(atGate.meeting).toBe(true);
      expect(nm.isDirectlyMeeting()).toBe(true);
      expect(atGate.choices?.map((c) => c.id)).toEqual(
        expect.arrayContaining(['tech', 'maps', 'hire', 'pass']),
      );

      // The snapshot is a copy: the hall must not be able to reach in.
      atGate.choices?.pop();
      expect(nm.hallState.choices?.map((c) => c.id)).toContain('hire');
    } finally {
      spy.mockRestore();
    }
  });
});
