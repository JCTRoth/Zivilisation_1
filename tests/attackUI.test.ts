import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/**
 * Attacking enemy units through the UI (click) path.
 *
 * The UI dispatches `moveUnit(attackerId, targetCol, targetRow)` when the
 * player clicks an adjacent enemy unit. Regression under test:
 *  - `moveUnit` must NOT gate on `not_at_war` — `combatUnit` auto-declares war,
 *    so the pre-check made UI attacks impossible while at peace.
 *  - `canUnitMoveTo` must allow attacking an adjacent enemy tile.
 *  - Combat must resolve (war declared, attacker moves onto the tile on
 *    victory, defender marked defeated).
 */
describe('UI attack (moveUnit vs adjacent enemy)', () => {
  let engine: GameEngine;
  let emitted: string[];
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    emitted = [];
    engine.onStateChange = (type: string, _data?: any) => {
      emitted.push(type);
    };
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });
    randomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  /** Find two adjacent passable land tiles away from all cities. */
  const findAdjacentPair = (): { attacker: { col: number; row: number }; defender: { col: number; row: number } } => {
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    const isLand = (col: number, row: number): boolean => {
      const tile = (engine as any).getTileAt?.(col, row);
      if (!tile) return false;
      const type = String(tile.type ?? '').toLowerCase();
      return type !== 'ocean' && type !== 'water';
    };
    const farFromCities = (col: number, row: number): boolean =>
      !engine.cities.some((c: any) => Math.abs(c.col - col) + Math.abs(c.row - row) < 3);

    for (let row = 1; row < height - 1; row++) {
      for (let col = 1; col < width - 1; col++) {
        if (!isLand(col, row) || !farFromCities(col, row)) continue;
        // Try the four neighbours
        const neighbours = [
          { col: col + 1, row },
          { col: col - 1, row },
          { col, row: row + 1 },
          { col, row: row - 1 }
        ];
        for (const nb of neighbours) {
          if (isLand(nb.col, nb.row) && farFromCities(nb.col, nb.row)) {
            return { attacker: { col, row }, defender: { col: nb.col, row: nb.row } };
          }
        }
      }
    }
    throw new Error('No adjacent land pair found');
  };

  const addWarrior = (id: string, civId: number, pos: { col: number; row: number }, attack: number) => {
    const unit = {
      id,
      civilizationId: civId,
      type: 'warrior',
      col: pos.col,
      row: pos.row,
      movesRemaining: 1,
      health: 100,
      attack,
      defense: 1,
      maxMoves: 1,
      movement: 1,
      icon: 'warrior',
      isSleeping: false,
      isFortified: false,
      isSkipped: false,
      areTurnsDone: false
    };
    (engine as any).units.push(unit);
    return unit;
  };

  it('canUnitMoveTo allows attacking an adjacent enemy tile', () => {
    const pos = findAdjacentPair();
    addWarrior('att', 0, pos.attacker, 1);
    addWarrior('def', 1, pos.defender, 1);

    expect(engine.canUnitMoveTo('att', pos.defender.col, pos.defender.row)).toBe(true);
  });

  it('moveUnit at peace vs adjacent enemy declares war and resolves combat (attacker wins)', () => {
    const pos = findAdjacentPair();
    const attacker = addWarrior('att', 0, pos.attacker, 100);
    const defender = addWarrior('def', 1, pos.defender, 1);
    // Force attacker victory.
    randomSpy.mockReturnValue(0.01);
    // Sanity: civs start at peace.
    expect(engine.diplomacyManager.getStatus(0, 1)).toBe('peace');

    const result = engine.moveUnit('att', pos.defender.col, pos.defender.row);

    expect(result.success).toBe(true);
    // War was auto-declared (the core regression fix).
    expect(engine.diplomacyManager.getStatus(0, 1)).toBe('war');
    expect(emitted).toContain('WAR_DECLARED');
    expect(emitted).toContain('COMBAT_VICTORY');
    // The attacker survives but does NOT auto-advance: it must remain in its
    // original tile even though the defender was destroyed.
    expect(attacker.col).toBe(pos.attacker.col);
    expect(attacker.row).toBe(pos.attacker.row);
    expect(attacker.movesRemaining).toBe(0);
    // Defender marked defeated (removed after the 5s delay).
    expect((defender as any).isDefeated).toBe(true);
  });

  it('moveUnit resolves combat where the defender wins (attacker damaged)', () => {
    const pos = findAdjacentPair();
    const attacker = addWarrior('att', 0, pos.attacker, 1);
    const defender = addWarrior('def', 1, pos.defender, 100);
    // Force defender victory.
    randomSpy.mockReturnValue(0.99);

    const result = engine.moveUnit('att', pos.defender.col, pos.defender.row);

    expect(result.success).toBe(false);
    expect(engine.diplomacyManager.getStatus(0, 1)).toBe('war');
    expect(emitted).toContain('COMBAT_DEFEAT');
    // Attacker took 25 damage and used its moves.
    expect(attacker.health).toBe(75);
    expect(attacker.movesRemaining).toBe(0);
    // Defender stays put, undefeated.
    expect(defender.col).toBe(pos.defender.col);
    expect(defender.row).toBe(pos.defender.row);
    expect((defender as any).isDefeated).toBeFalsy();
  });
});
