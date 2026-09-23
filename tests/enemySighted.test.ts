import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';
import { findNewlySightedEnemies, getVisibleEnemyUnitIds } from '@/game/engine/EnemySighting';
import type { Unit } from '../types/game';

/**
 * Fog-of-war "new sighting" detection, used to stop a GoTo path when a step
 * reveals an enemy the player had not seen before.
 *
 * An enemy that was already visible must NOT count (a path running past a known
 * enemy must not be cancelled every step), and enemies in fog must never leak.
 */
describe('enemy sighting detection', () => {
  const MAP_WIDTH = 40;
  const MAP_HEIGHT = 30;
  const tileIndex = (col: number, row: number) => row * MAP_WIDTH + col;

  const unit = (id: string, civilizationId: number, col: number, row: number): Unit => ({
    id,
    type: 'warrior',
    civilizationId,
    col,
    row,
    movesRemaining: 1,
    health: 100,
    icon: '⚔️',
  });

  const setup = (opts: { units: Unit[]; visibleTiles: number[]; devMode?: boolean }) => {
    const visibility = new Array<boolean>(MAP_WIDTH * MAP_HEIGHT).fill(false);
    for (const idx of opts.visibleTiles) visibility[idx] = true;
    useGameStore.setState((state) => ({
      ...state,
      map: {
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        tiles: [],
        visibility,
        revealed: visibility.slice(),
      },
      units: opts.units,
      settings: { ...state.settings, devMode: !!opts.devMode },
    }));
  };

  beforeEach(() => {
    setup({ units: [], visibleTiles: [] });
  });

  it('only reports enemy units standing on visible tiles', () => {
    setup({
      units: [
        unit('own', 0, 5, 5),
        unit('enemy-visible', 1, 10, 10),
        unit('enemy-hidden', 1, 20, 20),
      ],
      visibleTiles: [tileIndex(10, 10)],
    });

    const visible = getVisibleEnemyUnitIds();
    expect([...visible]).toEqual(['enemy-visible']);
  });

  it('detects a newly revealed enemy', () => {
    setup({
      units: [unit('own', 0, 5, 5), unit('enemy-here', 1, 11, 11)],
      visibleTiles: [tileIndex(5, 5)],
    });
    const before = getVisibleEnemyUnitIds();
    expect(before.size).toBe(0);

    // The unit moved: its tile is now in view.
    setup({
      units: [unit('own', 0, 10, 10), unit('enemy-here', 1, 11, 11)],
      visibleTiles: [tileIndex(10, 10), tileIndex(11, 11)],
    });

    const newly = findNewlySightedEnemies(before);
    expect(newly.map((u) => u.id)).toEqual(['enemy-here']);
  });

  it('does not report an enemy that was already visible', () => {
    setup({
      units: [unit('own', 0, 10, 10), unit('enemy-known', 1, 11, 11)],
      visibleTiles: [tileIndex(10, 10), tileIndex(11, 11)],
    });
    const before = getVisibleEnemyUnitIds();
    expect(before.size).toBe(1);

    // The unit moved, but the enemy stays in view.
    setup({
      units: [unit('own', 0, 12, 12), unit('enemy-known', 1, 11, 11)],
      visibleTiles: [tileIndex(12, 12), tileIndex(11, 11)],
    });

    expect(findNewlySightedEnemies(before)).toEqual([]);
  });

  it('ignores defeated enemies and never reports fogged ones', () => {
    const defeated = { ...unit('enemy-dead', 1, 11, 11), isDefeated: true } as Unit;
    setup({
      units: [unit('own', 0, 10, 10), defeated, unit('enemy-fog', 1, 30, 25)],
      visibleTiles: [tileIndex(10, 10), tileIndex(11, 11)],
    });

    expect([...getVisibleEnemyUnitIds()]).toEqual([]);
  });
});
