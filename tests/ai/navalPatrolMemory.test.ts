/**
 * NavalPatrolMemory — roadmap item 3 in `doc/AI_MEMORY.adoc`.
 *
 * Built bottom-up: every record is written and read through the module alone,
 * with no engine, no map and no units. The behaviour under test is the memory
 * contract itself — expiry, bounding, deterministic ranking, and the
 * "observations only, never state" rule.
 */
import { describe, it, expect } from 'vitest';
import { NavalPatrolMemory } from '@/game/engine/AI/NavalPatrolMemory';

describe('swept water — the fix for hulls milling in one corner', () => {
  it('treats never-patrolled water as the best patrol target', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(5);
    expect(m.sweepPriority(9, 9)).toBe(0);
    m.recordSweep(9, 9);
    expect(m.sweepPriority(9, 9)).toBeGreaterThan(0);
    expect(m.sweepPriority(8, 8)).toBe(0);
  });

  it('ranks less-recently-swept water ahead of stale water', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordSweep(5, 5);   // swept on turn 1
    m.recordTurn(9);
    m.recordSweep(6, 6);   // swept on turn 9
    expect(m.sweepPriority(5, 5)).toBeGreaterThan(m.sweepPriority(6, 6));
    // The stale tile is still preferred over one swept on the current turn.
    expect(m.sweepPriority(6, 6)).toBeLessThanOrEqual(1);
  });

  it('returns the turn a tile was last patrolled', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(3);
    m.recordSweep(4, 4);
    expect(m.lastSweptTurn(4, 4)).toBe(3);
    expect(m.lastSweptTurn(5, 5)).toBeNull();
  });

  it('ignores coordinates outside the map instead of corrupting the ledger', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordSweep(-1, 5);
    m.recordSweep(5, -1);
    m.recordSweep(99999, 5);
    m.recordSweep(1.5, 2);
    expect(m.sweepCount()).toBe(0);
    expect(m.sweepPriority(-1, 5)).toBe(0); // still "never swept"
  });

  it('caps the sweep map and forgets the stalest tiles first', () => {
    const m = new NavalPatrolMemory({ maxSweeps: 4 });
    m.recordTurn(1);
    for (let i = 0; i < 10; i++) m.recordSweep(i, 0);
    expect(m.sweepCount()).toBe(4);
    // The four most recently swept survive; the earliest are gone.
    expect(m.lastSweptTurn(0, 0)).toBeNull();
    expect(m.lastSweptTurn(9, 0)).toBe(1);
  });

  it('expires sweeps past the TTL on a turn boundary', () => {
    const m = new NavalPatrolMemory({ sweepTtlTurns: 5 });
    m.recordTurn(1);
    m.recordSweep(3, 3);
    m.recordTurn(5);
    expect(m.sweepCount()).toBe(1);
    m.recordTurn(7); // 6 turns old > TTL 5
    expect(m.sweepCount()).toBe(0);
    expect(m.getLedger().pruned).toBe(1);
  });
});

describe('enemy contacts — a hull can sail to where it last saw a raider', () => {
  const sighting = (over: Partial<Parameters<NavalPatrolMemory['recordContact']>[0]> = {}) => ({
    enemyCivId: 2, col: 10, row: 10, type: 'frigate', strength: 4, ...over,
  });

  it('stores a sighting with its turn and a first sighting count', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(7);
    const c = m.recordContact(sighting());
    expect(c).toMatchObject({ enemyCivId: 2, col: 10, row: 10, turn: 7, sightings: 1 });
    expect(m.contactsFor(2)).toHaveLength(1);
  });

  it('merges repeat sightings of the same hull instead of piling them up', () => {
    const m = new NavalPatrolMemory({ contactMergeRadius: 2 });
    m.recordTurn(1);
    m.recordContact(sighting({ col: 10, row: 10 }));
    m.recordTurn(2);
    const merged = m.recordContact(sighting({ col: 11, row: 11, strength: 5 }));
    expect(m.contactsFor(2)).toHaveLength(1);
    expect(merged?.sightings).toBe(2);
    // Newest position wins outright, so the fleet tracks a fleeing raider.
    expect(merged).toMatchObject({ col: 11, row: 11, turn: 2 });
  });

  it('keeps genuinely separate sightings apart', () => {
    const m = new NavalPatrolMemory({ contactMergeRadius: 2 });
    m.recordTurn(1);
    m.recordContact(sighting({ col: 10, row: 10 }));
    m.recordContact(sighting({ col: 30, row: 30 }));
    expect(m.contactsFor(2)).toHaveLength(2);
  });

  it('decays value with age and refuses to answer past the TTL', () => {
    const m = new NavalPatrolMemory({ contactTtlTurns: 4 });
    m.recordTurn(10);
    const fresh = m.recordContact(sighting())!;
    m.recordTurn(11);
    const older = m.contactsFor(2)[0];
    expect(m.contactScore(fresh, 10)).toBeGreaterThan(m.contactScore(older, 11));
    m.recordTurn(20);
    expect(m.contactScore(older, 20)).toBe(0);
  });

  it('values a loaded transport above a bare warship of equal freshness', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    const transport = m.recordContact(sighting({ transportCapacity: 2, strength: 0 }))!;
    const warship = m.recordContact(sighting({ col: 20, row: 20, transportCapacity: 0, strength: 4 }))!;
    expect(m.contactScore(transport)).toBeGreaterThan(m.contactScore(warship));
  });

  it('rewards repeat sightings but caps the confidence bonus', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    const once = m.recordContact(sighting({ col: 40, row: 40 }))!;
    for (let i = 2; i <= 20; i++) {
      m.recordTurn(i);
      m.recordContact(sighting({ col: 40 + i, row: 40 }));
    }
    const many = m.contactsFor(2).find((c) => c.col === 60)!;
    expect(many.sightings).toBe(20);
    const ratio = m.contactScore(many, 20) / m.contactScore(once, 1);
    expect(ratio).toBeLessThan(2); // capped, never unbounded
  });

  it('picks the best contact and honours the hostility filter', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(5);
    m.recordContact({ enemyCivId: 2, col: 1, row: 1, strength: 9 });
    m.recordContact({ enemyCivId: 3, col: 2, row: 2, transportCapacity: 3 });

    const hostile = m.bestContact({
      turn: 5,
      hostileTo: (civId) => civId === 3,
    });
    expect(hostile?.enemyCivId).toBe(3);

    // A civ we are at peace with is never a thing to sail toward.
    expect(m.bestContact({ turn: 5, hostileTo: () => false })).toBeNull();
    // With no filter at all the better sighting wins: a transport carrying 3
    // outranks a warship of strength 9, which is the same ordering the live
    // naval target score applies.
    expect(m.bestContact({ turn: 5 })?.enemyCivId).toBe(3);
  });

  it('forgets contacts individually and per-enemy', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordContact({ enemyCivId: 2, col: 1, row: 1 });
    m.recordContact({ enemyCivId: 2, col: 50, row: 50 });
    expect(m.forgetContact(2, 1, 1)).toBe(true);
    expect(m.contactsFor(2)).toHaveLength(1);
    m.recordContact({ enemyCivId: 4, col: 3, row: 3 });
    m.forgetEnemy(4);
    expect(m.contactsFor(4)).toHaveLength(0);
    expect(m.forgetContact(2, 999, 999)).toBe(false);
  });

  it('caps contacts per enemy civ, dropping the oldest', () => {
    const m = new NavalPatrolMemory({ maxContactsPerCiv: 3 });
    m.recordTurn(1);
    for (let i = 0; i < 6; i++) {
      m.recordTurn(i);
      m.recordContact({ enemyCivId: 2, col: i * 5, row: 0 });
    }
    const kept = m.contactsFor(2);
    expect(kept).toHaveLength(3);
    // Newest first.
    expect(kept[0].col).toBe(25);
  });

  it('drops a contact list entirely once every sighting is stale', () => {
    const m = new NavalPatrolMemory({ contactTtlTurns: 2 });
    m.recordTurn(1);
    m.recordContact({ enemyCivId: 2, col: 1, row: 1 });
    m.recordTurn(10);
    expect(m.contactsFor(2)).toHaveLength(0);
    expect(m.bestContact({ turn: 10 })).toBeNull();
  });
});

describe('danger water — hulls steer around where they died', () => {
  it('applies pressure on the loss tile and inside the radius only', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordDanger(10, 10, 1, 1);
    expect(m.dangerPressure(10, 10)).toBeGreaterThan(0);
    expect(m.dangerPressure(11, 10)).toBeGreaterThan(0);  // inside radius 1
    expect(m.dangerPressure(20, 20)).toBe(0);             // far outside
  });

  it('accumulates repeated losses into one zone', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordDanger(5, 5, 1);
    m.recordDanger(5, 5, 1);
    const zone = m.activeDangerZones()[0];
    expect(zone.losses).toBe(2);
    expect(m.dangerPressure(5, 5)).toBeGreaterThan(1.5);
  });

  it('widens an existing zone but never narrows it', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordDanger(5, 5, 1, 3);
    const zone = m.recordDanger(5, 5, 1, 1)!;
    expect(zone.radius).toBe(3);
  });

  it('decays pressure and then forgets the zone entirely', () => {
    const m = new NavalPatrolMemory({ dangerTtlTurns: 5 });
    m.recordTurn(1);
    m.recordDanger(7, 7, 1, 0);
    const fresh = m.dangerPressure(7, 7, 1);
    expect(fresh).toBe(1);
    // Pressure fades every turn but the zone is still there on turn 6.
    expect(m.dangerPressure(7, 7, 5)).toBeLessThan(fresh);
    expect(m.dangerPressure(7, 7, 6)).toBeGreaterThan(0);
    // One turn past the TTL it is gone entirely.
    m.recordTurn(7);
    expect(m.dangerPressure(7, 7)).toBe(0);
    expect(m.activeDangerZones()).toHaveLength(0);
    expect(m.getLedger().pruned).toBeGreaterThan(0);
  });

  it('caps zones, keeping the ones with the most losses', () => {
    const m = new NavalPatrolMemory({ maxDangerZones: 2 });
    m.recordTurn(1);
    m.recordDanger(1, 1, 1);            // 1 loss
    m.recordDanger(2, 2, 1);
    m.recordDanger(3, 3, 1);
    m.recordDanger(3, 3, 1);
    m.recordDanger(3, 3, 1);            // 3 losses — must survive the cap
    const zones = m.activeDangerZones();
    expect(zones).toHaveLength(2);
    expect(zones.some((z) => z.col === 3)).toBe(true);
  });
});

describe('sealift runs — which ferry is loaded, and who screens it', () => {
  const run = (id: string, over: Partial<Parameters<NavalPatrolMemory['recordSealift']>[0]> = {}) => ({
    transportId: id, col: 1, row: 1, targetCol: 20, targetRow: 20,
    cargo: 2, startedTurn: 1, mission: 'invasion' as const, ...over,
  });

  it('stores a run and reads it back by transport', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordSealift(run('t1'));
    expect(m.sealiftFor('t1')).toMatchObject({ transportId: 't1', cargo: 2, mission: 'invasion' });
  });

  it('pairs an escort with its transport and finds it from the escort side', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordSealift(run('t1'));
    m.assignEscort('t1', 'w1');
    expect(m.sealiftFor('t1')?.escortId).toBe('w1');
    expect(m.transportEscortedBy('w1')?.transportId).toBe('t1');
    expect(m.transportEscortedBy('w2')).toBeNull();
  });

  it('updates a run in place without losing its identity', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordSealift(run('t1'));
    const next = m.updateSealift('t1', { col: 5, cargo: 1 })!;
    expect(next).toMatchObject({ transportId: 't1', col: 5, cargo: 1, mission: 'invasion' });
    expect(m.updateSealift('nope', { cargo: 9 })).toBeNull();
  });

  it('clears a run when the landing is done', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordSealift(run('t1'));
    expect(m.clearSealift('t1')).toBe(true);
    expect(m.clearSealift('t1')).toBe(false);
    expect(m.activeSealifts()).toHaveLength(0);
  });

  it('prunes runs whose transport is no longer in the roster', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.recordSealift(run('t1'));
    m.recordSealift(run('t2'));
    m.recordSealift(run('t3'));
    expect(m.pruneSealifts(['t1', 't3'])).toBe(1);
    expect(m.activeSealifts().map((r) => r.transportId)).toEqual(['t1', 't3']);
  });

  it('hides a run that has been at sea past its TTL', () => {
    const m = new NavalPatrolMemory({ sealiftTtlTurns: 4 });
    m.recordTurn(1);
    m.recordSealift(run('t1'));
    expect(m.activeSealifts(3)).toHaveLength(1);
    expect(m.activeSealifts(20)).toHaveLength(0);
  });

  it('caps the number of runs in flight', () => {
    const m = new NavalPatrolMemory({ maxSealifts: 3 });
    m.recordTurn(1);
    for (let i = 0; i < 6; i++) m.recordSealift(run(`t${i}`, { startedTurn: i }));
    expect(m.activeSealifts()).toHaveLength(3);
    // Newest runs survive.
    expect(m.activeSealifts().map((r) => r.transportId)).toEqual(['t5', 't4', 't3']);
  });
});

describe('hull intent — AI bookkeeping kept off the Unit object', () => {
  it('stores, reads and clears a hull intent', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(4);
    m.setIntent('w1', { col: 5, row: 5, dist: 10, stalled: 0 });
    expect(m.intentFor('w1')).toMatchObject({ dist: 10, stalled: 0, turn: 4 });
    expect(m.clearIntent('w1')).toBe(true);
    expect(m.intentFor('w1')).toBeUndefined();
  });

  it('counts consecutive stalled turns so a hull gives up', () => {
    const m = new NavalPatrolMemory();
    m.recordTurn(1);
    m.setIntent('w1', { col: 9, row: 9, dist: 4, stalled: 0 });
    const prev = m.intentFor('w1')!;
    // The same objective, no progress → one more stalled turn.
    const stalled = prev.dist <= 4 ? prev.stalled + 1 : 0;
    m.setIntent('w1', { col: 9, row: 9, dist: 4, stalled });
    expect(m.intentFor('w1')?.stalled).toBe(1);
    // Progress resets the counter.
    m.setIntent('w1', { col: 9, row: 9, dist: 2, stalled: 0 });
    expect(m.intentFor('w1')?.stalled).toBe(0);
  });

  it('prunes intents for hulls that no longer exist', () => {
    const m = new NavalPatrolMemory();
    m.setIntent('w1', { col: 1, row: 1, dist: 1, stalled: 0 });
    m.setIntent('w2', { col: 1, row: 1, dist: 1, stalled: 0 });
    expect(m.pruneIntents(['w1'])).toBe(1);
    expect(m.intentFor('w1')).toBeDefined();
    expect(m.intentFor('w2')).toBeUndefined();
  });
});

describe('the ledger stays bounded over a long game', () => {
  it('does not grow without limit across 400 turns of noise', () => {
    const m = new NavalPatrolMemory({
      maxSweeps: 50, maxContactsPerCiv: 4, maxDangerZones: 5, maxSealifts: 3,
    });
    for (let turn = 1; turn <= 400; turn++) {
      m.recordTurn(turn);
      m.recordSweep(turn % 120, Math.floor(turn / 120));
      m.recordContact({ enemyCivId: 2, col: turn % 60, row: Math.floor(turn / 60) % 60 });
      m.recordContact({ enemyCivId: 3, col: (turn * 7) % 60, row: (turn * 3) % 60 });
      m.recordDanger(turn % 40, Math.floor(turn / 40) % 40, turn, 1);
      if (turn % 10 === 0) m.recordSealift({
        transportId: `t${turn}`, col: 1, row: 1, targetCol: 2, row2: 0,
        targetRow: 2, cargo: 1, startedTurn: turn, mission: 'colony',
      } as never);
    }
    const l = m.getLedger();
    expect(l.sweeps).toBeLessThanOrEqual(50);
    expect(l.contacts).toBeLessThanOrEqual(8);       // 2 civs × 4
    expect(l.dangerZones).toBeLessThanOrEqual(5);
    expect(l.sealifts).toBeLessThanOrEqual(3);
    expect(l.turns).toBe(400);
    expect(l.pruned).toBeGreaterThan(0);
  });

  it('starts empty and reports its own turn', () => {
    const m = new NavalPatrolMemory();
    expect(m.getLedger()).toMatchObject({
      turns: 0, sweeps: 0, contacts: 0, dangerZones: 0, sealifts: 0, intents: 0,
    });
    m.recordTurn(42);
    expect(m.currentTurnNumber()).toBe(42);
  });
});
