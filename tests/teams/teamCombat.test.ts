import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import type { City, Unit } from '../../types/game';
import { teamSettings } from './teamHelpers';

function teamEngine(assignments = [0, 0, 1]): GameEngine {
  const engine = new GameEngine(null);
  engine.civilizations = Array.from({ length: assignments.length }, (_, id) => ({
    id,
    name: `Civ${id}`,
    isHuman: id === 0,
    isAlive: true,
    technologies: [],
    resources: { gold: 0 },
  })) as never;
  engine.units = [];
  engine.cities = [];
  engine.teamManager.configure(teamSettings(assignments), assignments.length);
  engine.teamManager.applyToCivilizations();
  engine.diplomacyManager.initialize(assignments.map((_, id) => id));
  engine.diplomacyManager.applyTeamInvariants();
  return engine;
}

function unit(id: string, civilizationId: number, col = 0, row = 0): Unit {
  return {
    id,
    type: 'warriors',
    civilizationId,
    col,
    row,
    health: 100,
    attack: 5,
    defense: 5,
    moves: 1,
    maxMoves: 1,
    movesRemaining: 1,
    icon: '',
  } as Unit;
}

describe('fixed alliances in combat', () => {
  it('refuses combat between locked teammates', () => {
    const engine = teamEngine();
    const attacker = unit('a', 0);
    const defender = unit('d', 1);

    expect(engine.combatUnit(attacker, defender)).toBe(false);
    // No war was declared either.
    expect(engine.diplomacyManager.getStatus(0, 1)).toBe('alliance');
  });

  it('does not treat an enemy team as friendly', () => {
    const engine = teamEngine();
    expect(engine.teamManager.isTeammate(0, 2)).toBe(false);
    expect(engine.diplomacyManager.isAtWar(0, 2)).toBe(false);
  });

  it('ignores a teammate SDI battery when deciding whether a tile is covered', () => {
    const engine = teamEngine();
    engine.squareGrid = new SquareGrid(20, 20);
    engine.cities = [{
      id: 'sdi',
      civilizationId: 1,
      col: 5,
      row: 5,
      buildings: ['sdi_defense'],
    }] as City[];

    // Fired by civ 0, whose teammate owns the battery: not a threat.
    expect(engine.isCoveredBySDI(5, 5, 0)).toBe(false);
    // Fired by an enemy: the umbrella is real.
    expect(engine.isCoveredBySDI(5, 5, 2)).toBe(true);
    // No firer supplied keeps the old conservative behaviour.
    expect(engine.isCoveredBySDI(5, 5)).toBe(true);
  });
});
