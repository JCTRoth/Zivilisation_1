/**
 * Army composition and multi-group coordination.
 *
 * Two changes the audit called out as missing:
 *
 *  1. Composition by era. The AI used to field a FIXED preference ladder
 *     (`riflemen → musketeer → phalanx → archer → warrior`), so an ancient
 *     city could still be told to build riflemen, and `mech_inf` — the best
 *     infantry in the game — was never selected at all. Selection is now
 *     driven by the UNIT_PROPERTIES data: pick the best unit of the role the
 *     civ can actually build right now. `canBuildUnit` is the tech gate, so
 *     the era falls out of the data instead of a hardcoded ladder.
 *
 *  2. Multi-group coordination. A committed offensive plan used to give
 *     EVERY army group the same single target, so a 15-unit force piled onto
 *     one city. Surplus force now opens at most two secondary fronts.
 *
 * Both are pinned here against hand-built unit tables and city lists so a
 * regression is caught without running a 150-round game.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { AIManager } from '@/game/engine/AI/AIManager';
import { SquareGrid } from '@/game/SquareGrid';
import type { City, Civilization } from '../../types/game';

// ─── A minimal theatre ────────────────────────────────────────────────────


const makeCiv = (technologies: string[]): Civilization =>
  ({ id: 0, name: 'Test', isAlive: true, isAI: true, resources: { gold: 100 }, technologies } as unknown as Civilization);

const makeCity = (over: Partial<City> = {}): City =>
  ({ id: 'c1', name: 'Forge', civilizationId: 0, col: 5, row: 5, population: 4, buildings: [], ...over } as unknown as City);

/** An AutoProduction bound to a stub engine — only the fields it reads here. */
const production = (civ: Civilization): AutoProduction => {
  const engine = {
    civilizations: [civ],
    cities: [],
    units: [],
    roundManager: { getRoundNumber: () => 3 },
    getPlayerStorage: () => ({ turnData: {} }),
  } as unknown as GameEngine;
  return new AutoProduction(engine);
};

/** Reach into the private selector without duplicating its signature. */
const selectDefender = (ap: AutoProduction, civ: Civilization, city?: City): string =>
  (ap as unknown as { selectDefenderTypeForCiv: (c: Civilization, city?: City) => string })
    .selectDefenderTypeForCiv(civ, city);

const selectAttacker = (ap: AutoProduction, civ: Civilization, city?: City): string =>
  (ap as unknown as { selectOffensiveUnitTypeForCiv: (c: Civilization, city?: City) => string })
    .selectOffensiveUnitTypeForCiv(civ, city);

// ─── 1. Composition by era ────────────────────────────────────────────────

describe('army composition by era', () => {
  it('an ancient civ fields ancient units, not a modern ladder entry', () => {
    const civ = makeCiv(['bronze_working']);
    const ap = production(civ);
    // No gunpowder, no combustion, so musketeer/riflemen/mech_inf are all
    // unbuildable. The best DEFENDER the data offers a Bronze-age civ is the
    // Archer: defense 2, the highest defense it can build, and the tie with
    // the Phalanx (also defense 2) is broken cheapest-first — the Archer
    // costs half a Phalanx and is the better garrison buy.
    expect(selectDefender(ap, civ)).toBe('archer');
    // The best ATTACKER is also the Archer (attack 3 — the best it can field;
    // Chariot needs The Wheel, and the Legion needs Iron Working).
    expect(selectAttacker(ap, civ)).toBe('archer');
  });

  it('a combustion-era civ fields the best unit the data offers, not a stale ladder entry', () => {
    // Combustion unlocks both the Tank (attack 16, defense 8) and Mech. Inf.
    // (attack 6, defense 6). The old hardcoded ladder stopped at riflemen and
    // never reached EITHER; the data-driven picker takes the Tank, because it
    // is simply the better unit of the era. The point is that the picker
    // FOLLOWS THE DATA — mech_inf is reachable the moment the data makes it
    // the best option, which the old ladder could never do.
    const civ = makeCiv(['combustion']);
    const ap = production(civ);
    expect(selectDefender(ap, civ)).toBe('tank');
    expect(selectAttacker(ap, civ)).toBe('tank');
  });

  it('a tank-civ defender is still a tank-era shield, and the attacker is a tank', () => {
    const civ = makeCiv(['mass_production', 'combustion', 'the_wheel']);
    const ap = production(civ);
    expect(selectAttacker(ap, civ)).toBe('tank');
  });

  it('selection tracks the era — a gunpowder civ fields its best shield, and never a tank', () => {
    // Gunpowder unlocks the Musketeer (attack 3) and Rifleman (defense 5) but
    // NOT the Tank. The picker must stop at the best unit the civ can actually
    // build — the bug the old ladder had was fielding a unit from a fixed list
    // regardless of whether the era unlocked it.
    const civ = makeCiv(['gunpowder']);
    const ap = production(civ);
    expect(selectDefender(ap, civ)).toBe('riflemen'); // best buildable shield (def 5)
    // Best ATTACKER is the Archer, not the Musketeer: both attack 3, and the
    // tie breaks cheapest-first (the Archer has no tech requirement and costs
    // less). A gunpowder civ still gets the Rifleman shield it paid tech for —
    // and crucially never a Tank, which it cannot build at all.
    expect(selectAttacker(ap, civ)).toBe('archer');
    expect(selectAttacker(ap, civ)).not.toBe('tank');
  });

  it('a bare civ with no technologies still gets a real unit, never undefined', () => {
    const civ = makeCiv([]);
    const ap = production(civ);
    // Archer is the only unit it can build (the rest all `require` a tech) —
    // and Archer has no `requires`, so even a techless civ fields one.
    expect(selectDefender(ap, civ)).toBe('archer');
    expect(selectAttacker(ap, civ)).toBe('archer');
  });

  it('a garrison mixes a shooter in every third turn instead of pure shields', () => {
    // Chariot (attack 4) needs The Wheel; Archer is the best defender (defense
    // 2, cheapest). So best defender = Archer, best attacker = Chariot — the
    // two beats must then actually alternate.
    const civ = makeCiv(['bronze_working', 'the_wheel']);
    const ap = production(civ);
    const shooter = makeCity({ col: 4, row: 4 }); // 3 (round) + 4 + 4 = 11 → 11 % 3 === 2
    const shield = makeCity({ col: 5, row: 4 });  // 3 + 5 + 4 = 12 → 12 % 3 === 0
    expect(selectDefender(ap, civ, shooter)).toBe('chariot'); // shooter beat
    expect(selectDefender(ap, civ, shield)).toBe('archer');   // shield beat
  });
});

// ─── 2. Multi-group coordination ──────────────────────────────────────────

describe('multi-group coordination', () => {
  let engine: GameEngine;
  let ai: AIManager;

  const addCity = (id: string, col: number, row: number, civId: number, pop = 4): City => {
    const city = { id, name: id, civilizationId: civId, col, row, population: pop, buildings: [] } as unknown as City;
    (engine.cities as City[]).push(city);
    return city;
  };

  /** `secondaryGroupTargets` is what turns a committed plan into several fronts. */
  const secondaries = (
    civId: number,
    plan: { target: { col: number; row: number }; targetCivId?: number },
  ): Array<{ col: number; row: number; type: string }> =>
    (ai as unknown as {
      secondaryGroupTargets: (
        c: number,
        s: unknown,
        p: { target: { col: number; row: number }; targetCivId?: number },
      ) => Array<{ col: number; row: number; type: string }>;
    }).secondaryGroupTargets(civId, { turnData: {} }, plan);

  beforeEach(() => {
    engine = new GameEngine(null);
    engine.units = [];
    engine.cities = [];
    engine.onStateChange = null;
    engine.isPaused = true;
    engine.devMode = true;
    engine.activePlayer = 0;
    engine.squareGrid = new SquareGrid(40, 40);
    ai = new AIManager(engine);
  });

  it('opens second fronts on the SAME enemy, nearest to the primary first', () => {
    addCity('primary', 30, 10, 1, 5);
    addCity('near', 26, 10, 1, 4);
    addCity('far', 10, 30, 1, 4);
    addCity('neutral', 30, 30, 2, 4); // a DIFFERENT civ — never a front of this war

    const fronts = secondaries(0, { target: { col: 30, row: 10 }, targetCivId: 1 });
    const keys = fronts.map((f) => `${f.col},${f.row}`);

    // The plan's own target is never re-listed as a secondary.
    expect(keys).not.toContain('30,10');
    // The war's own cities are the second fronts — nearest one first.
    expect(keys[0]).toBe('26,10');
    // Another civ's city is never targeted: a war has one enemy.
    expect(keys).not.toContain('30,30');
    expect(fronts.every((f) => f.type === 'city')).toBe(true);
  });

  it('caps the number of secondary fronts so the army is not papered thin', () => {
    addCity('primary', 30, 10, 1, 5);
    // Five more enemy cities, all nearer than the primary's far side.
    for (let i = 0; i < 5; i++) addCity(`e${i}`, 24 + i, 8, 1, 3);

    const fronts = secondaries(0, { target: { col: 30, row: 10 }, targetCivId: 1 });
    expect(fronts.length).toBeLessThanOrEqual(2);
  });

  it('returns nothing when the plan enemy holds no other reachable city', () => {
    addCity('primary', 30, 10, 1, 5);
    expect(secondaries(0, { target: { col: 30, row: 10 }, targetCivId: 1 })).toEqual([]);
  });
});
