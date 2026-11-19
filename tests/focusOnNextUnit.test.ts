import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';
import type { Unit, City, Civilization, ProductionItem } from '@shared/types/game';

/**
 * Camera-focus rule: the camera only follows the human player's own unit
 * movement, or enemy/AI units whose tile the human player can currently see
 * (fog of war). Hidden AI movement must never yank the camera or leak unit
 * info through the selection panel. Dev mode overrides the fog check.
 */
describe('focusOnNextUnit — camera follows only human/visible units', () => {
  const MAP_WIDTH = 40;
  const MAP_HEIGHT = 30;
  const tileIndex = (col: number, row: number) => row * MAP_WIDTH + col;

  const setup = (opts: {
    activePlayer: number;
    units: Unit[];
    devMode?: boolean;
    visibleTiles?: number[];
  }) => {
    const visibility = new Array<boolean>(MAP_WIDTH * MAP_HEIGHT).fill(false);
    for (const idx of opts.visibleTiles ?? []) visibility[idx] = true;

    useGameStore.setState((state) => ({
      ...state,
      _lastFocusCall: 0,
      gameState: {
        ...state.gameState,
        activePlayer: opts.activePlayer,
        selectedUnit: null,
        activeUnit: null,
        selectedCity: null,
      },
      map: {
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        tiles: [],
        visibility,
        revealed: visibility.slice(),
      },
      camera: { x: 0, y: 0, zoom: 2.0, minZoom: 0.5, maxZoom: 3.0 },
      cameraPanRequest: null,
      units: opts.units,
      cities: [],
      civilizations: [],
      settings: { ...state.settings, devMode: !!opts.devMode },
    }));
  };

  const unit = (id: string, civilizationId: number, col: number, row: number): Unit => ({
    id,
    type: 'warrior',
    civilizationId,
    col,
    row,
    movesRemaining: 1,
    health: 100,
    icon: 'warrior',
    isSleeping: false,
    isFortified: false,
    isSkipped: false,
    areTurnsDone: false,
  });

  beforeEach(() => {
    // Reset to a known default before each test.
    setup({ activePlayer: 0, units: [], visibleTiles: [] });
  });

  it('follows the human player’s own unit and selects it', () => {
    setup({ activePlayer: 0, units: [unit('human-1', 0, 20, 15)] });

    useGameStore.getState().actions.focusOnNextUnit();

    const { cameraPanRequest, gameState } = useGameStore.getState();
    expect(gameState.selectedUnit).toBe('human-1');
    expect(cameraPanRequest).toMatchObject({ col: 20, row: 15 });
  });

  it('does NOT follow an AI unit hidden by fog of war', () => {
    setup({ activePlayer: 1, units: [unit('ai-hidden', 1, 20, 15)], visibleTiles: [] });

    useGameStore.getState().actions.focusOnNextUnit();

    const { cameraPanRequest, gameState } = useGameStore.getState();
    expect(gameState.selectedUnit).toBeNull();
    expect(cameraPanRequest).toBeNull();
  });

  it('follows an AI unit on a tile visible to the human player', () => {
    setup({
      activePlayer: 1,
      units: [unit('ai-visible', 1, 20, 15)],
      visibleTiles: [tileIndex(20, 15)],
    });

    useGameStore.getState().actions.focusOnNextUnit();

    const { cameraPanRequest, gameState } = useGameStore.getState();
    expect(gameState.selectedUnit).toBe('ai-visible');
    expect(cameraPanRequest).toMatchObject({ col: 20, row: 15 });
  });

  it('dev mode reveals hidden AI movement (fog overridden)', () => {
    setup({
      activePlayer: 1,
      units: [unit('ai-dev', 1, 20, 15)],
      visibleTiles: [],
      devMode: true,
    });

    useGameStore.getState().actions.focusOnNextUnit();

    const { cameraPanRequest, gameState } = useGameStore.getState();
    expect(gameState.selectedUnit).toBe('ai-dev');
    expect(cameraPanRequest).toMatchObject({ col: 20, row: 15 });
  });

  const makeCity = (id: string, civId: number, col: number, row: number, buildQueue: ProductionItem[] = []): City => ({
    id,
    name: id,
    civilizationId: civId,
    col,
    row,
    population: 1,
    production: 1,
    food: 1,
    gold: 1,
    science: 1,
    buildQueue,
  });

  const makeCiv = (id: number, capital: City): Civilization => ({
    id,
    name: `Civ ${id}`,
    color: '#000',
    isAlive: true,
    capital,
    resources: { food: 0, production: 0, trade: 0, science: 0, gold: 0 },
    isHuman: true,
    isAI: false,
  });

  it('pans to the capital when a city has an empty build queue (production left)', () => {
    const capital = makeCity('capital-0', 0, 20, 15, []);
    const civ = makeCiv(0, capital);
    setup({ activePlayer: 0, units: [] });
    useGameStore.setState((state) => ({ ...state, cities: [capital], civilizations: [civ] }));

    useGameStore.getState().actions.focusOnNextUnit();

    const { cameraPanRequest, gameState } = useGameStore.getState();
    expect(gameState.selectedCity).toBe('capital-0');
    expect(cameraPanRequest).toMatchObject({ col: 20, row: 15 });
  });

  it('does NOT pan to a city when all cities have production queued', () => {
    const capital = makeCity('capital-0', 0, 20, 15, [{ type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }]);
    const civ = makeCiv(0, capital);
    setup({ activePlayer: 0, units: [] });
    useGameStore.setState((state) => ({ ...state, cities: [capital], civilizations: [civ] }));

    useGameStore.getState().actions.focusOnNextUnit();

    const { cameraPanRequest, gameState } = useGameStore.getState();
    expect(gameState.selectedCity).toBeNull();
    expect(cameraPanRequest).toBeNull();
  });
});
