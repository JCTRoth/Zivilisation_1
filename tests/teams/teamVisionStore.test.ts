import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';
import type { Unit } from '../../types/game';

/**
 * The UI fog (`GameStore.updateVisibility`) is what the player actually sees.
 * It used to light only `viewPlayer`'s own units/cities; fixed alliances must
 * light the locked teammates' too, and nothing else. This drives the store
 * directly so the assertion is on `map.visibility` (the rendered fog).
 */
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

const setup = (teamGame: boolean) => {
  const teamId = (team: number) => (teamGame ? team : undefined);
  useGameStore.setState((state) => ({
    ...state,
    gameState: { ...state.gameState, viewPlayer: 0 },
    // civ 0 and 1 are locked teammates (team 0); civ 2 is the enemy (team 1).
    civilizations: [
      { id: 0, teamId: teamId(0) },
      { id: 1, teamId: teamId(0) },
      { id: 2, teamId: teamId(1) },
    ] as never,
    units: [unit('mine', 0, 5, 5), unit('ally', 1, 30, 25), unit('foe', 2, 20, 15)],
    map: {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      tiles: new Array(MAP_WIDTH * MAP_HEIGHT).fill({ terrain: 'grassland', visible: false, explored: false }),
      visibility: new Array(MAP_WIDTH * MAP_HEIGHT).fill(false),
      revealed: new Array(MAP_WIDTH * MAP_HEIGHT).fill(false),
    },
    settings: { ...state.settings, devMode: false },
  }));
};

describe('shared team vision (UI fog)', () => {
  beforeEach(() => setup(true));

  it("the viewing player sees their teammate's units lit", () => {
    setup(true);
    useGameStore.getState().actions.updateVisibility();
    const { map } = useGameStore.getState();

    // The player's own unit lights its tile…
    expect(map.visibility![tileIndex(5, 5)]).toBe(true);
    // …the teammate's unit lights its tile too (shared vision)…
    expect(map.visibility![tileIndex(30, 25)]).toBe(true);
    // …and stays permanently revealed for the whole team.
    expect(map.revealed![tileIndex(30, 25)]).toBe(true);
    // …while the enemy's unit does not leak.
    expect(map.visibility![tileIndex(20, 15)]).toBe(false);
  });

  it('free-for-all shares nothing (unchanged behaviour)', () => {
    setup(false);
    useGameStore.getState().actions.updateVisibility();
    const { map } = useGameStore.getState();

    expect(map.visibility![tileIndex(5, 5)]).toBe(true);
    // The other civ is not a teammate here, so its unit stays in fog.
    expect(map.visibility![tileIndex(30, 25)]).toBe(false);
    expect(map.visibility![tileIndex(20, 15)]).toBe(false);
  });
});
