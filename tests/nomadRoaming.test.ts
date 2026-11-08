/**
 * Nomads — the roaming horde: wander, growth and the great split.
 *
 * The tribe's horde is a LIVING group on the map, not a scenery piece:
 *
 *   * it starts as THREE units and WANDERS the map toward the court — the
 *     walk zig-zags (drifts sideways) but never recedes from the target,
 *     so the contact-based envoy always lands,
 *   * and it walks as a PACK: nobody out-walks the slowest rider of the
 *     group (the scout's second stride is spent waiting), and the farthest
 *     two riders stay inside a tight ring for most of the walk,
 *   * once the parley has been ANSWERED, "later with more": the group
 *     gathers a rider every `NOMAD_GROWTH_ROUNDS` (the chest pays),
 *   * at `NOMAD_GROUP_SPLIT_SIZE` living wanderers the group DIVIDES into
 *     two cooperating camps (half each, splinter tents found nearby) —
 *     the tribe is capped at `NOMAD_MAX_CAMPS`, so never a third camp,
 *   * a settled camp KEEPS producing: one wanderer every
 *     `NOMAD_SETTLEMENT_MUSTER_ROUNDS` up to `NOMAD_SETTLEMENT_MUSTER_LIMIT`,
 *     those roam within `NOMAD_ROAM_LEASH` of the stakes, and the host city
 *     is paid `NOMAD_SETTLEMENT_TRADE_GOLD` per turn for its food.
 *
 * The three-spear meeting, the hire price and the war chest stay pinned in
 * the other nomad suites — growth here starts only after the answer, which
 * is exactly why those stay green.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeEngine } from './helpers/world';
import { UNIT_TYPES } from '@/data/UnitConstants';
import {
  NOMAD_CIV_ID,
  NOMAD_GROUP_SPLIT_SIZE,
  NOMAD_MAX_CAMPS,
  NOMAD_ROAM_LEASH,
  NOMAD_SETTLEMENT_MUSTER_LIMIT,
  NOMAD_SETTLEMENT_MUSTER_ROUNDS,
  NOMAD_SETTLEMENT_TRADE_GOLD,
  NOMAD_SPAWN_MIN_DISTANCE,
  NOMAD_SPLIT_DISTANCE,
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

/**
 * The visit is CONTACT-BASED: a player witness at the camp's gate makes the
 * envoy speak on a known round — spawn at NOMAD_TRIGGER_ROUND, the meeting
 * (and the parley) at +1. Remove the witness once the parley is answered.
 */
function meetCamp(engine: Engine, events: Array<{ type: string; data: any }>): any {
  const nm = engine.nomadManager;
  nm.processRound(NOMAD_TRIGGER_ROUND); // the camp appears
  const camp = nomadUnits(engine)[0];
  engine.units.push({
    id: 'witness', type: 'warriors', civilizationId: 0,
    col: camp.col < 19 ? camp.col + 1 : camp.col - 1, row: camp.row,
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

/** A parley ANSWERED (maps) and the gate cleared — the camp lingers. */
async function answered(): Promise<Harness & { nm: Engine['nomadManager'] }> {
  const h = await world();
  h.settle();
  meetCamp(h.engine, h.events);
  const nm = h.engine.nomadManager;
  expect(nm.resolveParley('maps').ok).toBe(true);
  leaveGate(h.engine);
  return { ...h, nm };
}

describe('Nomads — the wandering horde', () => {
  it('wanders the map toward the court — zig-zagging, never receding — and the envoy speaks only on contact', async () => {
    const { engine, events, settle } = await world();
    settle();
    const nm = engine.nomadManager;
    const city = engine.cities.find((c) => c.name === 'Haven')!;
    nm.processRound(NOMAD_TRIGGER_ROUND); // the camp appears in the fog

    const horde = nomadUnits(engine);
    expect(horde, 'the beginning: three units').toHaveLength(3);
    const distOf = (u: { col: number; row: number }) =>
      Math.max(Math.abs(u.col - city.col), Math.abs(u.row - city.row));
    expect(Math.min(...horde.map(distOf))).toBeGreaterThanOrEqual(NOMAD_SPAWN_MIN_DISTANCE);

    const seen = new Map(horde.map((u) => [u.id, { col: u.col, row: u.row, d: distOf(u) }]));
    let drifted = false;
    let parleyAt = -1;
    for (let r = NOMAD_TRIGGER_ROUND + 1; r <= 50; r++) {
      nm.processRound(r);
      if (eventsOf(events, 'NOMAD_PARLEY').length > 0) {
        parleyAt = r;
        break;
      }
      for (const u of nomadUnits(engine)) {
        const prev = seen.get(u.id);
        if (!prev) continue; // a muster on the road — not this test's business
        const d = distOf(u);
        expect(d, `round ${r}: the wander never recedes from the court`).toBeLessThanOrEqual(prev.d);
        if ((u.col !== prev.col || u.row !== prev.row) && d === prev.d) drifted = true;
        seen.set(u.id, { col: u.col, row: u.row, d });
      }
    }
    expect(parleyAt, 'the envoy arrives on CONTACT — their own walk, not a timer').toBeGreaterThan(0);
    expect(drifted, 'the walk WANDERS — sideways drift between closing steps').toBe(true);
    expect(eventsOf(events, 'NOMAD_PARLEY')).toHaveLength(1);
  });

  it('travels as ONE pack: nobody walks faster than the slowest rider, and the three stay close', async () => {
    const { engine, events, settle } = await world();
    settle();
    const nm = engine.nomadManager;
    nm.processRound(NOMAD_TRIGGER_ROUND);

    let previous = new Map(nomadUnits(engine).map((u) => [u.id, { col: u.col, row: u.row }]));
    let tightRounds = 0;
    let rounds = 0;
    let maxSpread = 0;
    let parleyAt = -1;

    for (let r = NOMAD_TRIGGER_ROUND + 1; r <= 50; r++) {
      nm.processRound(r);
      const horde = nomadUnits(engine);
      rounds += 1;

      // CLOSE: how far the farthest two riders of the horde stand apart.
      let spread = 0;
      for (const a of horde) {
        for (const b of horde) {
          spread = Math.max(spread, Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)));
        }
      }
      maxSpread = Math.max(maxSpread, spread);
      if (spread <= 3) tightRounds += 1;

      // IN STEP: the scout walks 2 while the spears walk 1, so without a
      // shared pace it covered twice the ground and reached the gate alone
      // with its mates a long way behind. Nobody may out-walk the slowest
      // rider of the group.
      const pace = Math.min(...horde.map((u) => u.maxMoves ?? 1));
      for (const u of horde) {
        const prev = previous.get(u.id);
        if (!prev) continue; // a rider mustered on the road — not this rule's business
        const moved = Math.max(Math.abs(u.col - prev.col), Math.abs(u.row - prev.row));
        expect(
          moved,
          `round ${r}: ${u.type} covered ${moved} tiles while the pack's pace is ${pace}`,
        ).toBeLessThanOrEqual(pace);
      }
      previous = new Map(horde.map((u) => [u.id, { col: u.col, row: u.row }]));

      if (eventsOf(events, 'NOMAD_PARLEY').length > 0) {
        parleyAt = r;
        break;
      }
    }

    expect(parleyAt, 'the pack still reaches the court').toBeGreaterThan(0);
    // …and it gets there as a group: most of the walk keeps the farthest two
    // riders inside a 3-tile ring, and nothing like a lone runner ever opens
    // a gap across the map.
    expect(tightRounds / Math.max(1, rounds), 'the horde walks in a knot').toBeGreaterThanOrEqual(0.5);
    expect(maxSpread, 'the horde never scatters').toBeLessThanOrEqual(8);
  });
});

describe('Nomads — growth and the great split', () => {
  it('after the answer the horde gathers riders — three grows toward six', async () => {
    const { engine, events, nm } = await answered();
    nm.treasury = 5000; // the chest never decides the cadence

    // Hold off the AI hire race (rng pinned high) — the horde stays the
    // tribe's. The muster clock runs from the world's round 0, so the
    // first rider lands two rounds after the answer.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= 22; r++) {
        nm.processRound(r);
        if (r === 6) expect(nomadUnits(engine), 'the cadence has not come round yet').toHaveLength(3);
        if (r === 7) expect(nomadUnits(engine), 'first rider — the chest paid').toHaveLength(4);
        if (r === 15) expect(nomadUnits(engine), 'second rider').toHaveLength(5);
      }
    } finally {
      spy.mockRestore();
    }
    expect(nomadUnits(engine)).toHaveLength(5);
    expect(eventsOf(events, 'NOMAD_SPLIT'), 'six is the divide, not five').toHaveLength(0);
  });

  it('at six the group splits into two cooperating camps — and never a third', async () => {
    const { engine, events, nm } = await answered();
    nm.treasury = 5000;

    // The linger timer is the departure's business, not the growth's: hold
    // the camp so the muster cadence can run past the split.
    for (const tents of (nm as unknown as { camps: Array<{ departAt: number | null }> }).camps) {
      tents.departAt = null; // every group is held, not just the first
    }
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    try {
      for (let r = NOMAD_TRIGGER_ROUND + 2; r <= 75; r++) nm.processRound(r);
    } finally {
      spy.mockRestore();
    }

    // THE SPLIT: exactly once, at full strength — half the horde walks to
    // the splinter's tents, the rest keeps the parent's.
    const splits = eventsOf(events, 'NOMAD_SPLIT');
    expect(splits, 'the camp outgrew its fire and divided').toHaveLength(1);
    expect(splits[0].data.count).toBe(Math.floor(NOMAD_GROUP_SPLIT_SIZE / 2));

    const camp = (nm as unknown as { camps: Array<{ col: number; row: number }> }).camps[0];
    expect(camp, 'the parent tents still stand').not.toBeNull();
    const splinter = { col: splits[0].data.col as number, row: splits[0].data.row as number };
    expect(
      Math.max(Math.abs(splinter.col - camp!.col), Math.abs(splinter.row - camp!.row)),
      'the splinter tents stand beside the parent camp',
    ).toBeLessThanOrEqual(NOMAD_SPLIT_DISTANCE);

    // Two cooperating groups around two fires — one tribe, one chest, and
    // the tribe's tents capped: both groups regrow to full strength, but
    // there is never a third camp.
    const horde = nomadUnits(engine);
    expect(horde).toHaveLength(NOMAD_MAX_CAMPS * NOMAD_GROUP_SPLIT_SIZE);
    expect(
      horde.filter((u) => u.col === splinter.col && u.row === splinter.row),
      'the splinter fire holds a full group',
    ).toHaveLength(NOMAD_GROUP_SPLIT_SIZE);
    expect(
      horde.filter((u) => u.col === camp!.col && u.row === camp!.row),
      'the parent fire holds a full group',
    ).toHaveLength(NOMAD_GROUP_SPLIT_SIZE);
    expect(eventsOf(events, 'NOMAD_SPLIT')).toHaveLength(1);
    expect(NOMAD_MAX_CAMPS).toBe(2); // the tribe's own ceiling, as pinned
  });

  it('a settled camp keeps producing — wanderers on a leash, trade for the host', async () => {
    const { engine, events, settle } = await world();
    settle();
    const nm = engine.nomadManager;
    const city = engine.cities.find((c) => c.name === 'Haven')!;
    const host = engine.civilizations[0];

    // Roll 0 passes EVERY clan's settle chance → the door appears.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      meetCamp(engine, events);
    } finally {
      spy.mockRestore();
    }
    expect(nm.resolveParley('settle')).toMatchObject({ ok: true, result: 'settle' });
    expect(nomadUnits(engine), 'the wanderers are home — the camp is gone').toHaveLength(0);

    // Where the stakes are: the flagged tile beside the city.
    let settlement: { col: number; row: number } | null = null;
    for (let dc = -3; dc <= 3 && !settlement; dc++) {
      for (let dr = -3; dr <= 3; dr++) {
        const t = engine.getTileAt(city.col + dc, city.row + dr);
        if (t?.nomadSettlement) {
          settlement = { col: t.col, row: t.row };
          break;
        }
      }
    }
    expect(settlement, 'a nomadSettlement tile exists beside the city').not.toBeNull();

    const goldBefore = host.resources.gold;
    // The camp moved in at NOMAD_TRIGGER_ROUND + 1 and starts its muster
    // clock then: one wanderer per cadence, the chest pays.
    const firstMuster = NOMAD_TRIGGER_ROUND + 1 + NOMAD_SETTLEMENT_MUSTER_ROUNDS;
    const secondMuster = firstMuster + NOMAD_SETTLEMENT_MUSTER_ROUNDS;
    let rounds = 0;
    for (let r = NOMAD_TRIGGER_ROUND + 2; r <= 45; r++) {
      nm.processRound(r);
      rounds += 1;
      for (const u of nomadUnits(engine)) {
        // The produced wanderers roam the map — but never past the leash
        // of the stakes, and never onto a city.
        expect(
          Math.max(Math.abs(u.col - settlement!.col), Math.abs(u.row - settlement!.row)),
          `round ${r}: a wanderer strayed from the stakes`,
        ).toBeLessThanOrEqual(NOMAD_ROAM_LEASH);
        expect(engine.getCityAt(u.col, u.row), `round ${r}: a wanderer stands on a city`).toBeNull();
      }
      if (r === firstMuster - 1) expect(nomadUnits(engine), 'the cadence has not come round').toHaveLength(0);
      if (r === firstMuster) expect(nomadUnits(engine), 'the camp produced its first wanderer').toHaveLength(1);
      if (r === secondMuster - 1) expect(nomadUnits(engine), 'still one — the cadence rules').toHaveLength(1);
      if (r === secondMuster) expect(nomadUnits(engine), 'the second').toHaveLength(2);
    }

    // The day market: gold into the host's purse EVERY round — exactly the
    // settlement's trade, and nothing else touches the player's purse here.
    expect(host.resources.gold - goldBefore).toBe(NOMAD_SETTLEMENT_TRADE_GOLD * rounds);
    // Production is capped: the camp never masses an army (the attempt one
    // cadence past the second is refused by the limit).
    expect(nomadUnits(engine)).toHaveLength(NOMAD_SETTLEMENT_MUSTER_LIMIT);
  });
});
