/**
 * AI-vs-AI games must hand the event loop back at least once per AI turn.
 *
 * A self-playing scenario skips every pacing sleep. The phase/turn handoff is
 * a chain of already-resolved promises, so without a real macrotask boundary
 * the whole game runs as one endless microtask sequence: timers (including the
 * AI-turn timeout watchdog) never fire, the canvas never repaints and the
 * browser sits at 100% CPU — tens of thousands of rounds, unresponsive UI.
 *
 * This test pins the fairness yield (`AIManager.runAITurn` awaits a real
 * `sleep(0)` in auto scenarios). It asserts on the injected sleep rather than
 * a wall-clock timer on purpose: a test waiting on `setTimeout` would starve
 * exactly like the browser did before the fix.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { useSeededRandom } from '../helpers/world';

describe('AI-vs-AI event-loop fairness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('yields with a real sleep(0) at the end of every auto-scenario AI turn', async () => {
    useSeededRandom(1);
    const engine = new GameEngine(null);

    // Pause before initialize: the engine must not auto-start the first turn,
    // so this test drives exactly one AI turn by hand.
    engine.isPaused = true;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: true,
      startingGold: 50,
      mapSeed: 20260925,
    } as never);
    engine.isPaused = false;

    const sleepSpy = vi.spyOn(engine, 'sleep');
    await engine.processAITurn(engine.activePlayer);

    // The fairness yield is a real timer; the pacing sleeps are skipped in
    // auto scenarios (no 250/200 ms calls).
    expect(sleepSpy).toHaveBeenCalledWith(0);

    engine.isPaused = true;
  });

  it('does not add the fairness yield to human games', async () => {
    useSeededRandom(1);
    const engine = new GameEngine(null);
    engine.isPaused = true;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 50,
      mapSeed: 20260925,
    } as never);
    engine.isPaused = false;

    // In a human game the AI starts its turn with a 250 ms pacing sleep, not
    // with the 0 ms fairness yield. Mock the pacing sleep so the test is fast
    // while still recording the requested delays.
    const sleepSpy = vi.spyOn(engine, 'sleep').mockResolvedValue(undefined);
    (engine as unknown as { activePlayer: number }).activePlayer = 1;
    await engine.processAITurn(1);

    expect(sleepSpy).toHaveBeenCalled();
    const zeroMsCalls = sleepSpy.mock.calls.filter(([ms]) => ms === 0);
    expect(zeroMsCalls).toEqual([]);

    engine.isPaused = true;
  });
});
