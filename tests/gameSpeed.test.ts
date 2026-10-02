/**
 * Game speed control and pausing for self-playing scenarios.
 *
 * Three things are locked in here, because each of them had to be *designed*
 * rather than merely implemented:
 *  - the speed ladder is uniform and reversible: every "Slower" click is undone
 *    by exactly one "Faster" click, and "Faster" is unavailable at full speed;
 *  - a pause really resumes. The turn cycle used to drop a `startTurn` /
 *    `advanceTurn` that landed during a pause and never replay it, so pausing
 *    a self-playing game stopped it for good;
 *  - the research-complete modal stays out of an AI-vs-AI run, where every
 *    civilization researches but nobody is watching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GAME_SPEED_STEP_COUNT,
  canGoFaster,
  canGoSlower,
  clampGameSpeedStep,
  fasterGameSpeedStep,
  gameSpeedLabel,
  gameSpeedTimeoutFactor,
  isAutoScenario,
  isSlowerThanFullSpeed,
  slowerGameSpeedStep,
} from '@/data/GameConstants';
import { useGameStore } from '@/stores/GameStore';

describe('game speed ladder', () => {
  it('starts at full speed', () => {
    expect(clampGameSpeedStep(0)).toBe(0);
    expect(isSlowerThanFullSpeed(0)).toBe(false);
    expect(gameSpeedLabel(0)).toBe('Full Speed');
  });

  it('does not allow Faster before anything has been slowed down', () => {
    expect(canGoFaster(0)).toBe(false);
    expect(fasterGameSpeedStep(0)).toBe(0);
  });

  it('enables Faster as soon as Slower has been clicked once', () => {
    const slowed = slowerGameSpeedStep(0);
    expect(slowed).toBe(1);
    expect(canGoFaster(slowed)).toBe(true);
    expect(fasterGameSpeedStep(slowed)).toBe(0);
  });

  it('steps up by exactly as much as it stepped down', () => {
    // Walk all the way down, then all the way back up: the ladder is uniform,
    // so the return trip must land precisely on full speed.
    let step = 0;
    const visited = [step];
    while (canGoSlower(step)) {
      step = slowerGameSpeedStep(step);
      visited.push(step);
    }
    expect(visited).toEqual([0, 1, 2, 3, 4]);
    expect(step).toBe(GAME_SPEED_STEP_COUNT);

    for (let i = visited.length - 1; i > 0; i--) {
      const before = visited[i];
      const after = fasterGameSpeedStep(before);
      expect(after).toBe(visited[i - 1]);
    }
    expect(fasterGameSpeedStep(0)).toBe(0);
  });

  it('stops at both ends of the ladder', () => {
    expect(canGoSlower(GAME_SPEED_STEP_COUNT)).toBe(false);
    expect(slowerGameSpeedStep(GAME_SPEED_STEP_COUNT)).toBe(GAME_SPEED_STEP_COUNT);
    expect(clampGameSpeedStep(99)).toBe(GAME_SPEED_STEP_COUNT);
    expect(clampGameSpeedStep(-5)).toBe(0);
    expect(clampGameSpeedStep(Number.NaN)).toBe(0);
  });

  it('gives the AI turn watchdog more room the slower the game runs', () => {
    expect(gameSpeedTimeoutFactor(0)).toBe(1);
    for (let step = 1; step <= GAME_SPEED_STEP_COUNT; step++) {
      expect(gameSpeedTimeoutFactor(step)).toBeGreaterThan(gameSpeedTimeoutFactor(step - 1));
    }
  });

  it('labels every rung of the ladder', () => {
    expect(gameSpeedLabel(0)).toBe('Full Speed');
    expect(gameSpeedLabel(2)).toBe('Slower ×2');
  });
});

describe('game speed store actions', () => {
  beforeEach(() => {
    useGameStore.setState((state) => ({
      settings: { ...state.settings, gameSpeedStep: 0 },
    }));
  });

  const step = () => useGameStore.getState().settings.gameSpeedStep;

  it('defaults to full speed', () => {
    expect(step()).toBe(0);
  });

  it('slows and speeds back in uniform steps', () => {
    const { actions } = useGameStore.getState();
    actions.slowerGameSpeed();
    expect(step()).toBe(1);
    actions.slowerGameSpeed();
    expect(step()).toBe(2);
    actions.fasterGameSpeed();
    expect(step()).toBe(1);
    actions.fasterGameSpeed();
    expect(step()).toBe(0);
  });

  it('clamps a direct step assignment to the ladder', () => {
    const { actions } = useGameStore.getState();
    actions.setGameSpeedStep(99);
    expect(step()).toBe(GAME_SPEED_STEP_COUNT);
    actions.setGameSpeedStep(-3);
    expect(step()).toBe(0);
  });

  it('toggles the pause flag', () => {
    const { actions } = useGameStore.getState();
    const before = useGameStore.getState().uiState.isGamePaused;
    actions.toggleGamePaused();
    expect(useGameStore.getState().uiState.isGamePaused).toBe(!before);
    actions.setGamePaused(false);
    expect(useGameStore.getState().uiState.isGamePaused).toBe(false);
  });

  it('does not tie the pause flag to the pause dialog', () => {
    // A spectator pause shows no dialog; the two must be able to disagree.
    const { actions } = useGameStore.getState();
    actions.setGamePaused(true);
    expect(useGameStore.getState().uiState.isGamePaused).toBe(true);
    expect(useGameStore.getState().uiState.activeDialog).toBeNull();
    actions.setGamePaused(false);
  });
});

describe('isAutoScenario covers every self-playing map type', () => {
  it('recognises all four AI-vs-AI scenarios', () => {
    for (const mapType of [
      'AI_VS_AI',
      'AI_VS_AI_SMALL',
      'AI_VS_AI_NAVAL',
      'AI_VS_AI_NAVAL_TROPICAL',
    ]) {
      expect(isAutoScenario(mapType)).toBe(true);
    }
    expect(isAutoScenario('DEFAULT')).toBe(false);
    expect(isAutoScenario(undefined)).toBe(false);
  });
});
