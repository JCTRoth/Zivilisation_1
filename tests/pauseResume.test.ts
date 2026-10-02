/**
 * Pausing a self-playing game, and resuming it.
 *
 * The turn cycle guards both of its entry points with an early return while
 * paused, and for a long time that early return simply *forgot* the request: a
 * pause landing between two phases dropped the pending `startTurn` /
 * `advanceTurn` and nothing ever called them again. The board looked fine —
 * it just never took another turn, which is indistinguishable from a working
 * pause if you never click play.
 *
 * These tests drive the real `TurnManager` through the real `GameEngine`
 * pause/resume pair and assert the cycle is picked back up.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import type GameEngineType from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { useGameStore } from '@/stores/GameStore';

/** Two AI civs on a small map — the AI-vs-AI shape. */
function makeAIVsAIEngine(): GameEngineType {
  const width = 12;
  const height = 12;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = new GameEngine(null) as any;
  engine.units = [];
  engine.cities = [];
  engine.onStateChange = null;
  engine.unitTurnQueue = null;
  engine.isPaused = false;
  engine.activePlayer = 0;
  engine.squareGrid = new SquareGrid(width, height);
  engine.map = {
    width,
    height,
    tiles: Array.from({ length: width * height }, (_, i) => ({
      col: i % width, row: Math.floor(i / width),
      type: 'grassland', terrain: 'grassland', resource: null, visible: true, explored: true,
    })),
  };
  engine.gameSettings = { mapType: 'AI_VS_AI', difficulty: 'PRINCE', numberOfCivilizations: 2 };
  const civ = (id: number) => ({
    id, name: `Civ${id}`, isHuman: false, isAI: true,
    government: 'despotism', taxRate: 50, scienceRate: 50, luxuryRate: 0,
    technologies: [], researchProgress: 0, isAlive: true,
    resources: { gold: 100, science: 0, food: 0, production: 0, trade: 0 },
  });
  engine.civilizations = [civ(0), civ(1)];
  engine.initializePlayerStorage(0);
  engine.initializePlayerStorage(1);
  return engine as GameEngineType;
}

/** The TurnManager internals these tests observe and drive. */
interface TurnInternals {
  currentPlayer: number | null;
  currentPhase: string | null;
  startTurn: (civId: number) => void;
  advanceTurn: () => void;
  onGameResumed: () => void;
}
const internals = (engine: GameEngineType): TurnInternals =>
  engine.turnManager as unknown as TurnInternals;

/**
 * Put the turn cycle on a given player WITHOUT starting the turn. `startTurn`
 * begins a real async phase chain (register → production → research → end),
 * which would advance the player underneath these synchronous assertions.
 * The deferral logic under test does not depend on the phase chain.
 */
function driveTurn(tm: TurnInternals, player: number): void {
  (tm as unknown as { currentPlayer: number | null }).currentPlayer = player;
}

describe('pause and resume the turn cycle', () => {
  let engine: GameEngineType;

  beforeEach(() => {
    useGameStore.setState((s) => ({ settings: { ...s.settings, gameSpeedStep: 0 } }));
    engine = makeAIVsAIEngine();
    // These civs own nothing, so the domination check would declare a win on
    // the first handoff, mark both civilizations dead and collapse the rotation
    // — noise that has nothing to do with pausing.
    vi.spyOn(
      engine.victoryManager as unknown as { evaluateEndOfTurn: () => boolean },
      'evaluateEndOfTurn',
    ).mockReturnValue(false);
  });

  it('does not start a turn while paused', () => {
    const tm = internals(engine);
    engine.setPaused(true);
    tm.startTurn(1);
    expect(tm.currentPlayer).toBeNull();
  });

  it('starts the deferred turn as soon as the pause is released', () => {
    const tm = internals(engine);
    engine.setPaused(true);
    tm.startTurn(1);

    // The pause is what stopped it, so releasing it must drive the same turn —
    // this is the whole point of remembering the dropped request.
    engine.setPaused(false);
    expect(tm.currentPlayer).toBe(1);
  });

  it('does not advance the turn while paused', () => {
    const tm = internals(engine);
    // Set the active player directly instead of via startTurn: startTurn kicks
    // off a real async phase chain, which would race these assertions. What is
    // under test here is only whether the handoff happens while paused.
    driveTurn(tm, 0);
    const roundBefore = (engine.turnManager as unknown as { roundNumber: number }).roundNumber;

    engine.setPaused(true);
    tm.advanceTurn();
    expect(tm.currentPlayer).toBe(0);

    engine.setPaused(false);
    expect(tm.currentPlayer).toBe(1);
    expect((engine.turnManager as unknown as { roundNumber: number }).roundNumber)
      .toBe(roundBefore);
  });

  it('keeps the turn cycle running across repeated pause/resume cycles', () => {
    const tm = internals(engine);
    // Stub registration so starting a turn does not spawn the real async
    // phase chain underneath these synchronous assertions.
    vi.spyOn(
      engine.turnManager as unknown as { registerPlayer: (id: number) => unknown },
      'registerPlayer',
    ).mockResolvedValue(true);

    driveTurn(tm, 0);

    // Pause across every handoff — the worst case for the old behaviour,
    // which lost the cycle on the very first one.
    const seen: Array<number> = [];
    for (let i = 0; i < 4; i++) {
      engine.setPaused(true);
      tm.advanceTurn();
      engine.setPaused(false);
      seen.push(tm.currentPlayer ?? -1);
    }

    // Two civilizations rotate strictly, so four handoffs must have alternated
    // — the cycle was never lost.
    expect(seen).toEqual([1, 0, 1, 0]);
  });

  it('does nothing on resume when the pause interrupted nothing', () => {
    const tm = internals(engine);
    tm.startTurn(0);
    const startSpy = vi.spyOn(tm, 'startTurn');
    const advanceSpy = vi.spyOn(tm, 'advanceTurn');

    engine.setPaused(false);

    expect(startSpy).not.toHaveBeenCalled();
    expect(advanceSpy).not.toHaveBeenCalled();
    expect(tm.currentPlayer).toBe(0);
  });

  it('does not replay a deferred step twice', () => {
    const tm = internals(engine);
    engine.setPaused(true);
    tm.startTurn(1);
    engine.setPaused(false);
    expect(tm.currentPlayer).toBe(1);

    // The replay consumed the request; a second resume must not start turn 1
    // again on top of the turn that is already running.
    const startSpy = vi.spyOn(tm, 'startTurn');
    engine.setPaused(false);
    expect(startSpy).not.toHaveBeenCalled();
    expect(tm.currentPlayer).toBe(1);
  });

  it('prefers a deferred turn start over a deferred advance', () => {
    // Both flags set: replaying the advance first would skip a civilization
    // entirely, so the turn start has to win.
    const tm = internals(engine);
    engine.setPaused(true);
    tm.startTurn(1);
    tm.advanceTurn();
    engine.setPaused(false);
    expect(tm.currentPlayer).toBe(1);
  });
});

describe('speed pacing', () => {
  beforeEach(() => {
    useGameStore.setState((s) => ({ settings: { ...s.settings, gameSpeedStep: 0 } }));
  });

  it('runs a self-playing scenario at full speed by default', () => {
    const engine = makeAIVsAIEngine();
    expect(engine.getGameSpeedStep()).toBe(0);
    expect(engine.getAIMoveDelay()).toBe(0);
    expect(engine.getAITurnStartDelay()).toBe(0);
  });

  it('adds one uniform increment per speed step', () => {
    const engine = makeAIVsAIEngine();
    const { actions } = useGameStore.getState();
    const seen: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      seen.push([engine.getAITurnStartDelay(), engine.getAIMoveDelay()]);
      actions.slowerGameSpeed();
    }
    const [turn0, move0] = seen[0];
    const [turn1, move1] = seen[1];
    expect(turn0).toBe(0);
    expect(turn1 - turn0).toBe(turn2(seen) - turn1);
    expect(move1 - move0).toBe(seen[2][1] - seen[1][1]);
    // Monotonic: every step down really is slower.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i][0]).toBeGreaterThan(seen[i - 1][0]);
      expect(seen[i][1]).toBeGreaterThan(seen[i - 1][1]);
    }
  });

  it('reads the live speed without the engine being told', () => {
    const engine = makeAIVsAIEngine();
    const { actions } = useGameStore.getState();
    actions.setGameSpeedStep(3);
    expect(engine.getGameSpeedStep()).toBe(3);
    expect(engine.getAITurnStartDelay()).toBeGreaterThan(0);
    actions.setGameSpeedStep(0);
    expect(engine.getAITurnStartDelay()).toBe(0);
  });

  it('keeps a watched (non self-playing) game on its readable pace', () => {
    const engine = makeAIVsAIEngine();
    engine.gameSettings = { ...engine.gameSettings, mapType: 'DEFAULT' };
    // A watched game is unaffected by the spectator ladder — it always waits
    // long enough for a human to follow what is happening.
    expect(engine.getAITurnStartDelay()).toBeGreaterThan(0);
    expect(engine.getAIMoveDelay()).toBeGreaterThan(0);
  });
});

/** Helper: the second recorded sample, for expressing "one step equals…". */
function turn2(seen: Array<[number, number]>): number {
  return seen[2][0];
}
