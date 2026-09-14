import { describe, it, expect } from 'vitest';
import { AIManager } from '@/game/engine/AI/AIManager';
import type { Unit } from '@/../types/game';

/**
 * Scout defense override.
 *
 * Exploration is less important than defending a city that has no other
 * troops while an enemy is close. `findScoutDefenseTarget` should make the
 * scout garrison the city tile, and return null (so the scout resumes
 * exploring) when the city is defended, no enemy is near, or the scout is
 * too far away to respond.
 */
describe('AIManager.findScoutDefenseTarget', () => {
  const dist = (c1: number, r1: number, c2: number, r2: number) =>
    Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));

  const createMock = (overrides: {
    scout?: { col: number; row: number; id?: string };
    city?: { col: number; row: number; id?: string };
    garrison?: boolean;
    enemy?: { col: number; row: number } | null;
  } = {}) => {
    const city = {
      id: overrides.city?.id ?? 'city1',
      name: 'C',
      civilizationId: 1,
      col: overrides.city?.col ?? 10,
      row: overrides.city?.row ?? 10,
      population: 3
    };
    const scout: Unit = {
      id: overrides.scout?.id ?? 'scout1',
      type: 'scout',
      civilizationId: 1,
      col: overrides.scout?.col ?? 5,
      row: overrides.scout?.row ?? 5,
      movesRemaining: 2,
      health: 100,
      attack: 0.5,
      defense: 1,
      icon: 'scout'
    };

    const units: any[] = [scout];
    if (overrides.garrison) {
      units.push({ id: 'garrison', type: 'warrior', civilizationId: 1, col: city.col, row: city.row, attack: 1, defense: 1 });
    }
    if (overrides.enemy) {
      units.push({ id: 'enemy', type: 'warrior', civilizationId: 2, col: overrides.enemy.col, row: overrides.enemy.row, attack: 1, defense: 1 });
    }

    const engine: any = {
      map: { width: 40, height: 40 },
      devMode: false,
      units,
      cities: [city],
      getPlayerStorage: () => ({ enemyLocations: new Map() }),
      roundManager: { getRoundNumber: () => 0 },
      squareGrid: {
        squareDistance: dist,
        getNeighbors: (c: number, r: number) => [
          { col: c + 1, row: r },
          { col: c - 1, row: r },
          { col: c, row: r + 1 },
          { col: c, row: r - 1 }
        ]
      },
      getUnitAt: (col: number, row: number) => units.find((u: any) => u.col === col && u.row === row) ?? null,
      getTileAt: (col: number, row: number) => ({ col, row, type: 'grassland', passable: true }),
      getCityAt: () => null,
      isExploredByPlayer: () => true
    };

    const ai = new AIManager(engine);
    return { ai, scout };
  };

  it('returns the city tile when the city is undefended and an enemy is close', () => {
    // Enemy 2 tiles from the city (within the 3-tile threat radius).
    const { ai, scout } = createMock({ enemy: { col: 12, row: 10 } });
    const target = ai.findScoutDefenseTarget(scout);
    expect(target).toEqual({ col: 10, row: 10 });
  });

  it('returns null when the city has another defender', () => {
    const { ai, scout } = createMock({ garrison: true, enemy: { col: 11, row: 10 } });
    expect(ai.findScoutDefenseTarget(scout)).toBeNull();
  });

  it('returns null when no enemy is close to the city', () => {
    // Enemy 10 tiles from the city — outside the threat radius.
    const { ai, scout } = createMock({ enemy: { col: 20, row: 20 } });
    expect(ai.findScoutDefenseTarget(scout)).toBeNull();
  });

  it('returns null when the scout is too far from the city to respond', () => {
    // Scout 20 tiles away (outside the 8-tile response radius).
    const { ai, scout } = createMock({ scout: { col: 30, row: 30 }, enemy: { col: 11, row: 10 } });
    expect(ai.findScoutDefenseTarget(scout)).toBeNull();
  });

  it('returns a passable neighbor when an enemy occupies the city tile', () => {
    const { ai, scout } = createMock({ enemy: { col: 10, row: 10 } });
    const target = ai.findScoutDefenseTarget(scout);
    expect(target).not.toBeNull();
    // Must be adjacent to the city, not the occupied tile itself.
    expect(dist(target!.col, target!.row, 10, 10)).toBe(1);
  });
});
