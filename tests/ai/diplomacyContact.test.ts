/**
 * Diplomacy contact ("who has met whom").
 *
 * Contact used to be implicit: every civ had a relation record from turn 1 and
 * `getStatus` never returned undefined, so the game treated everyone as already
 * met. These tests pin the replacement: contact is discovered by sight, is a
 * pair fact, never includes barbarians, survives save/load, and is what gates
 * the research "known tech" discount.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '../../src/game/engine/GameEngine';
import { ResearchManager } from '../../src/game/engine/ResearchManager';

const MAP_W = 20;
const MAP_H = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeEngine(): any {
  const engine: any = new GameEngine();
  engine.map = { width: MAP_W, height: MAP_H };
  engine.squareGrid = {
    width: MAP_W,
    height: MAP_H,
    isValidSquare: (c: number, r: number) => c >= 0 && r >= 0 && c < MAP_W && r < MAP_H,
  };
  engine.civilizations = [
    { id: 0, name: 'Human', isHuman: true, isAlive: true, technologies: [] },
    { id: 1, name: 'Aztecs', isHuman: false, isAlive: true, technologies: [] },
    { id: 2, name: 'Romans', isHuman: false, isAlive: true, technologies: [] },
  ];
  engine.units = [];
  engine.cities = [];
  engine.devMode = false;
  engine.playerStorage = new Map();
  for (let id = 0; id < 3; id++) {
    engine.playerStorage.set(id, {
      visibility: new Array(MAP_W * MAP_H).fill(false),
      explored: new Array(MAP_W * MAP_H).fill(false),
      lastKnownUnits: new Map(),
      lastKnownCities: new Map(),
      enemyLocations: new Map(),
      scoutZones: [],
      turnData: {},
    });
  }
  engine.diplomacyManager.initialize([0, 1, 2]);
  return engine;
}

function makeUnit(id: string, civilizationId: number, col: number, row: number) {
  return { id, civilizationId, col, row, type: 'warrior', moves: 1, maxMoves: 1, hp: 100 };
}

describe('DiplomacyManager contact bookkeeping', () => {
  it('records a new contact once, then reports it as known', () => {
    const engine = makeEngine();
    const dm = engine.diplomacyManager;

    expect(dm.hasContacted(0, 1)).toBe(false);
    expect(dm.markContact(0, 1)).toBe(true);
    expect(dm.hasContacted(0, 1)).toBe(true);
    // Symmetric: contact is a property of the pair.
    expect(dm.hasContacted(1, 0)).toBe(true);
    // Second time is not "new" any more.
    expect(dm.markContact(0, 1)).toBe(false);
    expect(dm.markContact(1, 0)).toBe(false);
  });

  it('never records barbarians or unknown pairs', () => {
    const engine = makeEngine();
    const dm = engine.diplomacyManager;

    expect(dm.markContact(0, -1)).toBe(false);
    expect(dm.markContact(-1, 0)).toBe(false);
    // A civ with no relation record (e.g. not in the game) is refused.
    expect(dm.markContact(0, 99)).toBe(false);
  });

  it('lists only met civs', () => {
    const engine = makeEngine();
    const dm = engine.diplomacyManager;

    dm.markContact(0, 2);
    expect(dm.getMetCivs(0)).toEqual([2]);
    expect(dm.getMetCivs(2)).toEqual([0]);
    expect(dm.getMetCivs(1)).toEqual([]);
  });

  it('clears contact on reset and on re-initialize', () => {
    const engine = makeEngine();
    const dm = engine.diplomacyManager;

    dm.markContact(0, 1);
    dm.reset();
    expect(dm.hasContacted(0, 1)).toBe(false);

    dm.markContact(0, 1);
    dm.initialize([0, 1, 2]);
    expect(dm.hasContacted(0, 1)).toBe(false);
  });

  it('round-trips through export/restore and can backfill old saves', () => {
    const engine = makeEngine();
    const dm = engine.diplomacyManager;

    dm.markContact(0, 2);
    const exported = dm.exportContactedPairs();

    dm.initialize([0, 1, 2]);
    expect(dm.hasContacted(0, 2)).toBe(false);

    dm.restoreContactedPairs(exported);
    expect(dm.hasContacted(0, 2)).toBe(true);
    expect(dm.hasContacted(0, 1)).toBe(false);

    dm.markAllContactsMet();
    expect(dm.hasContacted(0, 1)).toBe(true);
    expect(dm.hasContacted(1, 2)).toBe(true);
  });
});

describe('contact discovered by sight', () => {
  it('marks contact when a foreign unit is inside sight range', () => {
    const engine = makeEngine();
    engine.units = [makeUnit('scout', 0, 5, 5), makeUnit('enemy', 1, 6, 5)];

    engine.updatePlayerVisibility(0);

    expect(engine.diplomacyManager.hasContacted(0, 1)).toBe(true);
    // Sight is one-way knowledge, but the pair is marked: the observed civ has
    // not necessarily seen the observer yet, and we accept that simplification.
    expect(engine.diplomacyManager.hasContacted(1, 0)).toBe(true);
  });

  it('marks contact when a foreign city is inside vision', () => {
    const engine = makeEngine();
    engine.units = [makeUnit('scout', 0, 5, 5)];
    engine.cities = [{ id: 'c1', name: 'Tenochtitlan', civilizationId: 1, col: 7, row: 5 }];

    engine.updatePlayerVisibility(0);

    expect(engine.diplomacyManager.hasContacted(0, 1)).toBe(true);
  });

  it('does not mark contact for something beyond sight range', () => {
    const engine = makeEngine();
    engine.units = [makeUnit('scout', 0, 5, 5), makeUnit('enemy', 1, 12, 5)];

    engine.updatePlayerVisibility(0);

    expect(engine.diplomacyManager.hasContacted(0, 1)).toBe(false);
  });

  it('does not mark contact with barbarians (negative ids)', () => {
    const engine = makeEngine();
    engine.units = [makeUnit('scout', 0, 5, 5), makeUnit('barb', -1, 6, 5)];

    engine.updatePlayerVisibility(0);

    expect(engine.diplomacyManager.exportContactedPairs()).toEqual([]);
  });

  it('announces first contact to the human but stays silent for AI vs AI', () => {
    const engine = makeEngine();
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    engine.onStateChange = (type: string, data: Record<string, unknown>) => events.push({ type, data });

    // AI vs AI meeting — recorded, not announced.
    engine.units = [makeUnit('roman', 2, 5, 5), makeUnit('aztec', 1, 6, 5)];
    engine.updatePlayerVisibility(2);
    expect(engine.diplomacyManager.hasContacted(1, 2)).toBe(true);
    expect(events.filter(e => e.type === 'DIPLOMACY_EVENT')).toHaveLength(0);

    // Human sees the Aztecs — announced once. (The scout's sight also reaches
    // the Roman unit, so both meetings are announced, but each exactly once.)
    engine.units.push(makeUnit('scout', 0, 6, 6));
    engine.updatePlayerVisibility(0);
    const diplomacyEvents = events.filter(e => e.type === 'DIPLOMACY_EVENT');
    const messages = diplomacyEvents.map(e => String(e.data.message));
    expect(messages.filter(m => m.includes('Aztecs'))).toHaveLength(1);
    expect(messages.filter(m => m.includes('Romans'))).toHaveLength(1);

    // Seeing them again next turn must not repeat the announcement.
    engine.updatePlayerVisibility(0);
    expect(events.filter(e => e.type === 'DIPLOMACY_EVENT')).toHaveLength(2);
  });
});

describe('research "known tech" discount is gated on contact', () => {
  const tech = { id: 'bronze_working', name: 'Bronze Working', cost: 100, prerequisites: [], researched: false };

  it('does not discount a tech known only by an unmet civ', () => {
    const engine = makeEngine();
    engine.civilizations[1].technologies = ['bronze_working'];
    const rm = new ResearchManager(engine);

    expect(rm.knownCivsModifier(engine.civilizations[0], tech)).toBe(1);
  });

  it('discounts a tech known by a contacted civ', () => {
    const engine = makeEngine();
    engine.civilizations[1].technologies = ['bronze_working'];
    engine.diplomacyManager.markContact(0, 1);
    const rm = new ResearchManager(engine);

    expect(rm.knownCivsModifier(engine.civilizations[0], tech)).toBeCloseTo(0.9);
  });
});
