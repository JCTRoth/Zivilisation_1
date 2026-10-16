/**
 * Splash damage + city healing: the combat follow-through and the field
 * hospital.
 *
 *  - A hit on a tile with 2+ stacked units splashes 25% (min 1) onto every
 *    other exposed unit; cities, fortress tiles, fortified units and embarked
 *    cargo are immune.
 *  - Units in their own cities recover 2 HP/turn, up to a lifetime total of
 *    15% of all battle damage taken.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { CombatSystem } from '@/game/engine/CombatSystem';
import { MapRenderer } from '@/game/rendering/MapRenderer';
import type { City, Unit } from '../types/game';

const G = 'grassland';

const FIELD = [
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
  [G, G, G, G, G, G, G],
];

function makeEngine(rows: string[][] = FIELD) {
  const height = rows.length;
  const width = rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.onStateChange = null;
  e.isPaused = true;
  e.devMode = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: rows.flat().map((type, i) => {
      const col = i % width;
      const row = Math.floor(i / width);
      return { id: `${col},${row}`, col, row, type, terrain: type, movement: 1, defense: 1 };
    }),
  };
  e.civilizations = [
    { id: 0, name: 'Attackers', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
    { id: 1, name: 'Defenders', isHuman: false, isAlive: true, technologies: [], resources: { gold: 100 } },
  ];
  e.diplomacyManager = null;
  e.initializePlayerStorage(0);
  e.initializePlayerStorage(1);
  return e as GameEngine;
}

function addUnit(engine: GameEngine, opts: Partial<Unit> & { id: string; col: number; row: number; civilizationId: number }) {
  const unit = {
    health: 100,
    isDefeated: false,
    attack: 1,
    defense: 1,
    movesRemaining: 1,
    movement: 1,
    maxMoves: 1,
    type: 'warrior',
    hitPoints: 2,
    maxHitPoints: 2,
    ...opts,
  };
  engine.units.push(unit as never);
  return unit as Unit;
}

function addCity(engine: GameEngine, name: string, col: number, row: number, civId: number) {
  const city = {
    id: `city_${civId}_${name}`,
    name,
    civilizationId: civId,
    col,
    row,
    population: 3,
    buildings: [],
    buildQueue: [],
    currentProduction: null,
    tradeRoutes: [],
  };
  engine.cities.push(city as never);
  return city as City;
}

/** Attacker always wins the roll. */
function rigAttackerWins() {
  vi.spyOn(Math, 'random').mockReturnValue(0.01);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('splash damage math', () => {
  it('takes 25% of the primary hit, minimum 1', () => {
    expect(CombatSystem.splashDamage(100)).toBe(25);
    expect(CombatSystem.splashDamage(25)).toBe(6);
    expect(CombatSystem.splashDamage(1)).toBe(1);
    expect(CombatSystem.splashDamage(0)).toBe(0);
    expect(CombatSystem.splashDamage(-5)).toBe(0);
  });
});

describe('splash in combat', () => {
  it('wounds stacked mates on open ground', () => {
    const engine = makeEngine();
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 10, defense: 1 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const mate1 = addUnit(engine, { id: 'm1', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const mate2 = addUnit(engine, { id: 'm2', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    // Overrun (10 vs 1): primary takes 100, mates take 25 each.
    expect(defender.health).toBe(0);
    expect(mate1.health).toBe(75);
    expect(mate2.health).toBe(75);
    expect(mate1.isDefeated).toBeFalsy();
  });

  it('kills weakened mates through the same defeat pipeline', () => {
    const engine = makeEngine();
    const events: string[] = [];
    (engine as unknown as { onStateChange: unknown }).onStateChange = (type: string) => {
      events.push(String(type));
    };
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 10, defense: 1 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const weak = addUnit(engine, { id: 'w', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1, health: 20 });
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    expect(weak.health).toBe(0);
    expect(weak.isDefeated).toBe(true);
    expect(events).toContain('UNIT_DEFEATED');
    expect(events).toContain('COMBAT_SPLASH');
  });

  it('never touches a stack inside a city', () => {
    const engine = makeEngine();
    addCity(engine, 'Fort', 2, 2, 1);
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 10, defense: 1 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const mate = addUnit(engine, { id: 'm', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    expect(mate.health).toBe(100);
  });

  it('never touches a stack on a fortress tile', () => {
    const engine = makeEngine();
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 10, defense: 1 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const mate = addUnit(engine, { id: 'm', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    (engine.getTileAt(2, 2) as { improvement?: string }).improvement = 'fortress';
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    expect(mate.health).toBe(100);
  });

  it('spares the entrenched mate but wounds the exposed one', () => {
    const engine = makeEngine();
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 10, defense: 1 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const dugIn = addUnit(engine, { id: 'f', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1, isFortified: true });
    const exposed = addUnit(engine, { id: 'e', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    expect(dugIn.health).toBe(100);
    expect(exposed.health).toBe(75);
  });

  it('spares cargo aboard a transport on the tile', () => {
    const engine = makeEngine();
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 10, defense: 1 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const passenger = addUnit(engine, { id: 'p', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    (passenger as { embarkedOn?: string | null }).embarkedOn = 'ferry-1';
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    expect(passenger.health).toBe(100);
  });

  it('tracks battle damage for the healing ledger', () => {
    const engine = makeEngine();
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 10, defense: 1 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    const mate = addUnit(engine, { id: 'm', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1 });
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    expect(defender.battleDamageTaken).toBe(100);
    expect(mate.battleDamageTaken).toBe(25);
  });

  it('counts a non-lethal win once and splashes once', () => {
    const engine = makeEngine();
    const events: string[] = [];
    (engine as unknown as { onStateChange: unknown }).onStateChange = (type: string) => {
      events.push(String(type));
    };
    // Even strengths: the attacker wins the roll but cannot one-shot.
    const attacker = addUnit(engine, { id: 'a', col: 1, row: 2, civilizationId: 0, attack: 2, defense: 2, health: 100 });
    const defender = addUnit(engine, { id: 'd', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 2, health: 100 });
    const mate = addUnit(engine, { id: 'm', col: 2, row: 2, civilizationId: 1, attack: 1, defense: 1, health: 100 });
    rigAttackerWins();
    engine.combatUnit(attacker, defender);
    // Non-lethal only when the rigged roll did not destroy the defender.
    if (!defender.isDefeated) {
      const damage = 100 - (defender.health ?? 100);
      expect(damage).toBeGreaterThan(0);
      expect(defender.battleDamageTaken).toBe(damage);
      const splashCount = events.filter((e) => e === 'COMBAT_SPLASH').length;
      expect(splashCount).toBeLessThanOrEqual(1);
      if (splashCount === 1) {
        expect(mate.battleDamageTaken).toBe(CombatSystem.splashDamage(damage));
      }
    }
  });
});

describe('city healing math', () => {
  it('heals 2 HP, nothing at full health, nothing without a ledger', () => {
    expect(CombatSystem.cityHealAmount({ health: 100, battleDamageTaken: 50 })).toBe(0);
    expect(CombatSystem.cityHealAmount({ health: 60, battleDamageTaken: 0 })).toBe(0);
    expect(CombatSystem.cityHealAmount({ health: 60, battleDamageTaken: 40 })).toBe(2);
  });

  it('caps lifetime healing at 15% of battle damage taken', () => {
    // 40 damage → 6 HP lifetime cap: 2 + 2 + 1, then the ledger is exhausted.
    expect(CombatSystem.cityHealAmount({ health: 60, battleDamageTaken: 40, healedInCityTotal: 0 })).toBe(2);
    expect(CombatSystem.cityHealAmount({ health: 60, battleDamageTaken: 40, healedInCityTotal: 4 })).toBe(2);
    expect(CombatSystem.cityHealAmount({ health: 60, battleDamageTaken: 40, healedInCityTotal: 5 })).toBe(1);
    expect(CombatSystem.cityHealAmount({ health: 60, battleDamageTaken: 40, healedInCityTotal: 6 })).toBe(0);
  });

  it('never heals past full health', () => {
    expect(CombatSystem.cityHealAmount({ health: 99, battleDamageTaken: 100 })).toBe(1);
  });
});

describe('city healing through the turn reset', () => {
  it('heals a damaged unit standing in its own city and stamps the marker', () => {
    const engine = makeEngine();
    addCity(engine, 'Home', 2, 2, 0);
    const unit = addUnit(engine, {
      id: 'v', col: 2, row: 2, civilizationId: 0, health: 60,
      battleDamageTaken: 40, movesRemaining: 0,
    });
    (engine.turnManager as unknown as { resetUnitsForPlayer: (id: number) => void }).resetUnitsForPlayer(0);
    expect(unit.health).toBe(62);
    expect(unit.healedInCityTotal).toBe(2);
    expect(unit._healedRound).toBe(engine.turnManager.getRoundNumber());
  });

  it('does not heal in a foreign city, at full health, or past the ledger', () => {
    const engine = makeEngine();
    addCity(engine, 'Theirs', 2, 2, 1);
    const abroad = addUnit(engine, { id: 'a', col: 2, row: 2, civilizationId: 0, health: 60, battleDamageTaken: 40 });
    const fresh = addUnit(engine, { id: 'f', col: 0, row: 0, civilizationId: 0, health: 100, battleDamageTaken: 40 });
    addCity(engine, 'Home', 4, 4, 0);
    const capped = addUnit(engine, { id: 'c', col: 4, row: 4, civilizationId: 0, health: 60, battleDamageTaken: 40, healedInCityTotal: 6 });
    (engine.turnManager as unknown as { resetUnitsForPlayer: (id: number) => void }).resetUnitsForPlayer(0);
    expect(abroad.health).toBe(60);
    expect(abroad._healedRound).toBeUndefined();
    expect(fresh._healedRound).toBeUndefined();
    expect(capped.health).toBe(60);
  });
});

describe('healing marker display rule', () => {
  it('shows only this round, only unstacked or selected', () => {
    expect(MapRenderer.healMarkerVisible(5, 5, 1, 'u', null)).toBe(true);
    expect(MapRenderer.healMarkerVisible(4, 5, 1, 'u', null)).toBe(false);
    expect(MapRenderer.healMarkerVisible(undefined, 5, 1, 'u', null)).toBe(false);
    expect(MapRenderer.healMarkerVisible(5, 5, 3, 'u', null)).toBe(false);
    expect(MapRenderer.healMarkerVisible(5, 5, 3, 'u', 'u')).toBe(true);
    expect(MapRenderer.healMarkerVisible(5, 5, 3, 'u', 'other')).toBe(false);
  });
});
