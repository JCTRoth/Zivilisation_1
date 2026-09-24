/**
 * Save/load round-trip: the fog of war (both the player storage and the store's
 * map overlay), turn/round/player state, units/cities and GoTo paths must all
 * survive a save + load into a fresh engine.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

// Minimal localStorage for the node test environment.
const memory = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
} as Storage;

describe('Save/load', () => {
  it('restores fog of war, turn state, units and GoTo paths', async () => {
    const engine = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });

    // Deterministic explored area: reveal around the human capital.
    const human = engine.civilizations.find((c) => c.isHuman) ?? engine.civilizations[0];
    const capital = engine.cities.find((c) => c.civilizationId === human.id);
    expect(capital).toBeTruthy();
    engine.revealArea(capital!.col, capital!.row, 3);
    const storageBefore = engine.getPlayerStorage(human.id)!;
    const exploredBefore = storageBefore.explored.filter(Boolean).length;
    expect(exploredBefore).toBeGreaterThan(0);

    // A GoTo path + non-default turn state.
    const unit = engine.units.find((u) => u.civilizationId === human.id)!;
    engine.goToManager.setUnitPath(unit.id, [{ col: unit.col + 1, row: unit.row }]);
    engine.currentTurn = 42;
    engine.currentYear = 1000;
    engine.activePlayer = human.id;
    engine.roundManager.restoreState({
      roundNumber: 42,
      currentPlayer: human.id,
      currentPhase: engine.roundManager.getPhase(),
    });

    const json = engine.getSaveJSON();
    expect(json).toBeTruthy();
    localStorage.setItem('civ1_savegame', json!);

    // Load into a FRESH engine (no state leakage).
    const loaded = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loaded as any).sleep = () => Promise.resolve();
    expect(await loaded.loadGame()).toBe(true);

    // Fog of war: the map overlay is rebuilt with the map-width stride.
    expect(loaded.map?.revealed?.length).toBe(loaded.map!.width * loaded.map!.height);
    expect(loaded.map?.revealed?.filter(Boolean).length).toBe(exploredBefore);
    const storageAfter = loaded.getPlayerStorage(human.id)!;
    expect(storageAfter.explored.filter(Boolean).length).toBe(exploredBefore);
    expect(storageAfter.visibility.filter(Boolean).length)
      .toBe(storageBefore.visibility.filter(Boolean).length);

    // Turn state.
    expect(loaded.currentTurn).toBe(42);
    expect(loaded.currentYear).toBe(1000);
    expect(loaded.activePlayer).toBe(human.id);
    expect(loaded.roundManager.getRoundNumber()).toBe(42);

    // World state + GoTo path (restored in BOTH path stores).
    expect(loaded.units.length).toBe(engine.units.length);
    expect(loaded.cities.length).toBe(engine.cities.length);
    expect(loaded.goToManager.hasPath(unit.id)).toBe(true);
    expect(loaded.roundManager.getUnitPath(unit.id)?.length).toBe(1);
  });
});
